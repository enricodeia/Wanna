// WebGL2 engine: unified layer stack — sprites/shapes/text and effects rendered
// in a single bottom-to-top pipeline (Photoshop-style adjustment layers).

const FULLSCREEN_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

// Sprite vertex shader with full 3D tilt:
//   u_rotation = z-rotation (in-plane)
//   u_rx       = rotate around horizontal axis (forward / back tilt)
//   u_ry       = rotate around vertical axis (left / right tilt)
//   u_perspective = strength of one-point perspective applied after 3D rotation
const SPRITE_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
uniform vec2 u_canvasSize;
uniform vec2 u_center;
uniform vec2 u_size;
uniform float u_rotation;
uniform float u_rx;
uniform float u_ry;
uniform float u_perspective;
out vec2 v_uv;
void main(){
  vec3 p = vec3(a_pos * u_size, 0.0);

  // Z rotation (in-plane)
  float cz = cos(u_rotation), sz = sin(u_rotation);
  p = mat3(cz, -sz, 0.0,  sz, cz, 0.0,  0.0, 0.0, 1.0) * p;

  // X rotation (tilt forward / back)
  float cx = cos(u_rx), sx = sin(u_rx);
  p = mat3(1.0, 0.0, 0.0,  0.0, cx, -sx,  0.0, sx, cx) * p;

  // Y rotation (tilt left / right)
  float cy = cos(u_ry), sy = sin(u_ry);
  p = mat3(cy, 0.0, sy,  0.0, 1.0, 0.0,  -sy, 0.0, cy) * p;

  // Cheap one-point perspective: pull xy in/out based on z
  float persp = 1.0 / (1.0 - p.z * u_perspective * 0.0015);
  p.xy *= persp;

  vec2 wp = p.xy + u_center;
  vec2 ndc = (wp / u_canvasSize) * 2.0 - 1.0;
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

// Compositor — blend a sprite/shape layer (src) with the current accumulator (dst)
// using a chosen blend mode + opacity.
const COMPOSITOR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_dst;
uniform sampler2D u_src;
uniform float u_blendMode;
uniform float u_opacity;
out vec4 o;

vec3 bMul(vec3 a, vec3 b){ return a * b; }
vec3 bScreen(vec3 a, vec3 b){ return 1.0 - (1.0 - a) * (1.0 - b); }
vec3 bOverlay(vec3 a, vec3 b){
  return mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a));
}
vec3 bSoftLight(vec3 a, vec3 b){
  return mix(2.0 * a * b + a * a * (1.0 - 2.0 * b),
             sqrt(a) * (2.0 * b - 1.0) + 2.0 * a * (1.0 - b),
             step(0.5, b));
}
vec3 bDarken(vec3 a, vec3 b){ return min(a, b); }
vec3 bLighten(vec3 a, vec3 b){ return max(a, b); }
vec3 bDifference(vec3 a, vec3 b){ return abs(a - b); }
vec3 bExclusion(vec3 a, vec3 b){ return a + b - 2.0 * a * b; }
vec3 bDodge(vec3 a, vec3 b){ return min(a / max(1.0 - b, 0.001), vec3(1.0)); }
vec3 bBurn(vec3 a, vec3 b){ return 1.0 - min((1.0 - a) / max(b, 0.001), vec3(1.0)); }
vec3 bAdd(vec3 a, vec3 b){ return min(a + b, vec3(1.0)); }
vec3 bSubtract(vec3 a, vec3 b){ return max(a - b, vec3(0.0)); }

