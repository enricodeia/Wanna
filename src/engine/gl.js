// WebGL2 engine: unified layer stack — sprites/shapes/text and effects rendered
// in a single bottom-to-top pipeline (Photoshop-style adjustment layers).

const FULLSCREEN_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const SPRITE_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
uniform vec2 u_canvasSize;
uniform vec2 u_center;
uniform vec2 u_size;
uniform float u_rotation;
out vec2 v_uv;
void main(){
  vec2 p = a_pos * u_size;
  float c = cos(u_rotation), s = sin(u_rotation);
  p = mat2(c, -s, s, c) * p;
  p += u_center;
  vec2 ndc = (p / u_canvasSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  v_uv = a_uv;
}`

const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_opacity;
out vec4 o;
void main(){
  vec4 c = texture(u_tex, v_uv);
  o = vec4(c.rgb, c.a * u_opacity);
}`

const SHAPE_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main(){
  vec2 ndc = a_pos * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  v_uv = a_uv;
}`

const SHAPE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec3 u_fill;
uniform float u_opacity;
uniform float u_useTexture;
uniform float u_imgAR;
uniform float u_shapeAR;
uniform float u_fitMode;
uniform float u_tileScale;
out vec4 o;
void main(){
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  bool outOfBounds = false;
  if(u_fitMode > 0.5 && u_fitMode < 1.5){
    float r = u_imgAR / u_shapeAR;
    if(r > 1.0) uv.x = (uv.x - 0.5) / r + 0.5;
    else        uv.y = (uv.y - 0.5) * r + 0.5;
  } else if(u_fitMode > 1.5 && u_fitMode < 2.5){
    float r = u_imgAR / u_shapeAR;
    if(r > 1.0) uv.y = (uv.y - 0.5) * r + 0.5;
    else        uv.x = (uv.x - 0.5) / r + 0.5;
    if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) outOfBounds = true;
  } else if(u_fitMode > 2.5){
    uv = fract(uv * max(u_tileScale, 0.001));
  }
  vec3 imageCol = outOfBounds ? u_fill : texture(u_tex, uv).rgb;
  vec3 col = mix(u_fill, imageCol, u_useTexture);
  o = vec4(col, u_opacity);
}`

const COPY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 o;
void main(){ o = texture(u_tex, v_uv); }`

// Mask blend: interpolates between original and effected based on a soft circular cursor mask.
const MASK_BLEND_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_originalTex;
uniform sampler2D u_effectedTex;
uniform vec2 u_res;
uniform vec2 u_mouse;
uniform float u_maskRadius;
uniform float u_maskSoftness;
uniform float u_maskInvert;
uniform float u_maskFeather;
out vec4 o;
void main(){
  vec4 orig = texture(u_originalTex, v_uv);
  vec4 effected = texture(u_effectedTex, v_uv);
  vec2 ar = u_res / max(u_res.x, u_res.y);
  float d = length((v_uv - u_mouse) * ar);
  float inner = u_maskRadius * (1.0 - u_maskSoftness);
  float maskValue = 1.0 - smoothstep(inner, u_maskRadius * (1.0 + u_maskFeather), d);
  if(u_maskInvert > 0.5) maskValue = 1.0 - maskValue;
  o = mix(orig, effected, maskValue);
}`

function compile(gl, type, src){
  const s = gl.createShader(type)
  gl.shaderSource(s, src); gl.compileShader(s)
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
    const log = gl.getShaderInfoLog(s); console.error(src)
    throw new Error('Shader compile: ' + log)
  }
  return s
}
function linkProgram(gl, vsSrc, fsSrc, attribs){
  const p = gl.createProgram()
  const v = compile(gl, gl.VERTEX_SHADER, vsSrc)
  const f = compile(gl, gl.FRAGMENT_SHADER, fsSrc)
  gl.attachShader(p, v); gl.attachShader(p, f)
  if(attribs){ for(const [i, name] of attribs.entries()) gl.bindAttribLocation(p, i, name) }
  gl.linkProgram(p)
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p))
  return p
}
function uniforms(gl, prog){
  const u = {}; const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS)
  for(let i = 0; i < n; i++){ const info = gl.getActiveUniform(prog, i); u[info.name] = gl.getUniformLocation(prog, info.name) }
  return u
}
function makeFBO(gl, w, h){
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  return { tex, fbo, w, h }
}

