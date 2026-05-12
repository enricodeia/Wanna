// WebGL2 engine: image/text sprites + polygon shapes (solid or textured) + effect pipeline.

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

// Shape VS — takes positions + UVs in 0..1 canvas coords (positions already
// post-transformed CPU-side), outputs NDC and varies UV for textured fills.
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
uniform float u_imgAR;     // image width / height
uniform float u_shapeAR;   // shape bbox width / height
uniform float u_fitMode;   // 0=fill, 1=cover, 2=contain, 3=tile
uniform float u_tileScale;
out vec4 o;
void main(){
  // Y flip so image is right-side up inside shape (texture was FLIP_Y'd on upload)
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  bool outOfBounds = false;
  if(u_fitMode > 0.5 && u_fitMode < 1.5){
    // cover: image fills shape, may crop
    float r = u_imgAR / u_shapeAR;
    if(r > 1.0) uv.x = (uv.x - 0.5) / r + 0.5;
    else        uv.y = (uv.y - 0.5) * r + 0.5;
  } else if(u_fitMode > 1.5 && u_fitMode < 2.5){
    // contain: image fits inside, letterboxed
    float r = u_imgAR / u_shapeAR;
    if(r > 1.0) uv.y = (uv.y - 0.5) * r + 0.5;
    else        uv.x = (uv.x - 0.5) / r + 0.5;
    if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) outOfBounds = true;
  } else if(u_fitMode > 2.5){
    // tile
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

// =============================================================
// CPU-side helpers exported for hit-test / overlays in App.jsx
// =============================================================
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

// Transform polygon: round, then scale + rotate around centroid, then translate by (offX, offY).
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

  // Fullscreen triangle
  const fsVAO = gl.createVertexArray()
  gl.bindVertexArray(fsVAO)
  const fsBuf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, fsBuf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  // Sprite quad
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

  // Shape VAO (dynamic, positions + UVs)
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

  const effectPrograms = new Map()
  let W = 0, H = 0
  let fboA = null, fboB = null

  function resize(w, h){
    W = w; H = h; canvas.width = w; canvas.height = h
    if(fboA){ gl.deleteFramebuffer(fboA.fbo); gl.deleteTexture(fboA.tex) }
    if(fboB){ gl.deleteFramebuffer(fboB.fbo); gl.deleteTexture(fboB.tex) }
    fboA = makeFBO(gl, w, h); fboB = makeFBO(gl, w, h)
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
    // Transform points (corner radius + scale + rotation + offset)
    const tp = transformShapePoints(s.points, {
      x: s.x || 0, y: s.y || 0,
      scale: s.scale == null ? 1 : s.scale,
      rotation: s.rotation || 0,
      cornerRadius: s.cornerRadius || 0
    })
    const n = tp.length / 2
    if(n < 3) return

    // Bbox for UV computation
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for(let i = 0; i < n; i++){
      if(tp[i*2] < minX) minX = tp[i*2]; if(tp[i*2+1] < minY) minY = tp[i*2+1]
      if(tp[i*2] > maxX) maxX = tp[i*2]; if(tp[i*2+1] > maxY) maxY = tp[i*2+1]
    }
    const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1

    // Centroid
    let cx = 0, cy = 0
    for(let i = 0; i < n; i++){ cx += tp[i*2]; cy += tp[i*2+1] }
    cx /= n; cy /= n

    // Build vertex array: centroid + each point + closing point
    // Each vertex: [x, y, u, v]
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
    // Fit mode uniforms
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

  function render({ elements, effects, time, bg, mouse }){
    if(!fboA) return

    gl.bindFramebuffer(gl.FRAMEBUFFER, fboA.fbo)
    gl.viewport(0, 0, W, H)
    gl.clearColor(bg[0], bg[1], bg[2], 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    for(const el of elements){
      if(!el || !el.visible) continue
      if((el.type === 'image' || el.type === 'text') && el.tex){
        gl.useProgram(spriteProg)
        gl.bindVertexArray(spriteVAO)
        gl.uniform2f(spriteU.u_canvasSize, W, H)
        gl.uniform1i(spriteU.u_tex, 0)
        drawSprite(el)
      } else if(el.type === 'shape'){
        gl.useProgram(shapeProg)
        drawShape(el)
      }
    }
    gl.disable(gl.BLEND)

    let read = fboA, write = fboB
    for(const layer of effects){
      if(!layer.enabled) continue
      const entry = effectPrograms.get(layer.id)
      if(!entry) continue
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
      const t = read; read = write; write = t
    }

    gl.useProgram(copyProg)
    gl.bindVertexArray(fsVAO)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, W, H)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, read.tex)
    gl.uniform1i(copyU.u_tex, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  return { gl, resize, uploadTexture, deleteTexture, registerEffect, render, get size(){ return { W, H } } }
}