void main(){
  vec4 dst = texture(u_dst, v_uv);
  vec4 src = texture(u_src, v_uv);
  int mode = int(u_blendMode + 0.5);
  vec3 blended;
  if      (mode == 1) blended = bMul(dst.rgb, src.rgb);
  else if (mode == 2) blended = bScreen(dst.rgb, src.rgb);
  else if (mode == 3) blended = bOverlay(dst.rgb, src.rgb);
  else if (mode == 4) blended = bSoftLight(dst.rgb, src.rgb);
  else if (mode == 5) blended = bDarken(dst.rgb, src.rgb);
  else if (mode == 6) blended = bLighten(dst.rgb, src.rgb);
  else if (mode == 7) blended = bDifference(dst.rgb, src.rgb);
  else if (mode == 8) blended = bExclusion(dst.rgb, src.rgb);
  else if (mode == 9) blended = bDodge(dst.rgb, src.rgb);
  else if (mode == 10) blended = bBurn(dst.rgb, src.rgb);
  else if (mode == 11) blended = bAdd(dst.rgb, src.rgb);
  else if (mode == 12) blended = bSubtract(dst.rgb, src.rgb);
  else                 blended = src.rgb;
  float a = src.a * u_opacity;
  vec3 result = mix(dst.rgb, blended, a);
  o = vec4(result, max(dst.a, a));
}`

// Mask blend: interpolates between original and effected based on a soft cursor mask.
// The mask boundary can be warped by procedural shaders (fbm / ripple / spikes / cells /
// zigzag) so the "circle" becomes an organic blob, spiked star, wavy edge, etc.
const MASK_BLEND_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_originalTex;
uniform sampler2D u_effectedTex;
uniform vec2 u_res;
uniform vec2 u_mouse;
uniform float u_time;
uniform float u_maskRadius;
uniform float u_maskSoftness;
uniform float u_maskInvert;
uniform float u_maskFeather;
uniform int   u_warpType;     // 0=none 1=fbm 2=ripple 3=spikes 4=cells 5=zigzag
uniform float u_warpAmount;
uniform float u_warpScale;
uniform float u_warpSpeed;
out vec4 o;

float mhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(mhash(i), mhash(i+vec2(1,0)), u.x),
             mix(mhash(i+vec2(0,1)), mhash(i+vec2(1,1)), u.x), u.y);
}
float mfbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 5; i++){ v += a * mnoise(p); p *= 2.0; a *= 0.5; }
  return v;
}

float maskWarp(vec2 d, float angle){
  if(u_warpType == 0) return 0.0;
  float r = u_maskRadius;
  if(u_warpType == 1){
    // FBM organic blob — radial offset modulated by noise around the boundary
    float n = mfbm(d * u_warpScale * 4.0 + vec2(u_time * u_warpSpeed * 0.4));
    return (n - 0.5) * u_warpAmount * r;
  } else if(u_warpType == 2){
    // Ripple — sinusoidal angular wave
    return sin(angle * u_warpScale + u_time * u_warpSpeed * 2.0) * u_warpAmount * r * 0.4;
  } else if(u_warpType == 3){
    // Spikes — triangle wave around angle = sharp peaks
    float t = fract(angle * u_warpScale / 6.28318 + u_time * u_warpSpeed * 0.1);
    return (abs(t - 0.5) * 2.0 - 0.5) * u_warpAmount * r * 0.8;
  } else if(u_warpType == 4){
    // Cellular — voronoi-ish chunky boundary
    vec2 g = floor(d * u_warpScale * 6.0);
    float n = mhash(g + floor(u_time * u_warpSpeed * 2.0));
    return (n - 0.5) * u_warpAmount * r * 0.7;
  } else if(u_warpType == 5){
    // Zigzag — sharp triangle wave on radius
    float t = fract(angle * u_warpScale / 3.14159 + u_time * u_warpSpeed * 0.5);
    return (abs(t - 0.5) * 4.0 - 1.0) * u_warpAmount * r * 0.5;
  }
  return 0.0;
}

void main(){
  vec4 orig = texture(u_originalTex, v_uv);
  vec4 effected = texture(u_effectedTex, v_uv);
  vec2 ar = u_res / max(u_res.x, u_res.y);
  vec2 d = (v_uv - u_mouse) * ar;
  float dist = length(d);
  float angle = atan(d.y, d.x);
  float warp = maskWarp(d, angle);
  float effectiveDist = dist + warp;
  float inner = u_maskRadius * (1.0 - u_maskSoftness);
  float maskValue = 1.0 - smoothstep(inner, u_maskRadius * (1.0 + u_maskFeather), effectiveDist);
  if(u_maskInvert > 0.5) maskValue = 1.0 - maskValue;
  o = mix(orig, effected, maskValue);
}`