export function shapeCentroid(points){
  const n = points.length / 2
  let cx = 0, cy = 0
  for(let i = 0; i < n; i++){ cx += points[i*2]; cy += points[i*2+1] }
  return [cx / n, cy / n]
}

export function roundPolygon(points, radius, segments = 6){
  const n = points.length / 2
  if(n < 3 || radius <= 0) return points.slice()
  const out = []
  for(let i = 0; i < n; i++){
    const prevIdx = (i - 1 + n) % n
    const nextIdx = (i + 1) % n
    const px = points[prevIdx * 2], py = points[prevIdx * 2 + 1]
    const cx = points[i * 2],       cy = points[i * 2 + 1]
    const nx = points[nextIdx * 2], ny = points[nextIdx * 2 + 1]
    const ipx = cx - px, ipy = cy - py
    const ilen = Math.hypot(ipx, ipy) || 1
    const inx = nx - cx, iny = ny - cy
    const inLen = Math.hypot(inx, iny) || 1
    const r = Math.min(radius, ilen / 2, inLen / 2)
    const ax = cx - (ipx / ilen) * r
    const ay = cy - (ipy / ilen) * r
    const bx = cx + (inx / inLen) * r
    const by = cy + (iny / inLen) * r
    for(let s = 0; s <= segments; s++){
      const t = s / segments, u = 1 - t
      out.push(u*u*ax + 2*u*t*cx + t*t*bx,
               u*u*ay + 2*u*t*cy + t*t*by)
    }
  }
  return out
}

export function transformShapePoints(points, { x = 0, y = 0, scale = 1, rotation = 0, cornerRadius = 0 } = {}){
  const rounded = cornerRadius > 0 ? roundPolygon(points, cornerRadius) : points.slice()
  const [cx, cy] = shapeCentroid(rounded)
  const cs = Math.cos(rotation), sn = Math.sin(rotation)
  const out = new Float32Array(rounded.length)
  for(let i = 0; i < rounded.length; i += 2){
    let dx = (rounded[i] - cx) * scale
    let dy = (rounded[i + 1] - cy) * scale
    const rx = dx * cs - dy * sn
    const ry = dx * sn + dy * cs
    out[i]     = rx + cx + x
    out[i + 1] = ry + cy + y
  }
  return out
}

export function createEngine(canvas){
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: true })
  if(!gl) throw new Error('WebGL2 unavailable')

  const fsVAO = gl.createVertexArray()
  gl.bindVertexArray(fsVAO)
  const fsBuf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, fsBuf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  const spriteVAO = gl.createVertexArray()
  gl.bindVertexArray(spriteVAO)
  const spriteBuf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -0.5, -0.5, 0, 1,
     0.5, -0.5, 1, 1,
    -0.5,  0.5, 0, 0,
     0.5,  0.5, 1, 0
  ]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0)
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8)

  const shapeVAO = gl.createVertexArray()
  gl.bindVertexArray(shapeVAO)
  const shapeBuf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(1024), gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0)
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8)

  const spriteProg = linkProgram(gl, SPRITE_VS, SPRITE_FS, ['a_pos', 'a_uv'])
  const spriteU = uniforms(gl, spriteProg)
  const shapeProg = linkProgram(gl, SHAPE_VS, SHAPE_FS, ['a_pos', 'a_uv'])
  const shapeU = uniforms(gl, shapeProg)
  const copyProg = linkProgram(gl, FULLSCREEN_VS, COPY_FS, ['a_pos'])
  const copyU = uniforms(gl, copyProg)
  const maskProg = linkProgram(gl, FULLSCREEN_VS, MASK_BLEND_FS, ['a_pos'])
  const maskU = uniforms(gl, maskProg)

  const effectPrograms = new Map()
  let W = 0, H = 0
  let fboA = null, fboB = null, fboC = null

  function resize(w, h){
    W = w; H = h; canvas.width = w; canvas.height = h
    if(fboA){ gl.deleteFramebuffer(fboA.fbo); gl.deleteTexture(fboA.tex) }
    if(fboB){ gl.deleteFramebuffer(fboB.fbo); gl.deleteTexture(fboB.tex) }
    if(fboC){ gl.deleteFramebuffer(fboC.fbo); gl.deleteTexture(fboC.tex) }
    fboA = makeFBO(gl, w, h); fboB = makeFBO(gl, w, h); fboC = makeFBO(gl, w, h)
  }
  function uploadTexture(image){
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return { tex, width: image.width, height: image.height }
  }
  function deleteTexture(t){ if(t && t.tex) gl.deleteTexture(t.tex) }
  function registerEffect(id, fs){
    if(effectPrograms.has(id)) return
    const prog = linkProgram(gl, FULLSCREEN_VS, fs, ['a_pos'])
    effectPrograms.set(id, { prog, u: uniforms(gl, prog) })
  }
  function setUniforms(u, vals){
    for(const [name, v] of Object.entries(vals)){
      const loc = u[name]; if(loc == null) continue
      if(typeof v === 'number')       gl.uniform1f(loc, v)
      else if(typeof v === 'boolean') gl.uniform1f(loc, v ? 1.0 : 0.0)
      else if(Array.isArray(v)){
        if(v.length === 2) gl.uniform2f(loc, v[0], v[1])
        else if(v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2])
        else if(v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3])
      }
    }
  }
  function blitFBO(srcTex, dstFBO, w, h){
    gl.useProgram(copyProg)
    gl.bindVertexArray(fsVAO)
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFBO ? dstFBO.fbo : null)
    gl.viewport(0, 0, w, h)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, srcTex)
    gl.uniform1i(copyU.u_tex, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  function drawSprite(s){
    const t = s.transform || s
    const canvasMin = Math.min(W, H)
    const imgMax = Math.max(s.imgW, s.imgH)
    const px = (t.scale * canvasMin) / imgMax
    const sw = s.imgW * px
    const sh = s.imgH * px
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, s.tex.tex)
    gl.uniform2f(spriteU.u_size, sw, sh)
    gl.uniform2f(spriteU.u_center, t.x * W, t.y * H)
    gl.uniform1f(spriteU.u_rotation, t.rotation || 0)
    gl.uniform1f(spriteU.u_opacity, t.opacity == null ? 1 : t.opacity)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  function drawShape(s){
    if(!s.points || s.points.length < 6) return
    const tp = transformShapePoints(s.points, {
      x: s.x || 0, y: s.y || 0,
      scale: s.scale == null ? 1 : s.scale,
      rotation: s.rotation || 0,
      cornerRadius: s.cornerRadius || 0
    })
    const n = tp.length / 2
    if(n < 3) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for(let i = 0; i < n; i++){
      if(tp[i*2] < minX) minX = tp[i*2]; if(tp[i*2+1] < minY) minY = tp[i*2+1]
      if(tp[i*2] > maxX) maxX = tp[i*2]; if(tp[i*2+1] > maxY) maxY = tp[i*2+1]
    }
    const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1
    let cx = 0, cy = 0
    for(let i = 0; i < n; i++){ cx += tp[i*2]; cy += tp[i*2+1] }
    cx /= n; cy /= n
    const arr = new Float32Array((n + 2) * 4)
    arr[0] = cx; arr[1] = cy
    arr[2] = (cx - minX) / bw; arr[3] = (cy - minY) / bh
    for(let i = 0; i < n; i++){
      const o = (i + 1) * 4
      arr[o]   = tp[i*2]
      arr[o+1] = tp[i*2+1]
      arr[o+2] = (tp[i*2]   - minX) / bw
      arr[o+3] = (tp[i*2+1] - minY) / bh
    }
    const o = (n + 1) * 4
    arr[o]   = tp[0]
    arr[o+1] = tp[1]
    arr[o+2] = (tp[0] - minX) / bw
    arr[o+3] = (tp[1] - minY) / bh
    gl.bindVertexArray(shapeVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuf)
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW)
    const useTex = s.imageTex ? 1 : 0
    if(useTex){
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, s.imageTex.tex)
      gl.uniform1i(shapeU.u_tex, 0)
    }
    gl.uniform3f(shapeU.u_fill, s.fill[0], s.fill[1], s.fill[2])
    gl.uniform1f(shapeU.u_opacity, s.opacity == null ? 1 : s.opacity)
    gl.uniform1f(shapeU.u_useTexture, useTex)
    const fitMap = { fill: 0, cover: 1, contain: 2, tile: 3 }
    const fitMode = fitMap[s.imageFit] != null ? fitMap[s.imageFit] : 0
    const imgAR = (s.imgW && s.imgH) ? (s.imgW / s.imgH) : 1
    const shapeAR = bw / bh
    if(shapeU.u_imgAR)     gl.uniform1f(shapeU.u_imgAR, imgAR)
    if(shapeU.u_shapeAR)   gl.uniform1f(shapeU.u_shapeAR, shapeAR)
    if(shapeU.u_fitMode)   gl.uniform1f(shapeU.u_fitMode, fitMode)
    if(shapeU.u_tileScale) gl.uniform1f(shapeU.u_tileScale, s.tileScale || 3)
    gl.drawArrays(gl.TRIANGLE_FAN, 0, arr.length / 4)
  }

  // ============ Unified render pipeline ============
  // layers: bottom-to-top. Each layer is either a sprite (image/text/shape)
  // OR an effect. Effects affect the current accumulated framebuffer (everything
  // rendered before them). Sprites render ON TOP of the current state.
  function render({ layers, time, bg, mouse }){
    if(!fboA) return

    // Initialize: clear fboA with bg color
    let read = fboA, write = fboB
    gl.bindFramebuffer(gl.FRAMEBUFFER, read.fbo)
    gl.viewport(0, 0, W, H)
    gl.clearColor(bg[0], bg[1], bg[2], 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    for(const layer of layers){
      if(!layer || !layer.visible) continue

      if(layer.type === 'effect'){
        const entry = effectPrograms.get(layer.effectId)
        if(!entry) continue

        // Optional mask: save current state to fboC
        const useMask = layer.mask && layer.mask.on
        if(useMask) blitFBO(read.tex, fboC, W, H)

        // Run the effect: read → write
        gl.useProgram(entry.prog)
        gl.bindVertexArray(fsVAO)
        gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo)
        gl.viewport(0, 0, write.w, write.h)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, read.tex)
        if(entry.u.u_tex)   gl.uniform1i(entry.u.u_tex, 0)
        if(entry.u.u_res)   gl.uniform2f(entry.u.u_res, write.w, write.h)
        if(entry.u.u_mouse && mouse) gl.uniform2f(entry.u.u_mouse, mouse.x, mouse.y)
        setUniforms(entry.u, { ...layer.values, u_time: time })
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        let t = read; read = write; write = t

        // Apply mask blend: orig (fboC) + effected (read) → write
        if(useMask){
          gl.useProgram(maskProg)
          gl.bindVertexArray(fsVAO)
          gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo)
          gl.viewport(0, 0, write.w, write.h)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, fboC.tex)
          if(maskU.u_originalTex) gl.uniform1i(maskU.u_originalTex, 0)
          gl.activeTexture(gl.TEXTURE1)
          gl.bindTexture(gl.TEXTURE_2D, read.tex)
          if(maskU.u_effectedTex) gl.uniform1i(maskU.u_effectedTex, 1)
          if(maskU.u_res)         gl.uniform2f(maskU.u_res, write.w, write.h)
          if(maskU.u_mouse && mouse) gl.uniform2f(maskU.u_mouse, mouse.x, mouse.y)
          if(maskU.u_maskRadius)   gl.uniform1f(maskU.u_maskRadius, layer.mask.radius || 0.3)
          if(maskU.u_maskSoftness) gl.uniform1f(maskU.u_maskSoftness, layer.mask.softness || 0.3)
          if(maskU.u_maskInvert)   gl.uniform1f(maskU.u_maskInvert, layer.mask.invert ? 1 : 0)
          if(maskU.u_maskFeather)  gl.uniform1f(maskU.u_maskFeather, layer.mask.feather || 0.1)
          gl.drawArrays(gl.TRIANGLES, 0, 3)
          t = read; read = write; write = t
        }
      } else {
        // Sprite/shape/text — render onto current `read` with alpha blending
        gl.bindFramebuffer(gl.FRAMEBUFFER, read.fbo)
        gl.viewport(0, 0, W, H)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        if((layer.type === 'image' || layer.type === 'text') && layer.tex){
          gl.useProgram(spriteProg)
          gl.bindVertexArray(spriteVAO)
          gl.uniform2f(spriteU.u_canvasSize, W, H)
          gl.uniform1i(spriteU.u_tex, 0)
          drawSprite(layer)
        } else if(layer.type === 'shape'){
          gl.useProgram(shapeProg)
          drawShape(layer)
        }
        gl.disable(gl.BLEND)
      }
    }

    // Final blit to screen
    blitFBO(read.tex, null, W, H)
  }

  return { gl, resize, uploadTexture, deleteTexture, registerEffect, render, get size(){ return { W, H } } }
}