// Background: fullscreen quad shader for solid / linear / radial / conic gradients.
const BG_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform int   u_bgType;     // 0=solid  1=linear  2=radial  3=conic
uniform vec3  u_bgA;
uniform vec3  u_bgB;
uniform float u_bgAngle;    // for linear / conic
uniform float u_bgRadius;   // for radial
out vec4 o;
void main(){
  vec3 col;
  if(u_bgType == 1){
    float a = radians(u_bgAngle);
    vec2 dir = vec2(cos(a), sin(a));
    float t = clamp(dot(v_uv - 0.5, dir) + 0.5, 0.0, 1.0);
    col = mix(u_bgA, u_bgB, t);
  } else if(u_bgType == 2){
    float t = clamp(length(v_uv - 0.5) / max(u_bgRadius, 0.01), 0.0, 1.0);
    col = mix(u_bgA, u_bgB, t);
  } else if(u_bgType == 3){
    vec2 p = v_uv - 0.5;
    float a = atan(p.y, p.x) - radians(u_bgAngle);
    float t = fract(a / 6.28318 + 0.5);
    col = mix(u_bgA, u_bgB, t);
  } else {
    col = u_bgA;
  }
  o = vec4(col, 1.0);
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

// 2D version (kept for hit-testing — pure z-rotation around centroid).
export function transformShapePoints(points, { x = 0, y = 0, scale = 1, rotation = 0, cornerRadius = 0 } = {}){
  const rounded = cornerRadius > 0 ? roundPolygon(points, cornerRadius) : points.slice()
  const [cx, cy] = shapeCentroid(rounded)
  const cs = Math.cos(rotation), sn = Math.sin(rotation)
  const out = new Float32Array(rounded.length)
  for(let i = 0; i < rounded.length; i += 2){
    let dx = (rounded[i] - cx) * scale
    let dy = (rounded[i + 1] - cy) * scale
    const rx2 = dx * cs - dy * sn
    const ry2 = dx * sn + dy * cs
    out[i]     = rx2 + cx + x
    out[i + 1] = ry2 + cy + y
  }
  return out
}

// 3D version with rx/ry tilt + one-point perspective. Used for rendering when
// the shape carries non-zero rx/ry; otherwise the 2D function is used.
export function transformShapePoints3D(points, opts = {}){
  const { x = 0, y = 0, scale = 1, rotation = 0, cornerRadius = 0,
          rx = 0, ry = 0, perspective = 1 } = opts
  if(!rx && !ry) return transformShapePoints(points, opts)
  const rounded = cornerRadius > 0 ? roundPolygon(points, cornerRadius) : points.slice()
  const [cx, cy] = shapeCentroid(rounded)
  const cz = Math.cos(rotation), sz = Math.sin(rotation)
  const cxR = Math.cos(rx), sxR = Math.sin(rx)
  const cyR = Math.cos(ry), syR = Math.sin(ry)
  const persp = perspective * 1.5
  const out = new Float32Array(rounded.length)
  for(let i = 0; i < rounded.length; i += 2){
    let px = (rounded[i] - cx) * scale
    let py = (rounded[i + 1] - cy) * scale
    let pz = 0
    // Z rotation
    const x1 = px * cz - py * sz
    const y1 = px * sz + py * cz
    px = x1; py = y1
    // X rotation
    const y2 = py * cxR - pz * sxR
    const z2 = py * sxR + pz * cxR
    py = y2; pz = z2
    // Y rotation
    const x3 = px * cyR + pz * syR
    const z3 = -px * syR + pz * cyR
    px = x3; pz = z3
    // Perspective
    const k = 1.0 / (1.0 - pz * persp)
    px *= k; py *= k
    out[i]     = px + cx + x
    out[i + 1] = py + cy + y
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
  const compProg = linkProgram(gl, FULLSCREEN_VS, COMPOSITOR_FS, ['a_pos'])
  const compU = uniforms(gl, compProg)
  const bgProg = linkProgram(gl, FULLSCREEN_VS, BG_FS, ['a_pos'])
  const bgU = uniforms(gl, bgProg)

  const effectPrograms = new Map()
  let W = 0, H = 0
  let fboA = null, fboB = null, fboC = null, fboD = null, fboE = null

  function resize(w, h){
    W = w; H = h; canvas.width = w; canvas.height = h
    if(fboA){ gl.deleteFramebuffer(fboA.fbo); gl.deleteTexture(fboA.tex) }
    if(fboB){ gl.deleteFramebuffer(fboB.fbo); gl.deleteTexture(fboB.tex) }
    if(fboC){ gl.deleteFramebuffer(fboC.fbo); gl.deleteTexture(fboC.tex) }
    if(fboD){ gl.deleteFramebuffer(fboD.fbo); gl.deleteTexture(fboD.tex) }
    if(fboE){ gl.deleteFramebuffer(fboE.fbo); gl.deleteTexture(fboE.tex) }
    fboA = makeFBO(gl, w, h); fboB = makeFBO(gl, w, h); fboC = makeFBO(gl, w, h); fboD = makeFBO(gl, w, h); fboE = makeFBO(gl, w, h)
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
    if(spriteU.u_rx) gl.uniform1f(spriteU.u_rx, t.rx || 0)
    if(spriteU.u_ry) gl.uniform1f(spriteU.u_ry, t.ry || 0)
    if(spriteU.u_perspective) gl.uniform1f(spriteU.u_perspective, t.perspective != null ? t.perspective : 1)
    gl.uniform1f(spriteU.u_opacity, t.opacity == null ? 1 : t.opacity)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  function drawShape(s){
    if(!s.points || s.points.length < 6) return
    const tp = transformShapePoints3D(s.points, {
      x: s.x || 0, y: s.y || 0,
      scale: s.scale == null ? 1 : s.scale,
      rotation: s.rotation || 0,
      cornerRadius: s.cornerRadius || 0,
      rx: s.rx || 0, ry: s.ry || 0,
      perspective: s.perspective != null ? s.perspective : 1
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
    // Default to 'cover' so images are never stretched/distorted when no fit is set.
    const fitMode = fitMap[s.imageFit] != null ? fitMap[s.imageFit] : 1
    const imgAR = (s.imgW && s.imgH) ? (s.imgW / s.imgH) : 1
    const shapeAR = bw / bh
    if(shapeU.u_imgAR)     gl.uniform1f(shapeU.u_imgAR, imgAR)
    if(shapeU.u_shapeAR)   gl.uniform1f(shapeU.u_shapeAR, shapeAR)
    if(shapeU.u_fitMode)   gl.uniform1f(shapeU.u_fitMode, fitMode)
    if(shapeU.u_tileScale) gl.uniform1f(shapeU.u_tileScale, s.tileScale || 3)
    gl.drawArrays(gl.TRIANGLE_FAN, 0, arr.length / 4)
  }

  // Helper: run an effect pass with ping-pong on the given pair.
  // Returns the new (read, write) tuple after the swap.
  function runEffectPass(effect, time, mouse, read, write){
    const entry = effectPrograms.get(effect.effectId)
    if(!entry) return { read, write }
    const useMask = effect.mask && effect.mask.on
    if(useMask) blitFBO(read.tex, fboC, W, H)

    gl.useProgram(entry.prog)
    gl.bindVertexArray(fsVAO)
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo)
    gl.viewport(0, 0, write.w, write.h)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, read.tex)
    if(entry.u.u_tex) gl.uniform1i(entry.u.u_tex, 0)
    // Bind any auxiliary textures the layer carries (e.g. ASCII glyph atlas).
    // _textures is an array of { name: '<sampler uniform>', tex: { tex } }.
    if(effect._textures){
      let unit = 1
      for(const t of effect._textures){
        if(!t || !t.tex) continue
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, t.tex.tex)
        if(entry.u[t.name] != null) gl.uniform1i(entry.u[t.name], unit)
        unit++
      }
    }
    if(entry.u.u_res) gl.uniform2f(entry.u.u_res, write.w, write.h)
    if(entry.u.u_mouse && mouse) gl.uniform2f(entry.u.u_mouse, mouse.x, mouse.y)
    setUniforms(entry.u, { ...effect.values, u_time: time })
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    let r = write, w = read

    if(useMask){
      gl.useProgram(maskProg)
      gl.bindVertexArray(fsVAO)
      gl.bindFramebuffer(gl.FRAMEBUFFER, w.fbo)
      gl.viewport(0, 0, w.w, w.h)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, fboC.tex)
      if(maskU.u_originalTex) gl.uniform1i(maskU.u_originalTex, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, r.tex)
      if(maskU.u_effectedTex) gl.uniform1i(maskU.u_effectedTex, 1)
      if(maskU.u_res) gl.uniform2f(maskU.u_res, w.w, w.h)
      if(maskU.u_mouse && mouse) gl.uniform2f(maskU.u_mouse, mouse.x, mouse.y)
      if(maskU.u_time) gl.uniform1f(maskU.u_time, time)
      if(maskU.u_maskRadius) gl.uniform1f(maskU.u_maskRadius, effect.mask.radius || 0.3)
      if(maskU.u_maskSoftness) gl.uniform1f(maskU.u_maskSoftness, effect.mask.softness || 0.3)
      if(maskU.u_maskInvert) gl.uniform1f(maskU.u_maskInvert, effect.mask.invert ? 1 : 0)
      if(maskU.u_maskFeather) gl.uniform1f(maskU.u_maskFeather, effect.mask.feather || 0.1)
      if(maskU.u_warpType) gl.uniform1i(maskU.u_warpType, effect.mask.warpType | 0)
      if(maskU.u_warpAmount) gl.uniform1f(maskU.u_warpAmount, effect.mask.warpAmount || 0)
      if(maskU.u_warpScale) gl.uniform1f(maskU.u_warpScale, effect.mask.warpScale || 4)
      if(maskU.u_warpSpeed) gl.uniform1f(maskU.u_warpSpeed, effect.mask.warpSpeed || 0.5)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      const t = r; r = w; w = t
    }
    return { read: r, write: w }
  }

  // Re-upload a layer's HTMLVideoElement frame into its GL texture so the texture
  // tracks the video playback. Called once per frame for video layers.
  function refreshVideoTexture(layer){
    const v = layer._video
    if(!v || v.readyState < 2 || v.paused) return
    if(!layer.tex || !layer.tex.tex) return
    if(v.videoWidth && (layer.imgW !== v.videoWidth || layer.imgH !== v.videoHeight)){
      layer.imgW = v.videoWidth
      layer.imgH = v.videoHeight
    }
    gl.bindTexture(gl.TEXTURE_2D, layer.tex.tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v)
    } catch(_){}
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  }

  function drawLayerOntoBound(layer){
    if((layer.type === 'image' || layer.type === 'text' || layer.type === 'video') && layer.tex){
      if(layer.type === 'video') refreshVideoTexture(layer)
      gl.useProgram(spriteProg)
      gl.bindVertexArray(spriteVAO)
      gl.uniform2f(spriteU.u_canvasSize, W, H)
      gl.uniform1i(spriteU.u_tex, 0)
      drawSprite(layer)
    } else if(layer.type === 'shape'){
      gl.useProgram(shapeProg)
      drawShape(layer)
    }
  }

  // ============ Unified render pipeline ============
  // layers: bottom-to-top. Each layer is either a sprite (image/text/shape)
  // OR an effect. Global effects (no scopedTo) affect the current accumulated framebuffer.
  // Scoped effects (effect.scopedTo === sprite.uid) apply ONLY to that sprite.
  function render({ layers, time, bg, mouse }){
    if(!fboA) return

    // Group scoped effects by their target uid; skip them in the global pass.
    const scopedByUid = new Map()
    for(const l of layers){
      if(l && l.type === 'effect' && l.visible && l.scopedTo){
        const list = scopedByUid.get(l.scopedTo) || []
        list.push(l)
        scopedByUid.set(l.scopedTo, list)
      }
    }

    // Initialize: clear fboA with the background — supports legacy [r,g,b] arrays
    // and the new { type, color, colorA, colorB, angle, radius } object.
    let read = fboA, write = fboB
    gl.bindFramebuffer(gl.FRAMEBUFFER, read.fbo)
    gl.viewport(0, 0, W, H)
    if(Array.isArray(bg)){
      gl.clearColor(bg[0], bg[1], bg[2], 1.0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    } else if(!bg || bg.type === 'transparent'){
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    } else if(bg.type === 'solid' || !bg.type){
      const c = bg.color || [0, 0, 0]
      gl.clearColor(c[0], c[1], c[2], 1.0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    } else {
      // Gradient: linear / radial / conic — render via BG_FS
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(bgProg)
      gl.bindVertexArray(fsVAO)
      const typeMap = { solid: 0, linear: 1, radial: 2, conic: 3 }
      const A = bg.colorA || bg.color || [0, 0, 0]
      const B = bg.colorB || [1, 1, 1]
      if(bgU.u_bgType) gl.uniform1i(bgU.u_bgType, typeMap[bg.type] || 0)
      if(bgU.u_bgA) gl.uniform3f(bgU.u_bgA, A[0], A[1], A[2])
      if(bgU.u_bgB) gl.uniform3f(bgU.u_bgB, B[0], B[1], B[2])
      if(bgU.u_bgAngle) gl.uniform1f(bgU.u_bgAngle, bg.angle != null ? bg.angle : 90)
      if(bgU.u_bgRadius) gl.uniform1f(bgU.u_bgRadius, bg.radius != null ? bg.radius : 0.7)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    for(const layer of layers){
      if(!layer || !layer.visible) continue
      if(layer.type === 'effect' && layer.scopedTo) continue // handled with their parent

      if(layer.type === 'effect'){
        // GLOBAL effect — applies to current accumulator
        const pp = runEffectPass(layer, time, mouse, read, write)
        read = pp.read; write = pp.write
      } else {
        // Sprite/shape/text.
        const scoped = scopedByUid.get(layer.uid) || []
        const blendMode = layer.blendMode || 'normal'
        const needsScratch = scoped.length > 0 || blendMode !== 'normal'

        if(!needsScratch){
          // Fast path — alpha-blend directly into read
          gl.bindFramebuffer(gl.FRAMEBUFFER, read.fbo)
          gl.viewport(0, 0, W, H)
          gl.enable(gl.BLEND)
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
          drawLayerOntoBound(layer)
          gl.disable(gl.BLEND)
        } else {
          // Render layer alone to fboD (transparent bg)
          gl.bindFramebuffer(gl.FRAMEBUFFER, fboD.fbo)
          gl.viewport(0, 0, W, H)
          gl.clearColor(0, 0, 0, 0)
          gl.clear(gl.COLOR_BUFFER_BIT)
          gl.enable(gl.BLEND)
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
          drawLayerOntoBound(layer)
          gl.disable(gl.BLEND)

          // Apply scoped effects by ping-pong on (fboD ↔ fboE)
          let r = fboD, w = fboE
          for(const fx of scoped){
            const pp = runEffectPass(fx, time, mouse, r, w)
            r = pp.read; w = pp.write
          }

          // Composite r onto read → write
          const blendMap = { normal:0, multiply:1, screen:2, overlay:3, softlight:4, darken:5, lighten:6, difference:7, exclusion:8, dodge:9, burn:10, add:11, subtract:12 }
          const modeNum = blendMap[blendMode] != null ? blendMap[blendMode] : 0
          gl.useProgram(compProg)
          gl.bindVertexArray(fsVAO)
          gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo)
          gl.viewport(0, 0, write.w, write.h)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, read.tex)
          if(compU.u_dst) gl.uniform1i(compU.u_dst, 0)
          gl.activeTexture(gl.TEXTURE1)
          gl.bindTexture(gl.TEXTURE_2D, r.tex)
          if(compU.u_src) gl.uniform1i(compU.u_src, 1)
          if(compU.u_blendMode) gl.uniform1f(compU.u_blendMode, modeNum)
          if(compU.u_opacity) gl.uniform1f(compU.u_opacity, 1.0)
          gl.drawArrays(gl.TRIANGLES, 0, 3)
          const t = read; read = write; write = t
        }
      }
    }

    // Final blit to screen
    blitFBO(read.tex, null, W, H)
  }

  return { gl, resize, uploadTexture, deleteTexture, registerEffect, render, get size(){ return { W, H } } }
}
