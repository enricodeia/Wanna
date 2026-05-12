// All effects: { id, label, group, fs, params }
// Each shader is HEADER + body. HEADER provides standard uniforms & helpers.

const HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform vec2 u_mouse;
uniform float u_time;
out vec4 o;

#define PI  3.14159265359
#define TAU 6.28318530718

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i=0;i<5;i++){ v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
mat2 rot(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }
vec2 sCenter(vec2 uv){ return uv - 0.5; }
`

// ============ DISTORT ============
const HALFTONE = `${HEADER}
uniform float u_scale, u_softness, u_angleC, u_angleM, u_angleY, u_angleK, u_mix, u_invert;
uniform vec3 u_paper;
float dg(vec2 uv, float a, float s){
  vec2 p = (uv - 0.5) * u_res;
  p = rot(a) * p;
  vec2 g = p / s;
  vec2 gf = g - (floor(g) + 0.5);
  return length(gf) * 2.0;
}
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 cmy = 1.0 - col;
  float k = min(cmy.r, min(cmy.g, cmy.b));
  cmy -= k;
  float soft = max(u_softness, 0.001);
  float dC = smoothstep(cmy.r - soft, cmy.r + soft, dg(v_uv, radians(u_angleC), u_scale));
  float dM = smoothstep(cmy.g - soft, cmy.g + soft, dg(v_uv, radians(u_angleM), u_scale));
  float dY = smoothstep(cmy.b - soft, cmy.b + soft, dg(v_uv, radians(u_angleY), u_scale));
  float dK = smoothstep(k     - soft, k     + soft, dg(v_uv, radians(u_angleK), u_scale));
  vec3 c = u_paper;
  c *= mix(vec3(1.0), vec3(0.10, 0.85, 1.00), 1.0 - dC);
  c *= mix(vec3(1.0), vec3(0.95, 0.10, 0.65), 1.0 - dM);
  c *= mix(vec3(1.0), vec3(1.00, 0.92, 0.05), 1.0 - dY);
  c *= mix(vec3(1.0), vec3(0.05, 0.05, 0.07), 1.0 - dK);
  if(u_invert > 0.5) c = 1.0 - c;
  o = vec4(mix(col, c, u_mix), 1.0);
}`

const ASCII = `${HEADER}
uniform float u_cell, u_charset, u_invert, u_mix;
uniform vec3 u_fg, u_bg;
float charBit(int idx, int x, int y){
  int bits = 0;
  if(idx == 0) bits = 0;
  else if(idx == 1){ if(x==2 && y==4) bits=1; }
  else if(idx == 2){ if(x==2 && (y==1||y==3)) bits=1; }
  else if(idx == 3){ if(y==2 && x>0 && x<4) bits=1; }
  else if(idx == 4){ if((y==2 && x>0 && x<4) || (x==2 && y>0 && y<4)) bits=1; }
  else if(idx == 5){ if((y==1 || y==3) && x>0 && x<4) bits=1; }
  else if(idx == 6){ if((x==1 || x==3) || (y==1 || y==3)) bits=1; }
  else if(idx == 7){
    if(x==0 || x==4 || y==0 || y==4) bits=1;
    if(x==2 && y==2) bits=1;
    if((x==1||x==3) && (y==1||y==3)) bits=1;
  }
  return float(bits);
}
void main(){
  vec2 cell = vec2(u_cell);
  vec2 c = floor(v_uv * u_res / cell) * cell + cell * 0.5;
  vec3 col = texture(u_tex, c / u_res).rgb;
  float l = luma(col);
  if(u_invert > 0.5) l = 1.0 - l;
  int n = int(clamp(u_charset, 2.0, 8.0));
  int idx = int(floor(l * float(n - 1) + 0.5));
  vec2 inCell = floor((v_uv * u_res - (c - cell*0.5)) / (cell / 5.0));
  inCell = clamp(inCell, vec2(0.0), vec2(4.0));
  float m = charBit(idx, int(inCell.x), int(inCell.y));
  o = vec4(mix(col, mix(u_bg, u_fg, m), u_mix), 1.0);
}`

const DITHER = `${HEADER}
uniform float u_levels, u_scale, u_mix, u_mono;
uniform vec3 u_a, u_b;
float bayer8(int x, int y){
  int m[64];
  m[0]=0;  m[1]=32; m[2]=8;  m[3]=40; m[4]=2;  m[5]=34; m[6]=10; m[7]=42;
  m[8]=48; m[9]=16; m[10]=56;m[11]=24;m[12]=50;m[13]=18;m[14]=58;m[15]=26;
  m[16]=12;m[17]=44;m[18]=4; m[19]=36;m[20]=14;m[21]=46;m[22]=6; m[23]=38;
  m[24]=60;m[25]=28;m[26]=52;m[27]=20;m[28]=62;m[29]=30;m[30]=54;m[31]=22;
  m[32]=3; m[33]=35;m[34]=11;m[35]=43;m[36]=1; m[37]=33;m[38]=9; m[39]=41;
  m[40]=51;m[41]=19;m[42]=59;m[43]=27;m[44]=49;m[45]=17;m[46]=57;m[47]=25;
  m[48]=15;m[49]=47;m[50]=7; m[51]=39;m[52]=13;m[53]=45;m[54]=5; m[55]=37;
  m[56]=63;m[57]=31;m[58]=55;m[59]=23;m[60]=61;m[61]=29;m[62]=53;m[63]=21;
  return float(m[(y & 7) * 8 + (x & 7)]) / 64.0;
}
void main(){
  vec2 px = floor(v_uv * u_res / u_scale);
  vec3 col = texture(u_tex, (px * u_scale + u_scale*0.5) / u_res).rgb;
  float t = bayer8(int(mod(px.x, 8.0)), int(mod(px.y, 8.0))) - 0.5;
  vec3 res;
  if(u_mono > 0.5){
    float l = luma(col) + t / max(u_levels, 1.0);
    float q = floor(l * (u_levels - 1.0) + 0.5) / max(u_levels - 1.0, 1.0);
    res = mix(u_a, u_b, clamp(q, 0.0, 1.0));
  } else {
    vec3 d = col + t / max(u_levels, 1.0);
    res = clamp(floor(d * (u_levels - 1.0) + 0.5) / max(u_levels - 1.0, 1.0), 0.0, 1.0);
  }
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const RGB_SPLIT = `${HEADER}
uniform float u_amount, u_angle, u_radial, u_mix;
void main(){
  vec2 dir = vec2(cos(radians(u_angle)), sin(radians(u_angle)));
  float rad = mix(1.0, length(sCenter(v_uv)) * 2.0, u_radial);
  vec2 off = dir * u_amount * rad * 0.05;
  float r = texture(u_tex, v_uv + off).r;
  float g = texture(u_tex, v_uv).g;
  float b = texture(u_tex, v_uv - off).b;
  vec3 base = texture(u_tex, v_uv).rgb;
  o = vec4(mix(base, vec3(r,g,b), u_mix), 1.0);
}`

const LIQUIFY = `${HEADER}
uniform float u_amount, u_scale, u_speed, u_swirl, u_mix;
void main(){
  vec2 p = v_uv * u_scale;
  float t = u_time * u_speed;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) + t));
  vec2 r = vec2(fbm(p + 4.0*q + vec2(1.7, 9.2)), fbm(p + 4.0*q + vec2(8.3, 2.8)));
  vec2 disp = (r - 0.5);
  vec2 c = sCenter(v_uv);
  disp += vec2(-c.y, c.x) * u_swirl;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, v_uv + disp * u_amount).rgb, u_mix), 1.0);
}`

const WAVE = `${HEADER}
uniform float u_freqX, u_freqY, u_ampX, u_ampY, u_phase, u_mix;
void main(){
  vec2 uv = v_uv;
  uv.x += sin(uv.y * u_freqY * TAU + u_phase) * u_ampX * 0.1;
  uv.y += sin(uv.x * u_freqX * TAU + u_phase * 1.3) * u_ampY * 0.1;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const KALEIDO = `${HEADER}
uniform float u_segments, u_angle, u_zoom, u_mix;
void main(){
  vec2 p = sCenter(v_uv);
  float r = length(p);
  float a = atan(p.y, p.x) + radians(u_angle);
  float seg = TAU / max(u_segments, 1.0);
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 uv = vec2(cos(a), sin(a)) * r * u_zoom + 0.5;
  uv = fract(uv);
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const TWIRL = `${HEADER}
uniform float u_amount, u_radius, u_mix;
void main(){
  vec2 p = sCenter(v_uv);
  float r = length(p);
  float falloff = smoothstep(u_radius, 0.0, r);
  float a = atan(p.y, p.x) + u_amount * falloff;
  vec2 uv = vec2(cos(a), sin(a)) * r + 0.5;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const BULGE = `${HEADER}
uniform float u_amount, u_radius, u_mix;
void main(){
  vec2 p = sCenter(v_uv);
  float r = length(p);
  float f = smoothstep(u_radius, 0.0, r);
  float scale = 1.0 - u_amount * f;
  vec2 uv = p * scale + 0.5;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const RIPPLE = `${HEADER}
uniform float u_freq, u_amp, u_speed, u_center, u_mix;
void main(){
  vec2 p = sCenter(v_uv);
  float r = length(p);
  float w = sin(r * u_freq * TAU - u_time * u_speed) * u_amp * smoothstep(0.0, u_center, r);
  vec2 uv = v_uv + p / max(r, 0.001) * w;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const POLAR = `${HEADER}
uniform float u_zoom, u_twist, u_mode, u_mix;
void main(){
  vec2 uv = v_uv;
  vec2 c = sCenter(uv);
  if(u_mode < 0.5){
    float r = length(c) * 2.0;
    float a = atan(c.y, c.x) / TAU + 0.5;
    a += r * u_twist;
    uv = fract(vec2(a, r * u_zoom));
  } else {
    float a = (uv.x - 0.5) * TAU + u_twist;
    float r = uv.y * u_zoom;
    uv = fract(vec2(cos(a), sin(a)) * r * 0.5 + 0.5);
  }
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const MIRROR = `${HEADER}
uniform float u_modeX, u_modeY, u_offset, u_mix;
void main(){
  vec2 uv = v_uv;
  if(u_modeX > 0.5){
    uv.x = abs(uv.x - 0.5) + 0.5 * u_offset;
  }
  if(u_modeY > 0.5){
    uv.y = abs(uv.y - 0.5) + 0.5 * u_offset;
  }
  uv = fract(uv);
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const SLITSCAN = `${HEADER}
uniform float u_amp, u_freq, u_mode, u_mix;
void main(){
  vec2 uv = v_uv;
  if(u_mode < 0.5){
    float l = luma(texture(u_tex, vec2(0.5, uv.y)).rgb);
    uv.x += (l - 0.5) * u_amp;
  } else {
    uv.x += sin(uv.y * u_freq * TAU) * u_amp;
  }
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const SMEAR = `${HEADER}
uniform float u_angle, u_length, u_thresh, u_mix;
void main(){
  vec2 dir = vec2(cos(radians(u_angle)), sin(radians(u_angle)));
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for(int i = 0; i < 32; i++){
    float f = float(i) / 31.0;
    vec2 uv = v_uv - dir * f * u_length;
    vec3 s = texture(u_tex, uv).rgb;
    float w = step(u_thresh, luma(s));
    sum += s * w;
    n += w;
  }
  vec3 res = n > 0.0 ? sum / n : texture(u_tex, v_uv).rgb;
  o = vec4(mix(texture(u_tex, v_uv).rgb, res, u_mix), 1.0);
}`

const GLASS = `${HEADER}
uniform float u_scale, u_amount, u_mix;
void main(){
  vec2 n = vec2(noise(v_uv * u_scale), noise(v_uv * u_scale + 100.0)) - 0.5;
  vec3 col = texture(u_tex, v_uv + n * u_amount).rgb;
  o = vec4(mix(texture(u_tex, v_uv).rgb, col, u_mix), 1.0);
}`

const FISHEYE = `${HEADER}
uniform float u_amount, u_mix;
void main(){
  vec2 p = sCenter(v_uv);
  float r = length(p) * 2.0;
  float r2 = r + u_amount * r * (1.0 - r);
  vec2 uv = p * (r2 / max(r, 0.001)) * 0.5 + 0.5;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

// ============ PRINT / PATTERN ============
const PIXELATE = `${HEADER}
uniform float u_size, u_circles, u_mix;
void main(){
  float s = max(u_size, 1.0);
  vec2 cell = floor(v_uv * u_res / s);
  vec2 c = (cell + 0.5) * s / u_res;
  vec3 col = texture(u_tex, c).rgb;
  vec3 base = texture(u_tex, v_uv).rgb;
  vec3 res = col;
  if(u_circles > 0.5){
    vec2 f = fract(v_uv * u_res / s) - 0.5;
    float l = luma(col);
    float d = length(f) * 2.0;
    float m = smoothstep(l + 0.05, l - 0.05, d);
    res = mix(vec3(1.0), col, m);
  }
  o = vec4(mix(base, res, u_mix), 1.0);
}`

const HEX_PIXELATE = `${HEADER}
uniform float u_size, u_mix;
void main(){
  vec2 r = vec2(1.0, 1.732);
  vec2 h = r * 0.5;
  vec2 uv = v_uv * u_res / u_size;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv + h, r) - h;
  vec2 gv = length(a) < length(b) ? a : b;
  vec2 center = (uv - gv) * u_size / u_res;
  vec3 col = texture(u_tex, center).rgb;
  o = vec4(mix(texture(u_tex, v_uv).rgb, col, u_mix), 1.0);
}`

const VORONOI = `${HEADER}
uniform float u_scale, u_jitter, u_edges, u_mix;
void main(){
  vec2 p = v_uv * u_scale;
  vec2 gi = floor(p);
  float minD = 1e9;
  vec2 minPt = vec2(0.0);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 n = vec2(float(x), float(y));
    vec2 g = gi + n;
    vec2 pt = g + vec2(hash(g), hash(g + 17.13)) * u_jitter;
    float d = distance(p, pt);
    if(d < minD){ minD = d; minPt = pt; }
  }
  vec3 col = texture(u_tex, minPt / u_scale).rgb;
  float edge = smoothstep(0.0, u_edges, minD - 0.05);
  o = vec4(mix(texture(u_tex, v_uv).rgb, mix(vec3(0.0), col, edge), u_mix), 1.0);
}`

const HATCH = `${HEADER}
uniform float u_density, u_angle, u_thickness, u_layers, u_mix;
uniform vec3 u_ink, u_paper;
float line(vec2 uv, float a, float density, float thick){
  vec2 p = (uv - 0.5) * u_res;
  p = rot(radians(a)) * p;
  return smoothstep(thick, thick + 0.05, abs(sin(p.x * density * 0.05)));
}
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  float ink = 1.0;
  int n = int(clamp(u_layers, 1.0, 4.0));
  float steps[4]; steps[0]=0.75; steps[1]=0.55; steps[2]=0.35; steps[3]=0.15;
  for(int i=0;i<4;i++){
    if(i >= n) break;
    if(l < steps[i]) ink = min(ink, line(v_uv, u_angle + float(i)*45.0, u_density, u_thickness));
  }
  o = vec4(mix(col, mix(u_ink, u_paper, ink), u_mix), 1.0);
}`

const STRIPES = `${HEADER}
uniform float u_density, u_angle, u_modulation, u_mix;
uniform vec3 u_ink, u_paper;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec2 p = (v_uv - 0.5) * u_res;
  p = rot(radians(u_angle)) * p;
  float band = mod(p.y, u_density) / u_density;
  float mask = step(band, mix(0.5, l, u_modulation));
  o = vec4(mix(col, mix(u_ink, u_paper, mask), u_mix), 1.0);
}`

const CIRCLES_PATTERN = `${HEADER}
uniform float u_density, u_thickness, u_mix;
uniform vec3 u_ink, u_paper;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec2 p = (v_uv - 0.5) * 2.0;
  float r = length(p);
  float w = abs(sin(r * u_density * TAU)) ;
  float mask = step(w, mix(0.5, l, 1.0) * u_thickness);
  o = vec4(mix(col, mix(u_ink, u_paper, mask), u_mix), 1.0);
}`

const CONCENTRIC = `${HEADER}
uniform float u_count, u_thickness, u_mix;
uniform vec3 u_ink, u_paper;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec2 p = sCenter(v_uv);
  float r = length(p) * 2.0;
  float ring = mod(r * u_count, 1.0);
  float mask = step(u_thickness, ring);
  o = vec4(mix(col, mix(u_ink, u_paper, mask), u_mix), 1.0);
}`

const EDGES = `${HEADER}
uniform float u_strength, u_thresh, u_mix;
uniform vec3 u_ink, u_paper;
void main(){
  vec2 px = 1.0 / u_res;
  float tl = luma(texture(u_tex, v_uv + vec2(-px.x, -px.y)).rgb);
  float t  = luma(texture(u_tex, v_uv + vec2(0.0,   -px.y)).rgb);
  float tr = luma(texture(u_tex, v_uv + vec2( px.x, -px.y)).rgb);
  float l  = luma(texture(u_tex, v_uv + vec2(-px.x, 0.0)).rgb);
  float r  = luma(texture(u_tex, v_uv + vec2( px.x, 0.0)).rgb);
  float bl = luma(texture(u_tex, v_uv + vec2(-px.x,  px.y)).rgb);
  float b  = luma(texture(u_tex, v_uv + vec2(0.0,    px.y)).rgb);
  float br = luma(texture(u_tex, v_uv + vec2( px.x,  px.y)).rgb);
  float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
  float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
  float g = length(vec2(gx, gy)) * u_strength;
  float m = smoothstep(u_thresh, u_thresh + 0.05, g);
  o = vec4(mix(texture(u_tex, v_uv).rgb, mix(u_paper, u_ink, m), u_mix), 1.0);
}`

const EMBOSS = `${HEADER}
uniform float u_strength, u_angle, u_mix;
void main(){
  vec2 dir = vec2(cos(radians(u_angle)), sin(radians(u_angle))) / u_res;
  float a = luma(texture(u_tex, v_uv - dir).rgb);
  float b = luma(texture(u_tex, v_uv + dir).rgb);
  float d = (a - b) * u_strength;
  vec3 res = vec3(0.5 + d);
  o = vec4(mix(texture(u_tex, v_uv).rgb, res, u_mix), 1.0);
}`

// ============ COLOR ============
const POSTERIZE = `${HEADER}
uniform float u_levels, u_thresh, u_mode, u_mix;
uniform vec3 u_a, u_b;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 res;
  if(u_mode < 0.5){
    res = floor(col * u_levels) / max(u_levels - 1.0, 1.0);
  } else {
    res = luma(col) > u_thresh ? u_b : u_a;
  }
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const DUOTONE = `${HEADER}
uniform vec3 u_a, u_b;
uniform float u_contrast, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = clamp((luma(col) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  o = vec4(mix(col, mix(u_a, u_b, l), u_mix), 1.0);
}`

const TRIDONE = `${HEADER}
uniform vec3 u_a, u_b, u_c;
uniform float u_mid, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec3 res = l < u_mid
    ? mix(u_a, u_b, l / max(u_mid, 0.001))
    : mix(u_b, u_c, (l - u_mid) / max(1.0 - u_mid, 0.001));
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const GRAIN = `${HEADER}
uniform float u_amount, u_size, u_mono, u_mix;
void main(){
  vec2 p = floor(v_uv * u_res / max(u_size, 1.0));
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 res = col;
  if(u_mono > 0.5){
    float n = hash(p + u_time) - 0.5;
    res += n * u_amount;
  } else {
    vec3 n = vec3(hash(p + 1.0 + u_time), hash(p + 2.0 + u_time), hash(p + 3.0 + u_time)) - 0.5;
    res += n * u_amount;
  }
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const COLORSHIFT = `${HEADER}
uniform float u_hue, u_sat, u_val, u_invert, u_mix;
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 hsv = rgb2hsv(col);
  hsv.x = fract(hsv.x + u_hue);
  hsv.y = clamp(hsv.y * u_sat, 0.0, 1.0);
  hsv.z = clamp(hsv.z * u_val, 0.0, 1.0);
  vec3 res = hsv2rgb(hsv);
  if(u_invert > 0.5) res = 1.0 - res;
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const SEPIA = `${HEADER}
uniform float u_amount, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 s = vec3(
    dot(col, vec3(0.393, 0.769, 0.189)),
    dot(col, vec3(0.349, 0.686, 0.168)),
    dot(col, vec3(0.272, 0.534, 0.131))
  );
  vec3 res = mix(col, clamp(s, 0.0, 1.0), u_amount);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const SOLARIZE = `${HEADER}
uniform float u_thresh, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 res = mix(col, 1.0 - col, step(u_thresh, col));
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const HEATMAP = `${HEADER}
uniform float u_contrast, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = clamp((luma(col) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  vec3 cold = vec3(0.0, 0.02, 0.25);
  vec3 cool = vec3(0.0, 0.55, 0.95);
  vec3 mid  = vec3(0.95, 0.95, 0.1);
  vec3 hot  = vec3(0.95, 0.05, 0.0);
  vec3 res;
  if(l < 0.33) res = mix(cold, cool, l / 0.33);
  else if(l < 0.66) res = mix(cool, mid, (l - 0.33) / 0.33);
  else res = mix(mid, hot, (l - 0.66) / 0.34);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const LEVELS = `${HEADER}
uniform float u_inMin, u_inMax, u_gamma, u_outMin, u_outMax, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 c = clamp((col - u_inMin) / max(u_inMax - u_inMin, 0.001), 0.0, 1.0);
  c = pow(c, vec3(1.0 / max(u_gamma, 0.01)));
  vec3 res = mix(vec3(u_outMin), vec3(u_outMax), c);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const VIGNETTE = `${HEADER}
uniform float u_inner, u_outer, u_mix;
uniform vec3 u_color;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float r = length(sCenter(v_uv)) * 1.414;
  float v = smoothstep(u_inner, u_outer, r);
  vec3 res = mix(col, u_color, v);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

// ============ FOCUS ============
const BLUR = `${HEADER}
uniform float u_radius, u_mix;
void main(){
  vec2 px = u_radius / u_res;
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for(int y=-3;y<=3;y++) for(int x=-3;x<=3;x++){
    vec2 d = vec2(float(x), float(y));
    float w = exp(-dot(d, d) * 0.2);
    sum += texture(u_tex, v_uv + d * px).rgb * w;
    n += w;
  }
  o = vec4(mix(texture(u_tex, v_uv).rgb, sum / n, u_mix), 1.0);
}`

const SHARPEN = `${HEADER}
uniform float u_amount, u_mix;
void main(){
  vec2 px = 1.0 / u_res;
  vec3 c = texture(u_tex, v_uv).rgb;
  vec3 t = texture(u_tex, v_uv + vec2(0, -px.y)).rgb;
  vec3 b = texture(u_tex, v_uv + vec2(0,  px.y)).rgb;
  vec3 l = texture(u_tex, v_uv + vec2(-px.x, 0)).rgb;
  vec3 r = texture(u_tex, v_uv + vec2( px.x, 0)).rgb;
  vec3 sharp = clamp(c + (c * 4.0 - t - b - l - r) * u_amount, 0.0, 1.0);
  o = vec4(mix(c, sharp, u_mix), 1.0);
}`

const BLOOM = `${HEADER}
uniform float u_thresh, u_radius, u_intensity, u_mix;
void main(){
  vec2 px = u_radius / u_res;
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for(int y=-3;y<=3;y++) for(int x=-3;x<=3;x++){
    vec2 d = vec2(float(x), float(y));
    float w = exp(-dot(d, d) * 0.18);
    vec3 s = texture(u_tex, v_uv + d * px).rgb;
    s *= step(u_thresh, luma(s));
    sum += s * w;
    n += w;
  }
  vec3 base = texture(u_tex, v_uv).rgb;
  vec3 res = base + (sum / n) * u_intensity;
  o = vec4(mix(base, res, u_mix), 1.0);
}`

// ============ GLITCH ============
const PIXEL_SORT = `${HEADER}
uniform float u_thresh, u_length, u_seed, u_mix;
void main(){
  float row = floor(v_uv.y * u_res.y);
  float h = hash(vec2(row, floor(u_seed * 100.0)));
  float key = luma(texture(u_tex, vec2(h, v_uv.y)).rgb);
  vec2 sortUV = v_uv;
  if(key > u_thresh) sortUV.x = mix(v_uv.x, h, u_length);
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, sortUV).rgb, u_mix), 1.0);
}`

const GLITCH = `${HEADER}
uniform float u_amount, u_blocks, u_speed, u_chroma, u_mix;
void main(){
  float t = floor(u_time * u_speed * 4.0);
  float band = floor(v_uv.y * u_blocks);
  float h = hash(vec2(band, t));
  float h2 = hash(vec2(band + 23.0, t));
  vec2 uv = v_uv;
  if(h > 0.6) uv.x += (h2 - 0.5) * u_amount;
  vec2 ch = vec2(u_chroma * 0.02, 0.0);
  float r = texture(u_tex, uv + ch).r;
  float g = texture(u_tex, uv).g;
  float b = texture(u_tex, uv - ch).b;
  o = vec4(mix(texture(u_tex, v_uv).rgb, vec3(r,g,b), u_mix), 1.0);
}`

const ANAGLYPH = `${HEADER}
uniform float u_amount, u_angle, u_mix;
void main(){
  vec2 off = vec2(cos(radians(u_angle)), sin(radians(u_angle))) * u_amount;
  float r = texture(u_tex, v_uv + off).r;
  vec2 gb = texture(u_tex, v_uv - off).gb;
  vec3 res = vec3(r, gb);
  o = vec4(mix(texture(u_tex, v_uv).rgb, res, u_mix), 1.0);
}`

const CRT = `${HEADER}
uniform float u_curve, u_scanline, u_brightness, u_mix;
void main(){
  vec2 uv = v_uv;
  vec2 c = sCenter(uv);
  uv += c * dot(c, c) * u_curve;
  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){ o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 col = texture(u_tex, uv).rgb * u_brightness;
  float scan = sin(uv.y * u_res.y * 1.2) * 0.5 + 0.5;
  vec3 res = col * mix(1.0, scan, u_scanline);
  o = vec4(mix(texture(u_tex, v_uv).rgb, res, u_mix), 1.0);
}`

const SCANLINES = `${HEADER}
uniform float u_freq, u_strength, u_angle, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec2 p = (v_uv - 0.5) * u_res;
  p = rot(radians(u_angle)) * p;
  float s = sin(p.y * u_freq * 0.1) * 0.5 + 0.5;
  vec3 res = col * mix(1.0, s, u_strength);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const NOISE_WARP = `${HEADER}
uniform float u_amount, u_scale, u_speed, u_mix;
void main(){
  vec2 p = v_uv * u_scale;
  float n1 = noise(p + u_time * u_speed);
  float n2 = noise(p + vec2(31.7, 17.3) + u_time * u_speed);
  vec2 d = (vec2(n1, n2) - 0.5) * u_amount;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, v_uv + d).rgb, u_mix), 1.0);
}`

// ============ INTERACT (cursor-driven) ============
// All cursor effects derive a soft circular mask around u_mouse and apply
// their transformation only inside the mask. u_mouse is in 0..1 canvas coords
// where (0,0) = top-left, (1,1) = bottom-right (already flipped to v_uv space).

const CURSOR_LENS = `${HEADER}
uniform float u_radius, u_strength, u_softness, u_mix;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  vec2 d = (v_uv - u_mouse) * ar;
  float dist = length(d);
  float falloff = 1.0 - smoothstep(u_radius * (1.0 - u_softness), u_radius, dist);
  vec2 uv = u_mouse + (v_uv - u_mouse) / (1.0 + u_strength * falloff);
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 lensCol = texture(u_tex, uv).rgb;
  o = vec4(mix(col, lensCol, falloff * u_mix), 1.0);
}`

const CURSOR_SPOTLIGHT = `${HEADER}
uniform float u_radius, u_softness, u_dim, u_mix;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  vec2 d = (v_uv - u_mouse) * ar;
  float mask = 1.0 - smoothstep(u_radius * (1.0 - u_softness), u_radius, length(d));
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 darkened = col * u_dim;
  o = vec4(mix(darkened, col, mask * u_mix + (1.0 - u_mix)), 1.0);
}`

const CURSOR_RIPPLE = `${HEADER}
uniform float u_radius, u_freq, u_amp, u_speed, u_mix;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  vec2 d = (v_uv - u_mouse) * ar;
  float dist = length(d);
  float falloff = 1.0 - smoothstep(u_radius, 0.0, dist);
  falloff = 1.0 - falloff;
  float w = sin(dist * u_freq * TAU - u_time * u_speed) * u_amp * falloff;
  vec2 dir = d / max(dist, 0.001);
  vec2 uv = v_uv + dir / ar * w;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const CURSOR_PIXEL = `${HEADER}
uniform float u_radius, u_size, u_softness, u_mix;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  float mask = 1.0 - smoothstep(u_radius * (1.0 - u_softness), u_radius, length((v_uv - u_mouse) * ar));
  float s = max(u_size, 1.0);
  vec2 cell = floor(v_uv * u_res / s);
  vec2 c = (cell + 0.5) * s / u_res;
  vec3 px = texture(u_tex, c).rgb;
  vec3 col = texture(u_tex, v_uv).rgb;
  o = vec4(mix(col, px, mask * u_mix), 1.0);
}`

const CURSOR_DISTORT = `${HEADER}
uniform float u_radius, u_strength, u_mix;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  vec2 d = (v_uv - u_mouse) * ar;
  float dist = length(d);
  float falloff = 1.0 - smoothstep(0.0, u_radius, dist);
  vec2 uv = v_uv + (d / ar) * u_strength * falloff;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const CURSOR_INVERT = `${HEADER}
uniform float u_radius, u_softness, u_hueShift, u_mix;
vec3 hueRot(vec3 c, float a){
  const mat3 RGB2YIQ = mat3(0.299,0.596,0.211, 0.587,-0.274,-0.523, 0.114,-0.322,0.312);
  const mat3 YIQ2RGB = mat3(1.0,1.0,1.0, 0.956,-0.272,-1.106, 0.621,-0.647,1.703);
  vec3 yiq = RGB2YIQ * c;
  float cs = cos(a), sn = sin(a);
  yiq.yz = mat2(cs, -sn, sn, cs) * yiq.yz;
  return YIQ2RGB * yiq;
}
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  float mask = 1.0 - smoothstep(u_radius * (1.0 - u_softness), u_radius, length((v_uv - u_mouse) * ar));
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 inv = 1.0 - col;
  inv = hueRot(inv, u_hueShift * TAU);
  o = vec4(mix(col, inv, mask * u_mix), 1.0);
}`

const CURSOR_GLOW = `${HEADER}
uniform float u_radius, u_intensity, u_softness, u_mix;
uniform vec3 u_color;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  float dist = length((v_uv - u_mouse) * ar);
  float halo = exp(-dist * dist / max(u_radius * u_radius, 0.001)) * u_intensity;
  float ring = smoothstep(u_radius, u_radius * (1.0 - u_softness), dist) * (1.0 - smoothstep(u_radius * (1.0 - u_softness * 2.0), u_radius * (1.0 - u_softness), dist));
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 res = col + u_color * (halo + ring * u_intensity * 0.5);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const CURSOR_HALFTONE = `${HEADER}
uniform float u_radius, u_scale, u_softness, u_mix;
uniform vec3 u_ink, u_paper;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  float mask = 1.0 - smoothstep(u_radius * (1.0 - u_softness), u_radius, length((v_uv - u_mouse) * ar));
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec2 p = (v_uv - 0.5) * u_res;
  vec2 g = p / u_scale;
  vec2 gf = g - (floor(g) + 0.5);
  float dot = length(gf) * 2.0;
  float ht = smoothstep(1.0 - l - 0.05, 1.0 - l + 0.05, dot);
  vec3 res = mix(u_ink, u_paper, ht);
  o = vec4(mix(col, res, mask * u_mix), 1.0);
}`

// ============ NEW DISTORT ============
const SWIRL = `${HEADER}
uniform float u_amount, u_radius, u_mix;
void main(){
  vec2 p = sCenter(v_uv);
  float r = length(p);
  float falloff = smoothstep(u_radius, 0.0, r);
  float a = atan(p.y, p.x) + u_amount * falloff;
  vec2 uv = vec2(cos(a), sin(a)) * r + 0.5;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const ZIGZAG = `${HEADER}
uniform float u_freq, u_amp, u_axis, u_mix;
void main(){
  vec2 uv = v_uv;
  float zig = abs(fract((u_axis < 0.5 ? uv.y : uv.x) * u_freq) - 0.5) * 4.0 - 1.0;
  if(u_axis < 0.5) uv.x += zig * u_amp;
  else             uv.y += zig * u_amp;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const PERSPECTIVE = `${HEADER}
uniform float u_topScale, u_bottomScale, u_skewX, u_mix;
void main(){
  vec2 uv = v_uv;
  float scale = mix(u_topScale, u_bottomScale, uv.y);
  uv.x = (uv.x - 0.5) / max(scale, 0.05) + 0.5 + u_skewX * (uv.y - 0.5);
  if(uv.x < 0.0 || uv.x > 1.0){ o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const SHEAR = `${HEADER}
uniform float u_shearX, u_shearY, u_mix;
void main(){
  vec2 uv = v_uv;
  uv.x += (uv.y - 0.5) * u_shearX;
  uv.y += (uv.x - 0.5) * u_shearY;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const SQUEEZE = `${HEADER}
uniform float u_amountX, u_amountY, u_mix;
void main(){
  vec2 p = sCenter(v_uv);
  p.x *= 1.0 + u_amountX * (1.0 - abs(p.y * 2.0));
  p.y *= 1.0 + u_amountY * (1.0 - abs(p.x * 2.0));
  vec2 uv = p + 0.5;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const BARREL = `${HEADER}
uniform float u_amount, u_mix;
void main(){
  vec2 p = sCenter(v_uv);
  float r2 = dot(p, p);
  vec2 uv = p * (1.0 + u_amount * r2) + 0.5;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const ECHO = `${HEADER}
uniform float u_offset, u_count, u_decay, u_angle, u_mix;
void main(){
  vec3 base = texture(u_tex, v_uv).rgb;
  vec3 acc = base;
  float wTotal = 1.0;
  vec2 dir = vec2(cos(radians(u_angle)), sin(radians(u_angle)));
  int n = int(clamp(u_count, 1.0, 8.0));
  for(int i = 1; i <= 8; i++){
    if(i > n) break;
    float w = pow(u_decay, float(i));
    acc += texture(u_tex, v_uv - dir * u_offset * float(i)).rgb * w;
    wTotal += w;
  }
  acc /= wTotal;
  o = vec4(mix(base, acc, u_mix), 1.0);
}`

const ROLL = `${HEADER}
uniform float u_offsetX, u_offsetY, u_mix;
void main(){
  vec2 uv = fract(v_uv + vec2(u_offsetX, u_offsetY));
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

// ============ NEW PATTERN ============
const DOTS_GRID = `${HEADER}
uniform float u_density, u_size, u_invert, u_mix;
uniform vec3 u_ink, u_paper;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec2 g = v_uv * u_density;
  vec2 gf = fract(g) - 0.5;
  float r = length(gf) * 2.0;
  float thresh = u_invert > 0.5 ? l : (1.0 - l);
  float dot = step(r, u_size * thresh);
  vec3 res = mix(u_paper, u_ink, dot);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const CHECKERBOARD = `${HEADER}
uniform float u_count, u_modulation, u_mix;
uniform vec3 u_a, u_b;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec2 g = floor(v_uv * u_count);
  float c = mod(g.x + g.y, 2.0);
  vec3 p = mix(u_a, u_b, c);
  vec3 res = mix(p, col, u_modulation);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const TRIANGLES = `${HEADER}
uniform float u_density, u_modulation, u_mix;
uniform vec3 u_ink, u_paper;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec2 g = v_uv * u_density;
  vec2 gf = fract(g);
  vec2 gi = floor(g);
  float tri = step(gf.x + gf.y, mix(0.5, l + 0.5, u_modulation));
  if(mod(gi.x + gi.y, 2.0) > 0.5) tri = 1.0 - tri;
  o = vec4(mix(col, mix(u_paper, u_ink, tri), u_mix), 1.0);
}`

const DIAMONDS = `${HEADER}
uniform float u_density, u_size, u_mix;
uniform vec3 u_ink, u_paper;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec2 g = v_uv * u_density;
  vec2 gf = fract(g) - 0.5;
  float d = abs(gf.x) + abs(gf.y);
  float diamond = step(d, u_size * (1.0 - l));
  vec3 res = mix(u_paper, u_ink, diamond);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const CROSSES = `${HEADER}
uniform float u_density, u_thickness, u_mix;
uniform vec3 u_ink, u_paper;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec2 g = v_uv * u_density;
  vec2 gf = fract(g) - 0.5;
  float arm = u_thickness * (1.0 - l) * 0.5;
  float cross = max(step(abs(gf.x), arm), step(abs(gf.y), arm));
  o = vec4(mix(col, mix(u_paper, u_ink, cross), u_mix), 1.0);
}`

const WEAVE = `${HEADER}
uniform float u_density, u_modulation, u_mix;
uniform vec3 u_ink, u_paper;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec2 g = v_uv * u_density;
  vec2 gf = fract(g);
  vec2 gi = floor(g);
  float horizontal = step(0.5, gf.y) * (1.0 - step(mod(gi.x + gi.y, 2.0), 0.5));
  float vertical   = step(0.5, gf.x) * step(mod(gi.x + gi.y, 2.0), 0.5);
  float w = max(horizontal, vertical);
  w = mix(w, w * l, u_modulation);
  o = vec4(mix(col, mix(u_paper, u_ink, w), u_mix), 1.0);
}`

// ============ NEW COLOR ============
const TINT = `${HEADER}
uniform vec3 u_tint;
uniform float u_amount, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 res = mix(col, col * u_tint, u_amount);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const GRADIENT_MAP = `${HEADER}
uniform vec3 u_a, u_b, u_c;
uniform float u_mid, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec3 res = l < u_mid
    ? mix(u_a, u_b, l / max(u_mid, 0.001))
    : mix(u_b, u_c, (l - u_mid) / max(1.0 - u_mid, 0.001));
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const CHANNEL_SHIFT = `${HEADER}
uniform float u_rOffset, u_gOffset, u_bOffset, u_angle, u_mix;
void main(){
  vec2 dir = vec2(cos(radians(u_angle)), sin(radians(u_angle)));
  float r = texture(u_tex, v_uv + dir * u_rOffset).r;
  float g = texture(u_tex, v_uv + dir * u_gOffset).g;
  float b = texture(u_tex, v_uv + dir * u_bOffset).b;
  vec3 base = texture(u_tex, v_uv).rgb;
  o = vec4(mix(base, vec3(r, g, b), u_mix), 1.0);
}`

const CROSS_PROCESS = `${HEADER}
uniform float u_amount, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 res = col;
  res.r = res.r < 0.5 ? 2.0 * res.r * res.r : 1.0 - 2.0 * (1.0 - res.r) * (1.0 - res.r);
  res.g = res.g < 0.5 ? 2.0 * res.g * res.g : 1.0 - 2.0 * (1.0 - res.g) * (1.0 - res.g);
  res.b = pow(res.b, 1.4);
  o = vec4(mix(col, res, u_amount * u_mix), 1.0);
}`

const VINTAGE = `${HEADER}
uniform float u_amount, u_warmth, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 sepia = vec3(
    dot(col, vec3(0.393, 0.769, 0.189)),
    dot(col, vec3(0.349, 0.686, 0.168)),
    dot(col, vec3(0.272, 0.534, 0.131))
  );
  vec3 warm = sepia * vec3(1.05, 0.95, 0.85 - u_warmth * 0.2);
  float vig = 1.0 - smoothstep(0.4, 1.1, length(sCenter(v_uv)));
  warm *= mix(1.0, vig, 0.5);
  o = vec4(mix(col, warm, u_amount * u_mix), 1.0);
}`

const TEAL_ORANGE = `${HEADER}
uniform float u_amount, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec3 shadow = vec3(0.05, 0.20, 0.30);
  vec3 highlight = vec3(1.0, 0.62, 0.30);
  vec3 graded = mix(col + shadow * 0.3, col + highlight * 0.3, smoothstep(0.3, 0.7, l));
  o = vec4(mix(col, clamp(graded, 0.0, 1.0), u_amount * u_mix), 1.0);
}`

const CONTRAST_CURVE = `${HEADER}
uniform float u_contrast, u_brightness, u_lift, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 res = (col - 0.5) * u_contrast + 0.5 + u_brightness;
  res = res + (1.0 - res) * u_lift;
  o = vec4(mix(col, clamp(res, 0.0, 1.0), u_mix), 1.0);
}`

// ============ NEW LIGHT (group) ============
const LENS_FLARE = `${HEADER}
uniform float u_x, u_y, u_intensity, u_mix;
uniform vec3 u_color;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec2 src = vec2(u_x, u_y);
  float d = distance(v_uv, src);
  float halo = exp(-d * d * 8.0) * u_intensity;
  // ghosts along axis
  vec3 acc = u_color * halo;
  for(int i = 1; i <= 4; i++){
    vec2 ghost = mix(src, vec2(0.5), float(i) * 0.25);
    float gd = distance(v_uv, ghost);
    acc += u_color * exp(-gd * gd * 60.0) * u_intensity * 0.5;
  }
  o = vec4(mix(col, col + acc, u_mix), 1.0);
}`

const LIGHT_LEAK = `${HEADER}
uniform float u_amount, u_position, u_mix;
uniform vec3 u_color;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec2 dir = vec2(cos(u_position * TAU), sin(u_position * TAU));
  float l1 = max(0.0, dot(v_uv - 0.5, dir)) * 2.0;
  float n = fbm(v_uv * 6.0 + u_position * 10.0);
  float leak = smoothstep(0.0, 1.0, l1) * (0.5 + n * 0.5);
  o = vec4(mix(col, col + u_color * leak * u_amount, u_mix), 1.0);
}`

const INNER_GLOW = `${HEADER}
uniform float u_radius, u_intensity, u_mix;
uniform vec3 u_color;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float d = length(sCenter(v_uv)) * 2.0;
  float g = exp(-d * d / max(u_radius * u_radius, 0.001)) * u_intensity;
  o = vec4(mix(col, col + u_color * g, u_mix), 1.0);
}`

const GRADIENT_OVERLAY = `${HEADER}
uniform float u_angle, u_amount, u_mix;
uniform vec3 u_a, u_b;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec2 dir = vec2(cos(radians(u_angle)), sin(radians(u_angle)));
  float t = clamp(dot(v_uv - 0.5, dir) + 0.5, 0.0, 1.0);
  vec3 grad = mix(u_a, u_b, t);
  vec3 res = mix(col, grad, u_amount);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

// ============ NEW STYLIZE (group) ============
const OIL_PAINT = `${HEADER}
uniform float u_radius, u_levels, u_mix;
void main(){
  vec2 px = u_radius / u_res;
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++){
    vec3 s = texture(u_tex, v_uv + vec2(float(x), float(y)) * px).rgb;
    sum += s; n += 1.0;
  }
  vec3 avg = sum / n;
  vec3 q = floor(avg * u_levels) / max(u_levels - 1.0, 1.0);
  o = vec4(mix(texture(u_tex, v_uv).rgb, q, u_mix), 1.0);
}`

const PENCIL = `${HEADER}
uniform float u_strength, u_thresh, u_mix;
uniform vec3 u_ink, u_paper;
void main(){
  vec2 px = 1.0 / u_res;
  float tl = luma(texture(u_tex, v_uv + vec2(-px.x, -px.y)).rgb);
  float tr = luma(texture(u_tex, v_uv + vec2( px.x, -px.y)).rgb);
  float bl = luma(texture(u_tex, v_uv + vec2(-px.x,  px.y)).rgb);
  float br = luma(texture(u_tex, v_uv + vec2( px.x,  px.y)).rgb);
  float gx = (br + tr) - (tl + bl);
  float gy = (bl + br) - (tl + tr);
  float g = length(vec2(gx, gy)) * u_strength;
  float n = noise(v_uv * 600.0) * 0.6 + 0.4;
  float ink = smoothstep(u_thresh, u_thresh + 0.1, g) * n;
  vec3 res = mix(u_paper, u_ink, ink);
  o = vec4(mix(texture(u_tex, v_uv).rgb, res, u_mix), 1.0);
}`

const POP_ART = `${HEADER}
uniform float u_levels, u_dotScale, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 q = floor(col * u_levels) / max(u_levels - 1.0, 1.0);
  vec2 p = (v_uv - 0.5) * u_res;
  vec2 g = p / u_dotScale;
  float dot = length(g - (floor(g) + 0.5)) * 2.0;
  float ht = smoothstep(luma(q) - 0.1, luma(q) + 0.1, dot);
  vec3 res = q * mix(0.6, 1.0, ht);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const CHARCOAL = `${HEADER}
uniform float u_strength, u_smudge, u_mix;
void main(){
  vec2 px = 1.0 / u_res;
  vec2 disp = (vec2(noise(v_uv * 30.0), noise(v_uv * 30.0 + 100.0)) - 0.5) * u_smudge * 0.05;
  vec2 uv = v_uv + disp;
  float c = luma(texture(u_tex, uv).rgb);
  float t = luma(texture(u_tex, uv + vec2(0, -px.y)).rgb);
  float b = luma(texture(u_tex, uv + vec2(0,  px.y)).rgb);
  float l = luma(texture(u_tex, uv + vec2(-px.x, 0)).rgb);
  float r = luma(texture(u_tex, uv + vec2( px.x, 0)).rgb);
  float edge = abs(c - t) + abs(c - b) + abs(c - l) + abs(c - r);
  edge *= u_strength;
  float n = noise(v_uv * 400.0) * 0.5 + 0.5;
  vec3 res = vec3(1.0 - edge * n);
  vec3 col = texture(u_tex, v_uv).rgb;
  o = vec4(mix(col, res, u_mix), 1.0);
}`

// ============ NEW INTERACT ============
const CURSOR_ZOOM_BLUR = `${HEADER}
uniform float u_radius, u_strength, u_mix;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  float falloff = 1.0 - smoothstep(0.0, u_radius, length((v_uv - u_mouse) * ar));
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for(int i = 0; i < 12; i++){
    float f = float(i) / 11.0;
    vec2 uv = mix(v_uv, u_mouse, f * u_strength * falloff);
    sum += texture(u_tex, uv).rgb;
    n += 1.0;
  }
  vec3 base = texture(u_tex, v_uv).rgb;
  vec3 res = sum / n;
  o = vec4(mix(base, res, falloff * u_mix), 1.0);
}`

const CURSOR_ERASER = `${HEADER}
uniform float u_radius, u_softness, u_mix;
uniform vec3 u_color;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  float mask = 1.0 - smoothstep(u_radius * (1.0 - u_softness), u_radius, length((v_uv - u_mouse) * ar));
  vec3 col = texture(u_tex, v_uv).rgb;
  o = vec4(mix(col, u_color, mask * u_mix), 1.0);
}`

const CURSOR_BLUR = `${HEADER}
uniform float u_radius, u_blurAmount, u_mix;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  float mask = 1.0 - smoothstep(0.0, u_radius, length((v_uv - u_mouse) * ar));
  vec2 px = u_blurAmount / u_res;
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++){
    vec2 d = vec2(float(x), float(y));
    float w = exp(-dot(d, d) * 0.3);
    sum += texture(u_tex, v_uv + d * px).rgb * w;
    n += w;
  }
  vec3 base = texture(u_tex, v_uv).rgb;
  o = vec4(mix(base, sum / n, mask * u_mix), 1.0);
}`

const CURSOR_DROPLET = `${HEADER}
uniform float u_radius, u_freq, u_amp, u_speed, u_mix;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  vec2 d = (v_uv - u_mouse) * ar;
  float dist = length(d);
  float falloff = 1.0 - smoothstep(u_radius, 0.0, dist);
  falloff = 1.0 - falloff;
  float ph = mod(u_time * u_speed, TAU);
  float w = sin(dist * u_freq * TAU - ph * 5.0) * u_amp * exp(-dist * 5.0) * falloff;
  vec2 dir = d / max(dist, 0.001);
  vec2 uv = v_uv + dir / ar * w;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const CURSOR_SHATTER = `${HEADER}
uniform float u_radius, u_count, u_offset, u_mix;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  vec2 d = (v_uv - u_mouse) * ar;
  float dist = length(d);
  float mask = 1.0 - smoothstep(u_radius * 0.5, u_radius, dist);
  vec2 cell = floor(v_uv * u_count);
  float h = hash(cell);
  vec2 disp = (vec2(hash(cell + 1.0), hash(cell + 2.0)) - 0.5) * u_offset;
  vec2 uv = v_uv + disp * mask;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

// IMMERSIVE — cursor "pokes through" the image with 3D depression + normal-mapped lighting
// Combines: image-derived normal (sobel on luma) + cursor bell-curve depression + Phong-ish lighting.
const IMMERSIVE = `${HEADER}
uniform float u_radius;
uniform float u_amplitude;
uniform float u_normalStrength;
uniform float u_parallax;
uniform float u_lightAngle;
uniform float u_lightHeight;
uniform float u_specular;
uniform float u_ambient;
uniform float u_mix;
uniform vec3  u_lightColor;
uniform vec3  u_shadowColor;

void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  vec2 px = 1.0 / u_res;

  // ===== image-derived normal (sobel on luma) =====
  float ll = luma(texture(u_tex, v_uv - vec2(px.x, 0)).rgb);
  float lr = luma(texture(u_tex, v_uv + vec2(px.x, 0)).rgb);
  float lu = luma(texture(u_tex, v_uv - vec2(0, px.y)).rgb);
  float ld = luma(texture(u_tex, v_uv + vec2(0, px.y)).rgb);
  vec3 imgN = normalize(vec3((ll - lr) * u_normalStrength, (lu - ld) * u_normalStrength, 1.0));

  // ===== cursor bell-curve depression =====
  vec2 d = (v_uv - u_mouse) * ar;
  float r = length(d);
  float R2 = max(u_radius * u_radius, 1e-4);
  float h = exp(-r * r / R2) * u_amplitude;

  // analytic gradient of bell -> direction of slope
  float k = -2.0 / R2;
  vec2 grad = d * k * h;
  vec3 cursorN = normalize(vec3(-grad.x, -grad.y, 1.0));

  // ===== blend normals (cursor dominates near tip, image dominates outside) =====
  float w = clamp(h / max(u_amplitude, 1e-4), 0.0, 1.0);
  vec3 N = normalize(mix(imgN, cursorN, w));

  // ===== parallax displaced UV =====
  vec2 uv2 = v_uv - grad * u_parallax;
  vec3 col = texture(u_tex, uv2).rgb;

  // ===== Phong-ish lighting =====
  vec3 lightDir = normalize(vec3(cos(radians(u_lightAngle)), sin(radians(u_lightAngle)), u_lightHeight));
  float diff = max(dot(N, lightDir), 0.0);
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 R = reflect(-lightDir, N);
  float spec = pow(max(dot(R, V), 0.0), 32.0);

  vec3 lit = col * (u_ambient + diff * (1.0 - u_ambient));
  // shadow tint in the depression
  lit = mix(lit, lit * u_shadowColor, w * 0.5);
  // specular highlight on the rim of the depression
  lit += u_lightColor * spec * u_specular * smoothstep(0.0, 0.3, h);

  vec3 base = texture(u_tex, v_uv).rgb;
  o = vec4(mix(base, lit, u_mix), 1.0);
}`

const CURSOR_RADIAL = `${HEADER}
uniform float u_radius, u_segments, u_mix;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  vec2 d = (v_uv - u_mouse) * ar;
  float dist = length(d);
  float mask = 1.0 - smoothstep(u_radius * 0.5, u_radius, dist);
  float a = atan(d.y, d.x);
  float seg = TAU / max(u_segments, 1.0);
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 ndir = vec2(cos(a), sin(a));
  vec2 uv = u_mouse + ndir * dist / ar;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, mask * u_mix), 1.0);
}`

// ============ MORE NEW EFFECTS ============

const SUN_RAYS = `${HEADER}
uniform float u_x, u_y;
uniform float u_intensity, u_rays, u_speed, u_decay, u_mix;
uniform vec3 u_color;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec2 d = v_uv - vec2(u_x, u_y);
  float a = atan(d.y, d.x);
  float r = length(d);
  float rays = sin(a * u_rays + u_time * u_speed) * 0.5 + 0.5;
  float fade = exp(-r * u_decay);
  vec3 res = col + u_color * rays * fade * u_intensity;
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const JITTER = `${HEADER}
uniform float u_amount, u_speed, u_block, u_mix;
void main(){
  vec2 bp = floor(v_uv * u_block);
  float t = floor(u_time * u_speed * 30.0);
  vec2 r = vec2(hash(bp + t), hash(bp + t + 17.0)) - 0.5;
  vec2 uv = v_uv + r * u_amount * 0.05;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const PRISM = `${HEADER}
uniform float u_amount, u_angle, u_ghosts, u_mix;
void main(){
  vec2 dir = vec2(cos(radians(u_angle)), sin(radians(u_angle)));
  vec3 acc = vec3(0.0);
  float wt = 0.0;
  int n = int(clamp(u_ghosts, 1.0, 8.0));
  for(int i = 0; i < 8; i++){
    if(i >= n) break;
    float f = float(i + 1) / float(n);
    vec2 off = dir * u_amount * f;
    acc.r += texture(u_tex, v_uv + off).r;
    acc.g += texture(u_tex, v_uv).g;
    acc.b += texture(u_tex, v_uv - off).b;
    wt += 1.0;
  }
  acc /= wt;
  vec3 base = texture(u_tex, v_uv).rgb;
  o = vec4(mix(base, acc, u_mix), 1.0);
}`

const NEON_GLOW = `${HEADER}
uniform float u_intensity, u_threshold, u_radius, u_mix;
uniform vec3 u_color;
void main(){
  vec2 px = u_radius / u_res;
  // sobel edges + glow
  float c0 = luma(texture(u_tex, v_uv).rgb);
  float l1 = luma(texture(u_tex, v_uv - vec2(px.x, 0)).rgb);
  float r1 = luma(texture(u_tex, v_uv + vec2(px.x, 0)).rgb);
  float t1 = luma(texture(u_tex, v_uv - vec2(0, px.y)).rgb);
  float b1 = luma(texture(u_tex, v_uv + vec2(0, px.y)).rgb);
  float edge = abs(c0 - l1) + abs(c0 - r1) + abs(c0 - t1) + abs(c0 - b1);
  edge = smoothstep(u_threshold, u_threshold + 0.1, edge);
  vec3 glow = u_color * edge * u_intensity;
  vec3 col = texture(u_tex, v_uv).rgb;
  o = vec4(mix(col, col + glow, u_mix), 1.0);
}`

const SPLIT_TONE = `${HEADER}
uniform vec3 u_shadow, u_highlight;
uniform float u_balance, u_amount, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec3 res = col * mix(u_shadow, u_highlight, smoothstep(0.0, 1.0, l + u_balance));
  o = vec4(mix(col, res, u_amount * u_mix), 1.0);
}`

const GRID = `${HEADER}
uniform float u_size, u_width, u_mix;
uniform vec3 u_color;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec2 p = fract(v_uv * u_size);
  float line = min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y));
  float mask = 1.0 - smoothstep(u_width, u_width + 0.01, line);
  vec3 res = mix(col, u_color, mask);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const BURST = `${HEADER}
uniform float u_x, u_y;
uniform float u_count, u_width, u_falloff, u_mix;
uniform vec3 u_color;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec2 d = v_uv - vec2(u_x, u_y);
  float a = atan(d.y, d.x);
  float r = length(d);
  float bands = abs(sin(a * u_count * 0.5));
  float line = smoothstep(1.0 - u_width, 1.0, bands);
  float fade = exp(-r * u_falloff);
  vec3 res = col + u_color * line * fade;
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const CMYK_SPLIT = `${HEADER}
uniform float u_amount, u_angle, u_mix;
void main(){
  vec2 dir = vec2(cos(radians(u_angle)), sin(radians(u_angle))) * u_amount;
  vec3 c1 = texture(u_tex, v_uv + dir * 0.0).rgb;
  vec3 c2 = texture(u_tex, v_uv + dir * 1.0).rgb;
  vec3 c3 = texture(u_tex, v_uv + dir * 2.0).rgb;
  vec3 c4 = texture(u_tex, v_uv + dir * 3.0).rgb;
  // Pretend CMYK channels
  vec3 cyan    = vec3(0.0, c1.g, c1.b);
  vec3 magenta = vec3(c2.r, 0.0, c2.b);
  vec3 yellow  = vec3(c3.r, c3.g, 0.0);
  vec3 key     = vec3(luma(c4)) * 0.3;
  vec3 res = (cyan + magenta + yellow + key) * 0.4;
  vec3 base = texture(u_tex, v_uv).rgb;
  o = vec4(mix(base, res, u_mix), 1.0);
}`

const CARTOON = `${HEADER}
uniform float u_levels, u_edgeStrength, u_mix;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 q = floor(col * u_levels) / max(u_levels - 1.0, 1.0);
  vec2 px = 1.0 / u_res;
  float cc = luma(col);
  float dx = abs(luma(texture(u_tex, v_uv + vec2(px.x, 0)).rgb) - cc);
  float dy = abs(luma(texture(u_tex, v_uv + vec2(0, px.y)).rgb) - cc);
  float edge = smoothstep(0.05, 0.2, (dx + dy) * u_edgeStrength);
  vec3 res = q * (1.0 - edge);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const ENGRAVING = `${HEADER}
uniform float u_density, u_angle, u_thickness, u_mix;
uniform vec3 u_ink, u_paper;
void main(){
  vec3 col = texture(u_tex, v_uv).rgb;
  float l = luma(col);
  vec2 p = (v_uv - 0.5) * u_res;
  p = rot(radians(u_angle)) * p;
  float lines = abs(sin(p.x * u_density * 0.05));
  float thresh = mix(0.1, 1.0, l) * u_thickness;
  float ink = step(lines, thresh);
  vec3 res = mix(u_ink, u_paper, ink);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const VHS = `${HEADER}
uniform float u_amount, u_chromaShift, u_lineNoise, u_mix;
void main(){
  vec2 uv = v_uv;
  // Horizontal line noise
  float band = floor(uv.y * u_res.y * 0.5);
  float n = hash(vec2(band, floor(u_time * 30.0))) - 0.5;
  uv.x += n * u_lineNoise * 0.02;
  // Chromatic
  float r = texture(u_tex, uv + vec2(u_chromaShift, 0.0)).r;
  float g = texture(u_tex, uv).g;
  float b = texture(u_tex, uv - vec2(u_chromaShift, 0.0)).b;
  vec3 base = texture(u_tex, v_uv).rgb;
  vec3 res = vec3(r, g, b);
  // Scanlines
  res *= 0.85 + 0.15 * sin(uv.y * u_res.y * 1.5);
  o = vec4(mix(base, res, u_amount * u_mix), 1.0);
}`

// ============ ADDITIONAL EFFECTS ============

const AURA = `${HEADER}
uniform float u_radius, u_threshold, u_intensity, u_mix;
uniform vec3 u_color;
void main(){
  vec2 px = u_radius / u_res;
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for(int y=-3;y<=3;y++) for(int x=-3;x<=3;x++){
    vec2 d = vec2(float(x), float(y));
    float w = exp(-dot(d, d) * 0.2);
    vec3 s = texture(u_tex, v_uv + d * px).rgb;
    float l = luma(s);
    if(l > u_threshold) sum += s * w;
    n += w;
  }
  vec3 aura = u_color * (sum / n) * u_intensity;
  vec3 col = texture(u_tex, v_uv).rgb;
  o = vec4(mix(col, col + aura, u_mix), 1.0);
}`

const RAIN = `${HEADER}
uniform float u_density, u_speed, u_streakLen, u_amount, u_mix;
uniform vec3 u_color;
void main(){
  vec2 g = vec2(floor(v_uv.x * u_density), floor((v_uv.y - u_time * u_speed) * u_streakLen));
  float n = hash(g);
  float streak = step(0.85, n);
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 res = mix(col, col + u_color * 0.5, streak * u_amount);
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const SCANNER = `${HEADER}
uniform float u_speed, u_thickness, u_brightness, u_axis, u_mix;
uniform vec3 u_color;
void main(){
  float t = mod(u_time * u_speed, 1.2);
  float coord = u_axis < 0.5 ? v_uv.y : v_uv.x;
  float dist = abs(coord - t);
  float line = 1.0 - smoothstep(0.0, u_thickness, dist);
  vec3 col = texture(u_tex, v_uv).rgb;
  vec3 res = col + u_color * line * u_brightness;
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const CIRCULAR_SCAN = `${HEADER}
uniform float u_speed, u_thickness, u_brightness, u_mix;
uniform vec3 u_color;
void main(){
  float t = mod(u_time * u_speed, 1.5);
  float r = length(sCenter(v_uv) * 2.0);
  float line = 1.0 - smoothstep(0.0, u_thickness, abs(r - t));
  vec3 col = texture(u_tex, v_uv).rgb;
  o = vec4(mix(col, col + u_color * line * u_brightness, u_mix), 1.0);
}`

const PIXEL_DRIFT = `${HEADER}
uniform float u_amount, u_scale, u_speed, u_mix;
void main(){
  vec2 g = floor(v_uv * u_scale);
  float h1 = hash(g) * 6.283 + u_time * u_speed;
  vec2 dir = vec2(cos(h1), sin(h1)) * u_amount * 0.04;
  vec2 uv = v_uv + dir;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, uv).rgb, u_mix), 1.0);
}`

const CHROMATIC_BLUR = `${HEADER}
uniform float u_radius, u_offset, u_mix;
void main(){
  vec2 dir = normalize(sCenter(v_uv) + 1e-4);
  vec2 px = u_radius / u_res;
  float sumR = 0.0, sumG = 0.0, sumB = 0.0;
  float n = 0.0;
  for(int i = -4; i <= 4; i++){
    vec2 off = dir * float(i) * px * u_offset;
    sumR += texture(u_tex, v_uv + off).r;
    sumG += texture(u_tex, v_uv + off * 0.5).g;
    sumB += texture(u_tex, v_uv - off).b;
    n += 1.0;
  }
  vec3 res = vec3(sumR, sumG, sumB) / n;
  vec3 col = texture(u_tex, v_uv).rgb;
  o = vec4(mix(col, res, u_mix), 1.0);
}`

const FILM_GRAIN = `${HEADER}
uniform float u_amount, u_size, u_chroma, u_mix;
void main(){
  vec2 g = floor(v_uv * u_res / max(u_size, 1.0))
        + floor(u_time * 30.0) * 7.13;
  vec3 n;
  if(u_chroma > 0.5)
    n = vec3(hash(g + 1.0), hash(g + 17.7), hash(g + 31.3)) - 0.5;
  else
    n = vec3(hash(g) - 0.5);
  vec3 col = texture(u_tex, v_uv).rgb;
  o = vec4(mix(col, col + n * u_amount, u_mix), 1.0);
}`

const DRIFT_NOISE = `${HEADER}
uniform float u_amount, u_scale, u_speed, u_mix;
void main(){
  float t = u_time * u_speed;
  vec2 p = v_uv * u_scale;
  vec2 d = vec2(fbm(p + t), fbm(p + vec2(13.2, 7.1) - t * 0.7)) - 0.5;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, v_uv + d * u_amount).rgb, u_mix), 1.0);
}`

const BLOOM_RGB = `${HEADER}
uniform float u_thresh, u_radius, u_intensity, u_offset, u_mix;
void main(){
  vec2 px = u_radius / u_res;
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for(int y=-3;y<=3;y++) for(int x=-3;x<=3;x++){
    vec2 d = vec2(float(x), float(y));
    float w = exp(-dot(d, d) * 0.18);
    vec3 sR = texture(u_tex, v_uv + d * px + vec2(u_offset, 0)).rgb;
    vec3 sG = texture(u_tex, v_uv + d * px).rgb;
    vec3 sB = texture(u_tex, v_uv + d * px - vec2(u_offset, 0)).rgb;
    sR *= step(u_thresh, luma(sR));
    sG *= step(u_thresh, luma(sG));
    sB *= step(u_thresh, luma(sB));
    sum += vec3(sR.r, sG.g, sB.b) * w;
    n += w;
  }
  vec3 base = texture(u_tex, v_uv).rgb;
  vec3 res = base + (sum / n) * u_intensity;
  o = vec4(mix(base, res, u_mix), 1.0);
}`

const LIQUID = `${HEADER}
uniform float u_amount, u_speed, u_scale, u_swirl, u_mix;
void main(){
  vec2 p = v_uv * u_scale;
  float t = u_time * u_speed;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(2.7, 5.3) + t * 0.5));
  vec2 r = vec2(fbm(p + 3.0*q + vec2(8.1, 1.2)), fbm(p + 3.0*q + vec2(4.5, 6.4)));
  vec2 d = (r - 0.5);
  vec2 c = sCenter(v_uv);
  d += vec2(-c.y, c.x) * u_swirl;
  o = vec4(mix(texture(u_tex, v_uv).rgb, texture(u_tex, v_uv + d * u_amount).rgb, u_mix), 1.0);
}`

const CURSOR_REFRACT = `${HEADER}
uniform float u_radius, u_ior, u_softness, u_mix;
void main(){
  vec2 ar = u_res / max(u_res.x, u_res.y);
  vec2 d = (v_uv - u_mouse) * ar;
  float dist = length(d);
  float h = 1.0 - smoothstep(u_radius * (1.0 - u_softness), u_radius, dist);
  // refraction: bend UV based on normal of the bell
  float R2 = max(u_radius * u_radius, 1e-4);
  float k = -2.0 / R2;
  vec2 grad = d * k * h * u_radius;
  vec2 uv = v_uv + grad * u_ior * 0.1;
  vec3 base = texture(u_tex, v_uv).rgb;
  o = vec4(mix(base, texture(u_tex, uv).rgb, h * u_mix), 1.0);
}`

// ============ helpers ============
const c = (r,g,b)=>[r,g,b]
const BLACK = c(0,0,0), WHITE = c(1,1,1)

export const EFFECTS = {
  // INTERACT — cursor-driven effects
  immersive: { id:'immersive', label:'IMMERSIVE (3D PUNCH)', group:'INTERACT', fs: IMMERSIVE, params: [
    { key:'u_radius',         label:'radius',        type:'range', min:0.05, max:1.5, step:0.001, default:0.35 },
    { key:'u_amplitude',      label:'amplitude',     type:'range', min:0, max:3, step:0.01, default:1.2 },
    { key:'u_normalStrength', label:'normal detail', type:'range', min:0, max:20, step:0.1, default:5 },
    { key:'u_parallax',       label:'parallax',      type:'range', min:-1, max:1, step:0.001, default:0.18 },
    { key:'u_lightAngle',     label:'light angle',   type:'range', min:0, max:360, step:1, default:135 },
    { key:'u_lightHeight',    label:'light height',  type:'range', min:0.2, max:3, step:0.01, default:0.8 },
    { key:'u_specular',       label:'specular',      type:'range', min:0, max:2, step:0.01, default:0.7 },
    { key:'u_ambient',        label:'ambient',       type:'range', min:0, max:1, step:0.01, default:0.55 },
    { key:'u_lightColor',     label:'light color',   type:'color', default: c(1, 0.95, 0.85) },
    { key:'u_shadowColor',    label:'shadow tint',   type:'color', default: c(0.5, 0.55, 0.7) },
    { key:'u_mix',            label:'mix',           type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorLens:      { id:'cursorLens', label:'CURSOR LENS', group:'INTERACT', fs: CURSOR_LENS, params: [
    { key:'u_radius',   label:'radius',   type:'range', min:0.05, max:1.5, step:0.001, default:0.3 },
    { key:'u_strength', label:'strength', type:'range', min:-3, max:3, step:0.01, default:1 },
    { key:'u_softness', label:'softness', type:'range', min:0.01, max:1, step:0.01, default:0.4 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorSpot:      { id:'cursorSpot', label:'CURSOR SPOTLIGHT', group:'INTERACT', fs: CURSOR_SPOTLIGHT, params: [
    { key:'u_radius',   label:'radius',   type:'range', min:0.05, max:1.5, step:0.001, default:0.25 },
    { key:'u_softness', label:'softness', type:'range', min:0.01, max:1, step:0.01, default:0.5 },
    { key:'u_dim',      label:'dim',      type:'range', min:0, max:1, step:0.01, default:0.15 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorRipple:    { id:'cursorRipple', label:'CURSOR RIPPLE', group:'INTERACT', fs: CURSOR_RIPPLE, params: [
    { key:'u_radius', label:'radius', type:'range', min:0.05, max:2, step:0.001, default:0.6 },
    { key:'u_freq',   label:'freq',   type:'range', min:1, max:40, step:0.1, default:12 },
    { key:'u_amp',    label:'amp',    type:'range', min:0, max:0.2, step:0.001, default:0.03 },
    { key:'u_speed',  label:'speed',  type:'range', min:0, max:10, step:0.01, default:3 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorPixel:     { id:'cursorPixel', label:'CURSOR PIXELATE', group:'INTERACT', fs: CURSOR_PIXEL, params: [
    { key:'u_radius',   label:'radius',   type:'range', min:0.05, max:1.5, step:0.001, default:0.25 },
    { key:'u_size',     label:'pixel size', type:'range', min:2, max:80, step:1, default:18 },
    { key:'u_softness', label:'softness', type:'range', min:0.01, max:1, step:0.01, default:0.2 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorDistort:   { id:'cursorDistort', label:'CURSOR DISTORT', group:'INTERACT', fs: CURSOR_DISTORT, params: [
    { key:'u_radius',   label:'radius',   type:'range', min:0.05, max:1.5, step:0.001, default:0.35 },
    { key:'u_strength', label:'strength', type:'range', min:-1, max:1, step:0.001, default:0.4 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorInvert:    { id:'cursorInvert', label:'CURSOR INVERT', group:'INTERACT', fs: CURSOR_INVERT, params: [
    { key:'u_radius',   label:'radius',   type:'range', min:0.05, max:1.5, step:0.001, default:0.2 },
    { key:'u_softness', label:'softness', type:'range', min:0.01, max:1, step:0.01, default:0.2 },
    { key:'u_hueShift', label:'hue shift',type:'range', min:0, max:1, step:0.001, default:0 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorGlow:      { id:'cursorGlow', label:'CURSOR GLOW', group:'INTERACT', fs: CURSOR_GLOW, params: [
    { key:'u_radius',    label:'radius',    type:'range', min:0.05, max:1.5, step:0.001, default:0.4 },
    { key:'u_intensity', label:'intensity', type:'range', min:0, max:3, step:0.01, default:0.8 },
    { key:'u_softness',  label:'softness',  type:'range', min:0.01, max:1, step:0.01, default:0.3 },
    { key:'u_color',     label:'color',     type:'color', default: c(1, 0.95, 0.7) },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorHalftone:  { id:'cursorHalftone', label:'CURSOR HALFTONE', group:'INTERACT', fs: CURSOR_HALFTONE, params: [
    { key:'u_radius',   label:'radius',   type:'range', min:0.05, max:1.5, step:0.001, default:0.3 },
    { key:'u_scale',    label:'scale',    type:'range', min:2, max:60, step:0.5, default:14 },
    { key:'u_softness', label:'softness', type:'range', min:0.01, max:1, step:0.01, default:0.2 },
    { key:'u_ink',      label:'ink',      type:'color', default: BLACK },
    { key:'u_paper',    label:'paper',    type:'color', default: WHITE },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // DISTORT
  liquify:   { id:'liquify', label:'LIQUIFY', group:'DISTORT', fs: LIQUIFY, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:1, step:0.001, default:0.15 },
    { key:'u_scale',  label:'scale',  type:'range', min:0.1, max:8, step:0.01, default:2 },
    { key:'u_speed',  label:'speed',  type:'range', min:0, max:2, step:0.001, default:0.1 },
    { key:'u_swirl',  label:'swirl',  type:'range', min:-1, max:1, step:0.01, default:0 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  wave:      { id:'wave', label:'WAVE', group:'DISTORT', fs: WAVE, params: [
    { key:'u_freqX', label:'freq X', type:'range', min:0, max:30, step:0.1, default:4 },
    { key:'u_freqY', label:'freq Y', type:'range', min:0, max:30, step:0.1, default:4 },
    { key:'u_ampX',  label:'amp X',  type:'range', min:0, max:1, step:0.001, default:0.1 },
    { key:'u_ampY',  label:'amp Y',  type:'range', min:0, max:1, step:0.001, default:0.05 },
    { key:'u_phase', label:'phase',  type:'range', min:0, max:6.283, step:0.01, default:0 },
    { key:'u_mix',   label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  twirl:     { id:'twirl', label:'TWIRL', group:'DISTORT', fs: TWIRL, params: [
    { key:'u_amount', label:'amount', type:'range', min:-12, max:12, step:0.01, default:3 },
    { key:'u_radius', label:'radius', type:'range', min:0.05, max:1, step:0.001, default:0.5 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  bulge:     { id:'bulge', label:'BULGE / PINCH', group:'DISTORT', fs: BULGE, params: [
    { key:'u_amount', label:'amount', type:'range', min:-1, max:1, step:0.001, default:0.5 },
    { key:'u_radius', label:'radius', type:'range', min:0.05, max:1, step:0.001, default:0.5 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  ripple:    { id:'ripple', label:'RIPPLE', group:'DISTORT', fs: RIPPLE, params: [
    { key:'u_freq',   label:'freq',   type:'range', min:1, max:40, step:0.1, default:10 },
    { key:'u_amp',    label:'amp',    type:'range', min:0, max:0.2, step:0.001, default:0.03 },
    { key:'u_speed',  label:'speed',  type:'range', min:0, max:8, step:0.01, default:2 },
    { key:'u_center', label:'center', type:'range', min:0, max:1, step:0.001, default:0.5 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  kaleido:   { id:'kaleido', label:'KALEIDOSCOPE', group:'DISTORT', fs: KALEIDO, params: [
    { key:'u_segments', label:'segments', type:'range', min:2, max:24, step:1, default:6 },
    { key:'u_angle',    label:'angle',    type:'range', min:0, max:360, step:1, default:0 },
    { key:'u_zoom',     label:'zoom',     type:'range', min:0.2, max:3, step:0.01, default:1 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  polar:     { id:'polar', label:'POLAR', group:'DISTORT', fs: POLAR, params: [
    { key:'u_mode',  label:'mode',  type:'select', options:[['polar',0],['inverse',1]], default:0 },
    { key:'u_zoom',  label:'zoom',  type:'range', min:0.1, max:3, step:0.01, default:1 },
    { key:'u_twist', label:'twist', type:'range', min:-2, max:2, step:0.01, default:0 },
    { key:'u_mix',   label:'mix',   type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  mirror:    { id:'mirror', label:'MIRROR', group:'DISTORT', fs: MIRROR, params: [
    { key:'u_modeX',  label:'mirror X', type:'toggle', default:true },
    { key:'u_modeY',  label:'mirror Y', type:'toggle', default:false },
    { key:'u_offset', label:'offset',   type:'range', min:0, max:1, step:0.001, default:1 },
    { key:'u_mix',    label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  slitscan:  { id:'slitscan', label:'SLIT SCAN', group:'DISTORT', fs: SLITSCAN, params: [
    { key:'u_mode', label:'mode', type:'select', options:[['luma',0],['sine',1]], default:0 },
    { key:'u_amp',  label:'amp',  type:'range', min:-1, max:1, step:0.001, default:0.3 },
    { key:'u_freq', label:'freq', type:'range', min:1, max:40, step:0.1, default:8 },
    { key:'u_mix',  label:'mix',  type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  smear:     { id:'smear', label:'SMEAR / WIND', group:'DISTORT', fs: SMEAR, params: [
    { key:'u_angle',  label:'angle',  type:'range', min:0, max:360, step:1, default:0 },
    { key:'u_length', label:'length', type:'range', min:0, max:0.5, step:0.001, default:0.1 },
    { key:'u_thresh', label:'thresh', type:'range', min:0, max:1, step:0.01, default:0.5 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  glass:     { id:'glass', label:'FROSTED GLASS', group:'DISTORT', fs: GLASS, params: [
    { key:'u_scale',  label:'scale',  type:'range', min:1, max:200, step:0.5, default:40 },
    { key:'u_amount', label:'amount', type:'range', min:0, max:0.2, step:0.001, default:0.02 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  fisheye:   { id:'fisheye', label:'FISH EYE', group:'DISTORT', fs: FISHEYE, params: [
    { key:'u_amount', label:'amount', type:'range', min:-1, max:1, step:0.001, default:0.5 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  rgbsplit:  { id:'rgbsplit', label:'RGB SPLIT', group:'DISTORT', fs: RGB_SPLIT, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:1, step:0.001, default:0.06 },
    { key:'u_angle',  label:'angle',  type:'range', min:0, max:360, step:1, default:0 },
    { key:'u_radial', label:'radial', type:'range', min:0, max:1, step:0.01, default:0 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  noisewarp: { id:'noisewarp', label:'NOISE WARP', group:'DISTORT', fs: NOISE_WARP, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:0.5, step:0.001, default:0.05 },
    { key:'u_scale',  label:'scale',  type:'range', min:0.1, max:30, step:0.1, default:4 },
    { key:'u_speed',  label:'speed',  type:'range', min:0, max:2, step:0.001, default:0.1 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // PRINT
  halftone:  { id:'halftone', label:'HALFTONE', group:'PRINT', fs: HALFTONE, params: [
    { key:'u_scale',    label:'scale',    type:'range', min:2, max:80, step:0.5, default:12 },
    { key:'u_softness', label:'softness', type:'range', min:0, max:1, step:0.01, default:0.15 },
    { key:'u_angleC',   label:'angle C',  type:'range', min:0, max:180, step:1, default:15 },
    { key:'u_angleM',   label:'angle M',  type:'range', min:0, max:180, step:1, default:75 },
    { key:'u_angleY',   label:'angle Y',  type:'range', min:0, max:180, step:1, default:0 },
    { key:'u_angleK',   label:'angle K',  type:'range', min:0, max:180, step:1, default:45 },
    { key:'u_paper',    label:'paper',    type:'color', default: WHITE },
    { key:'u_invert',   label:'invert',   type:'toggle', default:false },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  ascii:     { id:'ascii', label:'ASCII', group:'PRINT', fs: ASCII, params: [
    { key:'u_cell',    label:'cell',    type:'range', min:4, max:40, step:1, default:10 },
    { key:'u_charset', label:'charset', type:'range', min:2, max:8, step:1, default:8 },
    { key:'u_fg',      label:'ink',     type:'color', default: BLACK },
    { key:'u_bg',      label:'paper',   type:'color', default: WHITE },
    { key:'u_invert',  label:'invert',  type:'toggle', default:false },
    { key:'u_mix',     label:'mix',     type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  dither:    { id:'dither', label:'DITHER', group:'PRINT', fs: DITHER, params: [
    { key:'u_levels', label:'levels', type:'range', min:2, max:16, step:1, default:4 },
    { key:'u_scale',  label:'scale',  type:'range', min:1, max:12, step:1, default:2 },
    { key:'u_mono',   label:'mono',   type:'toggle', default:true },
    { key:'u_a',      label:'low',    type:'color', default: BLACK },
    { key:'u_b',      label:'high',   type:'color', default: WHITE },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  pixelate:  { id:'pixelate', label:'PIXELATE', group:'PRINT', fs: PIXELATE, params: [
    { key:'u_size',    label:'size',    type:'range', min:2, max:80, step:1, default:12 },
    { key:'u_circles', label:'circles', type:'toggle', default:false },
    { key:'u_mix',     label:'mix',     type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  hexpixel:  { id:'hexpixel', label:'HEX PIXELATE', group:'PRINT', fs: HEX_PIXELATE, params: [
    { key:'u_size', label:'size', type:'range', min:4, max:120, step:1, default:30 },
    { key:'u_mix',  label:'mix',  type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  edges:     { id:'edges', label:'EDGES', group:'PRINT', fs: EDGES, params: [
    { key:'u_strength', label:'strength',  type:'range', min:0, max:5, step:0.01, default:2 },
    { key:'u_thresh',   label:'threshold', type:'range', min:0, max:2, step:0.01, default:0.4 },
    { key:'u_ink',      label:'ink',       type:'color', default: BLACK },
    { key:'u_paper',    label:'paper',     type:'color', default: WHITE },
    { key:'u_mix',      label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  emboss:    { id:'emboss', label:'EMBOSS', group:'PRINT', fs: EMBOSS, params: [
    { key:'u_strength', label:'strength', type:'range', min:0, max:8, step:0.01, default:3 },
    { key:'u_angle',    label:'angle',    type:'range', min:0, max:360, step:1, default:45 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // PATTERN
  hatch:     { id:'hatch', label:'HATCH', group:'PATTERN', fs: HATCH, params: [
    { key:'u_density',   label:'density',   type:'range', min:0.5, max:30, step:0.1, default:8 },
    { key:'u_angle',     label:'angle',     type:'range', min:0, max:180, step:1, default:45 },
    { key:'u_thickness', label:'thickness', type:'range', min:0, max:1, step:0.01, default:0.3 },
    { key:'u_layers',    label:'layers',    type:'range', min:1, max:4, step:1, default:3 },
    { key:'u_ink',       label:'ink',       type:'color', default: BLACK },
    { key:'u_paper',     label:'paper',     type:'color', default: WHITE },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  stripes:   { id:'stripes', label:'STRIPES', group:'PATTERN', fs: STRIPES, params: [
    { key:'u_density',    label:'density',    type:'range', min:2, max:60, step:0.5, default:12 },
    { key:'u_angle',      label:'angle',      type:'range', min:0, max:180, step:1, default:0 },
    { key:'u_modulation', label:'modulation', type:'range', min:0, max:2, step:0.01, default:1 },
    { key:'u_ink',        label:'ink',        type:'color', default: BLACK },
    { key:'u_paper',      label:'paper',      type:'color', default: WHITE },
    { key:'u_mix',        label:'mix',        type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  circles:   { id:'circles', label:'CIRCLES', group:'PATTERN', fs: CIRCLES_PATTERN, params: [
    { key:'u_density',   label:'density',   type:'range', min:1, max:80, step:0.5, default:20 },
    { key:'u_thickness', label:'thickness', type:'range', min:0, max:2, step:0.01, default:1.2 },
    { key:'u_ink',       label:'ink',       type:'color', default: BLACK },
    { key:'u_paper',     label:'paper',     type:'color', default: WHITE },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  concentric:{ id:'concentric', label:'CONCENTRIC', group:'PATTERN', fs: CONCENTRIC, params: [
    { key:'u_count',     label:'count',     type:'range', min:1, max:80, step:0.5, default:20 },
    { key:'u_thickness', label:'thickness', type:'range', min:0, max:1, step:0.01, default:0.5 },
    { key:'u_ink',       label:'ink',       type:'color', default: BLACK },
    { key:'u_paper',     label:'paper',     type:'color', default: WHITE },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  voronoi:   { id:'voronoi', label:'VORONOI', group:'PATTERN', fs: VORONOI, params: [
    { key:'u_scale',  label:'scale',  type:'range', min:2, max:80, step:1, default:20 },
    { key:'u_jitter', label:'jitter', type:'range', min:0, max:1, step:0.01, default:1 },
    { key:'u_edges',  label:'edges',  type:'range', min:0, max:0.2, step:0.001, default:0.02 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // COLOR
  posterize: { id:'posterize', label:'POSTERIZE', group:'COLOR', fs: POSTERIZE, params: [
    { key:'u_mode',   label:'mode',      type:'select', options:[['levels',0],['threshold',1]], default:0 },
    { key:'u_levels', label:'levels',    type:'range', min:2, max:16, step:1, default:4 },
    { key:'u_thresh', label:'threshold', type:'range', min:0, max:1, step:0.01, default:0.5 },
    { key:'u_a',      label:'low',       type:'color', default: BLACK },
    { key:'u_b',      label:'high',      type:'color', default: WHITE },
    { key:'u_mix',    label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  duotone:   { id:'duotone', label:'DUOTONE', group:'COLOR', fs: DUOTONE, params: [
    { key:'u_a',        label:'shadow',    type:'color', default: c(0.05, 0.06, 0.20) },
    { key:'u_b',        label:'highlight', type:'color', default: c(1.0, 0.45, 0.10) },
    { key:'u_contrast', label:'contrast',  type:'range', min:0.2, max:3, step:0.01, default:1.2 },
    { key:'u_mix',      label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  tridone:   { id:'tridone', label:'TRIDONE', group:'COLOR', fs: TRIDONE, params: [
    { key:'u_a',   label:'shadow',    type:'color', default: c(0.05, 0.06, 0.20) },
    { key:'u_b',   label:'mid',       type:'color', default: c(0.9, 0.2, 0.4) },
    { key:'u_c',   label:'highlight', type:'color', default: c(1.0, 0.95, 0.5) },
    { key:'u_mid', label:'midpoint',  type:'range', min:0.1, max:0.9, step:0.01, default:0.5 },
    { key:'u_mix', label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  colorshift:{ id:'colorshift', label:'COLOR SHIFT', group:'COLOR', fs: COLORSHIFT, params: [
    { key:'u_hue',    label:'hue',    type:'range', min:0, max:1, step:0.001, default:0 },
    { key:'u_sat',    label:'sat',    type:'range', min:0, max:2, step:0.01, default:1 },
    { key:'u_val',    label:'val',    type:'range', min:0, max:2, step:0.01, default:1 },
    { key:'u_invert', label:'invert', type:'toggle', default:false },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  sepia:     { id:'sepia', label:'SEPIA', group:'COLOR', fs: SEPIA, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:1, step:0.01, default:1 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  solarize:  { id:'solarize', label:'SOLARIZE', group:'COLOR', fs: SOLARIZE, params: [
    { key:'u_thresh', label:'threshold', type:'range', min:0, max:1, step:0.01, default:0.5 },
    { key:'u_mix',    label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  heatmap:   { id:'heatmap', label:'HEAT MAP', group:'COLOR', fs: HEATMAP, params: [
    { key:'u_contrast', label:'contrast', type:'range', min:0.2, max:3, step:0.01, default:1 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  levels:    { id:'levels', label:'LEVELS', group:'COLOR', fs: LEVELS, params: [
    { key:'u_inMin',  label:'in min',   type:'range', min:0, max:1, step:0.01, default:0 },
    { key:'u_inMax',  label:'in max',   type:'range', min:0, max:1, step:0.01, default:1 },
    { key:'u_gamma',  label:'gamma',    type:'range', min:0.1, max:3, step:0.01, default:1 },
    { key:'u_outMin', label:'out min',  type:'range', min:0, max:1, step:0.01, default:0 },
    { key:'u_outMax', label:'out max',  type:'range', min:0, max:1, step:0.01, default:1 },
    { key:'u_mix',    label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  vignette:  { id:'vignette', label:'VIGNETTE', group:'COLOR', fs: VIGNETTE, params: [
    { key:'u_inner', label:'inner', type:'range', min:0, max:1, step:0.01, default:0.4 },
    { key:'u_outer', label:'outer', type:'range', min:0, max:1.5, step:0.01, default:1 },
    { key:'u_color', label:'color', type:'color', default: BLACK },
    { key:'u_mix',   label:'mix',   type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  grain:     { id:'grain', label:'GRAIN', group:'COLOR', fs: GRAIN, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:1, step:0.01, default:0.15 },
    { key:'u_size',   label:'size',   type:'range', min:1, max:8, step:1, default:1 },
    { key:'u_mono',   label:'mono',   type:'toggle', default:false },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // FOCUS
  blur:      { id:'blur', label:'BLUR', group:'FOCUS', fs: BLUR, params: [
    { key:'u_radius', label:'radius', type:'range', min:0, max:20, step:0.1, default:3 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  sharpen:   { id:'sharpen', label:'SHARPEN', group:'FOCUS', fs: SHARPEN, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:4, step:0.01, default:1 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  bloom:     { id:'bloom', label:'BLOOM', group:'FOCUS', fs: BLOOM, params: [
    { key:'u_thresh',    label:'threshold', type:'range', min:0, max:1, step:0.01, default:0.6 },
    { key:'u_radius',    label:'radius',    type:'range', min:0, max:20, step:0.1, default:6 },
    { key:'u_intensity', label:'intensity', type:'range', min:0, max:4, step:0.01, default:0.8 },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // GLITCH
  glitch:    { id:'glitch', label:'GLITCH', group:'GLITCH', fs: GLITCH, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:0.5, step:0.001, default:0.05 },
    { key:'u_blocks', label:'blocks', type:'range', min:4, max:200, step:1, default:40 },
    { key:'u_speed',  label:'speed',  type:'range', min:0, max:4, step:0.01, default:1 },
    { key:'u_chroma', label:'chroma', type:'range', min:0, max:1, step:0.01, default:0.3 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  pixelsort: { id:'pixelsort', label:'PIXEL SORT', group:'GLITCH', fs: PIXEL_SORT, params: [
    { key:'u_thresh', label:'threshold', type:'range', min:0, max:1, step:0.01, default:0.5 },
    { key:'u_length', label:'length',    type:'range', min:0, max:1, step:0.01, default:0.3 },
    { key:'u_seed',   label:'seed',      type:'range', min:0, max:1, step:0.001, default:0.42 },
    { key:'u_mix',    label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  anaglyph:  { id:'anaglyph', label:'ANAGLYPH 3D', group:'GLITCH', fs: ANAGLYPH, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:0.1, step:0.0001, default:0.01 },
    { key:'u_angle',  label:'angle',  type:'range', min:0, max:360, step:1, default:0 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  crt:       { id:'crt', label:'CRT', group:'GLITCH', fs: CRT, params: [
    { key:'u_curve',      label:'curve',      type:'range', min:0, max:2, step:0.01, default:0.4 },
    { key:'u_scanline',   label:'scanline',   type:'range', min:0, max:1, step:0.01, default:0.4 },
    { key:'u_brightness', label:'brightness', type:'range', min:0.5, max:2, step:0.01, default:1.1 },
    { key:'u_mix',        label:'mix',        type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  scanlines: { id:'scanlines', label:'SCANLINES', group:'GLITCH', fs: SCANLINES, params: [
    { key:'u_freq',     label:'freq',     type:'range', min:1, max:200, step:0.5, default:30 },
    { key:'u_strength', label:'strength', type:'range', min:0, max:1, step:0.01, default:0.4 },
    { key:'u_angle',    label:'angle',    type:'range', min:0, max:180, step:1, default:0 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // === NEW DISTORT ===
  swirl: { id:'swirl', label:'SWIRL', group:'DISTORT', fs: SWIRL, params: [
    { key:'u_amount', label:'amount', type:'range', min:-12, max:12, step:0.01, default:4 },
    { key:'u_radius', label:'radius', type:'range', min:0.05, max:1, step:0.001, default:0.6 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  zigzag: { id:'zigzag', label:'ZIGZAG', group:'DISTORT', fs: ZIGZAG, params: [
    { key:'u_freq', label:'freq', type:'range', min:1, max:80, step:0.1, default:20 },
    { key:'u_amp',  label:'amp',  type:'range', min:0, max:0.2, step:0.001, default:0.04 },
    { key:'u_axis', label:'axis', type:'select', options:[['horizontal',0],['vertical',1]], default:0 },
    { key:'u_mix',  label:'mix',  type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  perspective: { id:'perspective', label:'PERSPECTIVE', group:'DISTORT', fs: PERSPECTIVE, params: [
    { key:'u_topScale',    label:'top scale',    type:'range', min:0.05, max:3, step:0.01, default:1 },
    { key:'u_bottomScale', label:'bottom scale', type:'range', min:0.05, max:3, step:0.01, default:1.5 },
    { key:'u_skewX',       label:'skew x',       type:'range', min:-1, max:1, step:0.01, default:0 },
    { key:'u_mix',         label:'mix',          type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  shear: { id:'shear', label:'SHEAR', group:'DISTORT', fs: SHEAR, params: [
    { key:'u_shearX', label:'shear x', type:'range', min:-1, max:1, step:0.001, default:0.2 },
    { key:'u_shearY', label:'shear y', type:'range', min:-1, max:1, step:0.001, default:0 },
    { key:'u_mix',    label:'mix',     type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  squeeze: { id:'squeeze', label:'SQUEEZE', group:'DISTORT', fs: SQUEEZE, params: [
    { key:'u_amountX', label:'amount x', type:'range', min:-1, max:1, step:0.001, default:0 },
    { key:'u_amountY', label:'amount y', type:'range', min:-1, max:1, step:0.001, default:0.3 },
    { key:'u_mix',     label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  barrel: { id:'barrel', label:'BARREL', group:'DISTORT', fs: BARREL, params: [
    { key:'u_amount', label:'amount', type:'range', min:-1, max:1, step:0.001, default:0.3 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  echo: { id:'echo', label:'ECHO', group:'DISTORT', fs: ECHO, params: [
    { key:'u_offset', label:'offset', type:'range', min:0, max:0.3, step:0.001, default:0.04 },
    { key:'u_count',  label:'count',  type:'range', min:1, max:8, step:1, default:4 },
    { key:'u_decay',  label:'decay',  type:'range', min:0.1, max:0.95, step:0.01, default:0.6 },
    { key:'u_angle',  label:'angle',  type:'range', min:0, max:360, step:1, default:0 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  roll: { id:'roll', label:'ROLL', group:'DISTORT', fs: ROLL, params: [
    { key:'u_offsetX', label:'offset x', type:'range', min:-1, max:1, step:0.001, default:0.2 },
    { key:'u_offsetY', label:'offset y', type:'range', min:-1, max:1, step:0.001, default:0 },
    { key:'u_mix',     label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // === NEW PATTERN ===
  dotsGrid: { id:'dotsGrid', label:'DOTS GRID', group:'PATTERN', fs: DOTS_GRID, params: [
    { key:'u_density', label:'density', type:'range', min:5, max:200, step:1, default:60 },
    { key:'u_size',    label:'size',    type:'range', min:0.1, max:2, step:0.01, default:1 },
    { key:'u_invert',  label:'invert',  type:'toggle', default:false },
    { key:'u_ink',     label:'ink',     type:'color', default: BLACK },
    { key:'u_paper',   label:'paper',   type:'color', default: WHITE },
    { key:'u_mix',     label:'mix',     type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  checkerboard: { id:'checkerboard', label:'CHECKERBOARD', group:'PATTERN', fs: CHECKERBOARD, params: [
    { key:'u_count',      label:'count',      type:'range', min:2, max:80, step:1, default:16 },
    { key:'u_modulation', label:'modulation', type:'range', min:0, max:1, step:0.01, default:0.5 },
    { key:'u_a',          label:'A',          type:'color', default: BLACK },
    { key:'u_b',          label:'B',          type:'color', default: WHITE },
    { key:'u_mix',        label:'mix',        type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  trianglesPattern: { id:'trianglesPattern', label:'TRIANGLES', group:'PATTERN', fs: TRIANGLES, params: [
    { key:'u_density',    label:'density',    type:'range', min:4, max:120, step:1, default:24 },
    { key:'u_modulation', label:'modulation', type:'range', min:0, max:1.5, step:0.01, default:0.8 },
    { key:'u_ink',        label:'ink',        type:'color', default: BLACK },
    { key:'u_paper',      label:'paper',      type:'color', default: WHITE },
    { key:'u_mix',        label:'mix',        type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  diamonds: { id:'diamonds', label:'DIAMONDS', group:'PATTERN', fs: DIAMONDS, params: [
    { key:'u_density', label:'density', type:'range', min:4, max:120, step:1, default:24 },
    { key:'u_size',    label:'size',    type:'range', min:0.1, max:1, step:0.01, default:0.6 },
    { key:'u_ink',     label:'ink',     type:'color', default: BLACK },
    { key:'u_paper',   label:'paper',   type:'color', default: WHITE },
    { key:'u_mix',     label:'mix',     type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  crosses: { id:'crosses', label:'CROSSES', group:'PATTERN', fs: CROSSES, params: [
    { key:'u_density',   label:'density',   type:'range', min:4, max:120, step:1, default:30 },
    { key:'u_thickness', label:'thickness', type:'range', min:0.05, max:1, step:0.01, default:0.5 },
    { key:'u_ink',       label:'ink',       type:'color', default: BLACK },
    { key:'u_paper',     label:'paper',     type:'color', default: WHITE },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  weave: { id:'weave', label:'WEAVE', group:'PATTERN', fs: WEAVE, params: [
    { key:'u_density',    label:'density',    type:'range', min:4, max:80, step:1, default:30 },
    { key:'u_modulation', label:'modulation', type:'range', min:0, max:1, step:0.01, default:0.5 },
    { key:'u_ink',        label:'ink',        type:'color', default: BLACK },
    { key:'u_paper',      label:'paper',      type:'color', default: WHITE },
    { key:'u_mix',        label:'mix',        type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // === NEW COLOR ===
  tint: { id:'tint', label:'TINT', group:'COLOR', fs: TINT, params: [
    { key:'u_tint',   label:'tint',   type:'color', default: c(1, 0.85, 0.7) },
    { key:'u_amount', label:'amount', type:'range', min:0, max:2, step:0.01, default:1 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  gradientMap: { id:'gradientMap', label:'GRADIENT MAP', group:'COLOR', fs: GRADIENT_MAP, params: [
    { key:'u_a',   label:'shadow',    type:'color', default: c(0.05, 0.04, 0.18) },
    { key:'u_b',   label:'mid',       type:'color', default: c(0.85, 0.35, 0.45) },
    { key:'u_c',   label:'highlight', type:'color', default: c(1.0, 0.94, 0.7) },
    { key:'u_mid', label:'midpoint',  type:'range', min:0.1, max:0.9, step:0.01, default:0.5 },
    { key:'u_mix', label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  channelShift: { id:'channelShift', label:'CHANNEL SHIFT', group:'COLOR', fs: CHANNEL_SHIFT, params: [
    { key:'u_rOffset', label:'red',   type:'range', min:-0.1, max:0.1, step:0.0001, default:0.01 },
    { key:'u_gOffset', label:'green', type:'range', min:-0.1, max:0.1, step:0.0001, default:0 },
    { key:'u_bOffset', label:'blue',  type:'range', min:-0.1, max:0.1, step:0.0001, default:-0.01 },
    { key:'u_angle',   label:'angle', type:'range', min:0, max:360, step:1, default:0 },
    { key:'u_mix',     label:'mix',   type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  crossProcess: { id:'crossProcess', label:'CROSS PROCESS', group:'COLOR', fs: CROSS_PROCESS, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:1, step:0.01, default:0.6 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  vintage: { id:'vintage', label:'VINTAGE', group:'COLOR', fs: VINTAGE, params: [
    { key:'u_amount',  label:'amount',  type:'range', min:0, max:1, step:0.01, default:0.7 },
    { key:'u_warmth',  label:'warmth',  type:'range', min:0, max:1, step:0.01, default:0.5 },
    { key:'u_mix',     label:'mix',     type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  tealOrange: { id:'tealOrange', label:'TEAL & ORANGE', group:'COLOR', fs: TEAL_ORANGE, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:1, step:0.01, default:0.5 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  contrastCurve: { id:'contrastCurve', label:'CONTRAST CURVE', group:'COLOR', fs: CONTRAST_CURVE, params: [
    { key:'u_contrast',   label:'contrast',   type:'range', min:0, max:3, step:0.01, default:1.2 },
    { key:'u_brightness', label:'brightness', type:'range', min:-0.5, max:0.5, step:0.01, default:0 },
    { key:'u_lift',       label:'lift',       type:'range', min:-0.5, max:0.5, step:0.01, default:0 },
    { key:'u_mix',        label:'mix',        type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // === NEW LIGHT ===
  lensFlare: { id:'lensFlare', label:'LENS FLARE', group:'LIGHT', fs: LENS_FLARE, followCursor: ['u_x', 'u_y'], params: [
    { key:'u_x',         label:'x',         type:'range', min:0, max:1, step:0.001, default:0.2 },
    { key:'u_y',         label:'y',         type:'range', min:0, max:1, step:0.001, default:0.3 },
    { key:'u_intensity', label:'intensity', type:'range', min:0, max:3, step:0.01, default:0.8 },
    { key:'u_color',     label:'color',     type:'color', default: c(1.0, 0.92, 0.7) },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  lightLeak: { id:'lightLeak', label:'LIGHT LEAK', group:'LIGHT', fs: LIGHT_LEAK, params: [
    { key:'u_amount',   label:'amount',   type:'range', min:0, max:2, step:0.01, default:0.6 },
    { key:'u_position', label:'position', type:'range', min:0, max:1, step:0.001, default:0.25 },
    { key:'u_color',    label:'color',    type:'color', default: c(1.0, 0.5, 0.3) },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  innerGlow: { id:'innerGlow', label:'INNER GLOW', group:'LIGHT', fs: INNER_GLOW, params: [
    { key:'u_radius',    label:'radius',    type:'range', min:0.05, max:2, step:0.01, default:0.6 },
    { key:'u_intensity', label:'intensity', type:'range', min:0, max:3, step:0.01, default:0.8 },
    { key:'u_color',     label:'color',     type:'color', default: c(1.0, 0.95, 0.85) },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  gradientOverlay: { id:'gradientOverlay', label:'GRADIENT OVERLAY', group:'LIGHT', fs: GRADIENT_OVERLAY, params: [
    { key:'u_angle',  label:'angle',  type:'range', min:0, max:360, step:1, default:90 },
    { key:'u_amount', label:'amount', type:'range', min:0, max:1, step:0.01, default:0.4 },
    { key:'u_a',      label:'from',   type:'color', default: c(1, 0.4, 0.1) },
    { key:'u_b',      label:'to',     type:'color', default: c(0.1, 0.2, 0.6) },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // === NEW STYLIZE ===
  oilPaint: { id:'oilPaint', label:'OIL PAINT', group:'STYLIZE', fs: OIL_PAINT, params: [
    { key:'u_radius', label:'radius', type:'range', min:1, max:12, step:0.1, default:3 },
    { key:'u_levels', label:'levels', type:'range', min:2, max:16, step:1, default:6 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  pencil: { id:'pencil', label:'PENCIL', group:'STYLIZE', fs: PENCIL, params: [
    { key:'u_strength', label:'strength',  type:'range', min:0, max:6, step:0.01, default:2 },
    { key:'u_thresh',   label:'threshold', type:'range', min:0, max:1, step:0.01, default:0.1 },
    { key:'u_ink',      label:'ink',       type:'color', default: BLACK },
    { key:'u_paper',    label:'paper',     type:'color', default: WHITE },
    { key:'u_mix',      label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  popArt: { id:'popArt', label:'POP ART', group:'STYLIZE', fs: POP_ART, params: [
    { key:'u_levels',   label:'levels',   type:'range', min:2, max:8, step:1, default:4 },
    { key:'u_dotScale', label:'dot scale',type:'range', min:2, max:40, step:0.5, default:8 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  charcoal: { id:'charcoal', label:'CHARCOAL', group:'STYLIZE', fs: CHARCOAL, params: [
    { key:'u_strength', label:'strength', type:'range', min:0, max:20, step:0.1, default:6 },
    { key:'u_smudge',   label:'smudge',   type:'range', min:0, max:2, step:0.01, default:0.5 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // === NEW INTERACT ===
  cursorZoomBlur: { id:'cursorZoomBlur', label:'CURSOR ZOOM BLUR', group:'INTERACT', fs: CURSOR_ZOOM_BLUR, params: [
    { key:'u_radius',   label:'radius',   type:'range', min:0.05, max:1.5, step:0.001, default:0.3 },
    { key:'u_strength', label:'strength', type:'range', min:0, max:1, step:0.01, default:0.4 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorEraser: { id:'cursorEraser', label:'CURSOR ERASER', group:'INTERACT', fs: CURSOR_ERASER, params: [
    { key:'u_radius',   label:'radius',   type:'range', min:0.05, max:1.5, step:0.001, default:0.2 },
    { key:'u_softness', label:'softness', type:'range', min:0.01, max:1, step:0.01, default:0.2 },
    { key:'u_color',    label:'color',    type:'color', default: WHITE },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorBlur: { id:'cursorBlur', label:'CURSOR BLUR', group:'INTERACT', fs: CURSOR_BLUR, params: [
    { key:'u_radius',     label:'radius',     type:'range', min:0.05, max:1.5, step:0.001, default:0.3 },
    { key:'u_blurAmount', label:'blur',       type:'range', min:0.5, max:20, step:0.1, default:4 },
    { key:'u_mix',        label:'mix',        type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorDroplet: { id:'cursorDroplet', label:'CURSOR DROPLET', group:'INTERACT', fs: CURSOR_DROPLET, params: [
    { key:'u_radius', label:'radius', type:'range', min:0.05, max:2, step:0.001, default:0.6 },
    { key:'u_freq',   label:'freq',   type:'range', min:1, max:60, step:0.1, default:18 },
    { key:'u_amp',    label:'amp',    type:'range', min:0, max:0.3, step:0.001, default:0.06 },
    { key:'u_speed',  label:'speed',  type:'range', min:0, max:8, step:0.01, default:2.5 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorShatter: { id:'cursorShatter', label:'CURSOR SHATTER', group:'INTERACT', fs: CURSOR_SHATTER, params: [
    { key:'u_radius', label:'radius', type:'range', min:0.05, max:1.5, step:0.001, default:0.3 },
    { key:'u_count',  label:'tiles',  type:'range', min:8, max:120, step:1, default:30 },
    { key:'u_offset', label:'offset', type:'range', min:0, max:0.2, step:0.001, default:0.05 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorRadial: { id:'cursorRadial', label:'CURSOR KALEIDO', group:'INTERACT', fs: CURSOR_RADIAL, params: [
    { key:'u_radius',   label:'radius',   type:'range', min:0.05, max:1.5, step:0.001, default:0.4 },
    { key:'u_segments', label:'segments', type:'range', min:2, max:24, step:1, default:6 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // === MORE NEW EFFECTS ===
  sunRays: { id:'sunRays', label:'SUN RAYS', group:'LIGHT', fs: SUN_RAYS, followCursor: ['u_x', 'u_y'], params: [
    { key:'u_x',         label:'x',         type:'range', min:0, max:1, step:0.001, default:0.5 },
    { key:'u_y',         label:'y',         type:'range', min:0, max:1, step:0.001, default:0.5 },
    { key:'u_intensity', label:'intensity', type:'range', min:0, max:2, step:0.01, default:0.6 },
    { key:'u_rays',      label:'rays',      type:'range', min:1, max:60, step:0.5, default:18 },
    { key:'u_speed',     label:'speed',     type:'range', min:0, max:6, step:0.01, default:1 },
    { key:'u_decay',     label:'decay',     type:'range', min:0.1, max:6, step:0.01, default:1.5 },
    { key:'u_color',     label:'color',     type:'color', default: c(1, 0.9, 0.7) },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  jitter: { id:'jitter', label:'JITTER', group:'DISTORT', fs: JITTER, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:1, step:0.001, default:0.15 },
    { key:'u_speed',  label:'speed',  type:'range', min:0, max:4, step:0.01, default:1 },
    { key:'u_block',  label:'block',  type:'range', min:4, max:200, step:1, default:50 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  prism: { id:'prism', label:'PRISM', group:'LIGHT', fs: PRISM, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:0.05, step:0.0001, default:0.008 },
    { key:'u_angle',  label:'angle',  type:'range', min:0, max:360, step:1, default:45 },
    { key:'u_ghosts', label:'ghosts', type:'range', min:1, max:8, step:1, default:4 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  neonGlow: { id:'neonGlow', label:'NEON GLOW', group:'LIGHT', fs: NEON_GLOW, params: [
    { key:'u_intensity', label:'intensity', type:'range', min:0, max:5, step:0.01, default:1.5 },
    { key:'u_threshold', label:'threshold', type:'range', min:0, max:1, step:0.01, default:0.15 },
    { key:'u_radius',    label:'radius',    type:'range', min:0.5, max:6, step:0.1, default:1.5 },
    { key:'u_color',     label:'color',     type:'color', default: c(0.3, 0.95, 1) },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  splitTone: { id:'splitTone', label:'SPLIT TONE', group:'COLOR', fs: SPLIT_TONE, params: [
    { key:'u_shadow',    label:'shadow',    type:'color', default: c(0.7, 0.6, 1) },
    { key:'u_highlight', label:'highlight', type:'color', default: c(1, 0.9, 0.6) },
    { key:'u_balance',   label:'balance',   type:'range', min:-0.5, max:0.5, step:0.01, default:0 },
    { key:'u_amount',    label:'amount',    type:'range', min:0, max:1.5, step:0.01, default:0.8 },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  gridLines: { id:'gridLines', label:'GRID LINES', group:'PATTERN', fs: GRID, params: [
    { key:'u_size',  label:'size',  type:'range', min:2, max:120, step:1, default:24 },
    { key:'u_width', label:'width', type:'range', min:0.005, max:0.5, step:0.001, default:0.03 },
    { key:'u_color', label:'color', type:'color', default: BLACK },
    { key:'u_mix',   label:'mix',   type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  burst: { id:'burst', label:'BURST', group:'PATTERN', fs: BURST, followCursor: ['u_x', 'u_y'], params: [
    { key:'u_x',       label:'x',       type:'range', min:0, max:1, step:0.001, default:0.5 },
    { key:'u_y',       label:'y',       type:'range', min:0, max:1, step:0.001, default:0.5 },
    { key:'u_count',   label:'count',   type:'range', min:4, max:120, step:1, default:32 },
    { key:'u_width',   label:'width',   type:'range', min:0.05, max:1, step:0.01, default:0.5 },
    { key:'u_falloff', label:'falloff', type:'range', min:0.1, max:8, step:0.01, default:1.5 },
    { key:'u_color',   label:'color',   type:'color', default: c(1, 1, 1) },
    { key:'u_mix',     label:'mix',     type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cmykSplit: { id:'cmykSplit', label:'CMYK SPLIT', group:'COLOR', fs: CMYK_SPLIT, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:0.03, step:0.0001, default:0.005 },
    { key:'u_angle',  label:'angle',  type:'range', min:0, max:360, step:1, default:0 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cartoon: { id:'cartoon', label:'CARTOON', group:'STYLIZE', fs: CARTOON, params: [
    { key:'u_levels',       label:'levels',        type:'range', min:2, max:12, step:1, default:5 },
    { key:'u_edgeStrength', label:'edge strength', type:'range', min:0, max:6, step:0.01, default:3 },
    { key:'u_mix',          label:'mix',           type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  engraving: { id:'engraving', label:'ENGRAVING', group:'STYLIZE', fs: ENGRAVING, params: [
    { key:'u_density',   label:'density',   type:'range', min:1, max:60, step:0.1, default:18 },
    { key:'u_angle',     label:'angle',     type:'range', min:0, max:180, step:1, default:0 },
    { key:'u_thickness', label:'thickness', type:'range', min:0.05, max:1.5, step:0.01, default:0.8 },
    { key:'u_ink',       label:'ink',       type:'color', default: BLACK },
    { key:'u_paper',     label:'paper',     type:'color', default: WHITE },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  vhs: { id:'vhs', label:'VHS', group:'GLITCH', fs: VHS, params: [
    { key:'u_amount',      label:'amount',       type:'range', min:0, max:1, step:0.01, default:0.8 },
    { key:'u_chromaShift', label:'chroma shift', type:'range', min:0, max:0.02, step:0.0001, default:0.004 },
    { key:'u_lineNoise',   label:'line noise',   type:'range', min:0, max:1, step:0.01, default:0.3 },
    { key:'u_mix',         label:'mix',          type:'range', min:0, max:1, step:0.01, default:1 }
  ]},

  // === MORE EFFECTS BATCH 2 ===
  aura: { id:'aura', label:'AURA', group:'LIGHT', fs: AURA, params: [
    { key:'u_radius',    label:'radius',    type:'range', min:1, max:12, step:0.1, default:4 },
    { key:'u_threshold', label:'threshold', type:'range', min:0, max:1, step:0.01, default:0.5 },
    { key:'u_intensity', label:'intensity', type:'range', min:0, max:3, step:0.01, default:0.8 },
    { key:'u_color',     label:'color',     type:'color', default: c(0.5, 0.85, 1) },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  rain: { id:'rain', label:'RAIN', group:'PATTERN', fs: RAIN, params: [
    { key:'u_density',   label:'density',   type:'range', min:30, max:500, step:1, default:180 },
    { key:'u_speed',     label:'speed',     type:'range', min:0, max:6, step:0.01, default:1.5 },
    { key:'u_streakLen', label:'streak',    type:'range', min:20, max:300, step:1, default:90 },
    { key:'u_amount',    label:'amount',    type:'range', min:0, max:1, step:0.01, default:0.7 },
    { key:'u_color',     label:'color',     type:'color', default: WHITE },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  scanner: { id:'scanner', label:'SCANNER', group:'GLITCH', fs: SCANNER, params: [
    { key:'u_speed',      label:'speed',      type:'range', min:0, max:6, step:0.01, default:1.2 },
    { key:'u_thickness',  label:'thickness',  type:'range', min:0.005, max:0.3, step:0.001, default:0.04 },
    { key:'u_brightness', label:'brightness', type:'range', min:0, max:3, step:0.01, default:1 },
    { key:'u_axis',       label:'axis',       type:'select', options:[['horizontal',0],['vertical',1]], default:0 },
    { key:'u_color',      label:'color',      type:'color', default: c(0.3, 1, 0.6) },
    { key:'u_mix',        label:'mix',        type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  circularScan: { id:'circularScan', label:'CIRCULAR SCAN', group:'GLITCH', fs: CIRCULAR_SCAN, params: [
    { key:'u_speed',      label:'speed',      type:'range', min:0, max:6, step:0.01, default:1 },
    { key:'u_thickness',  label:'thickness',  type:'range', min:0.005, max:0.3, step:0.001, default:0.04 },
    { key:'u_brightness', label:'brightness', type:'range', min:0, max:3, step:0.01, default:1 },
    { key:'u_color',      label:'color',      type:'color', default: c(0.3, 1, 0.6) },
    { key:'u_mix',        label:'mix',        type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  pixelDrift: { id:'pixelDrift', label:'PIXEL DRIFT', group:'GLITCH', fs: PIXEL_DRIFT, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:1, step:0.001, default:0.15 },
    { key:'u_scale',  label:'cell scale', type:'range', min:10, max:500, step:1, default:80 },
    { key:'u_speed',  label:'speed',  type:'range', min:0, max:4, step:0.01, default:0.8 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  chromaticBlur: { id:'chromaticBlur', label:'CHROMATIC BLUR', group:'FOCUS', fs: CHROMATIC_BLUR, params: [
    { key:'u_radius', label:'radius', type:'range', min:0.5, max:30, step:0.1, default:6 },
    { key:'u_offset', label:'offset', type:'range', min:0, max:3, step:0.01, default:1 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  filmGrain: { id:'filmGrain', label:'FILM GRAIN', group:'COLOR', fs: FILM_GRAIN, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:1, step:0.01, default:0.18 },
    { key:'u_size',   label:'size',   type:'range', min:1, max:8, step:1, default:2 },
    { key:'u_chroma', label:'chroma', type:'toggle', default:false },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  driftNoise: { id:'driftNoise', label:'DRIFT', group:'DISTORT', fs: DRIFT_NOISE, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:0.3, step:0.001, default:0.05 },
    { key:'u_scale',  label:'scale',  type:'range', min:0.1, max:20, step:0.01, default:3 },
    { key:'u_speed',  label:'speed',  type:'range', min:0, max:2, step:0.001, default:0.1 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  bloomRgb: { id:'bloomRgb', label:'BLOOM RGB', group:'LIGHT', fs: BLOOM_RGB, params: [
    { key:'u_thresh',    label:'threshold', type:'range', min:0, max:1, step:0.01, default:0.6 },
    { key:'u_radius',    label:'radius',    type:'range', min:1, max:20, step:0.1, default:6 },
    { key:'u_intensity', label:'intensity', type:'range', min:0, max:3, step:0.01, default:1 },
    { key:'u_offset',    label:'rgb offset',type:'range', min:0, max:0.02, step:0.0001, default:0.004 },
    { key:'u_mix',       label:'mix',       type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  liquid: { id:'liquid', label:'LIQUID', group:'DISTORT', fs: LIQUID, params: [
    { key:'u_amount', label:'amount', type:'range', min:0, max:1, step:0.001, default:0.18 },
    { key:'u_speed',  label:'speed',  type:'range', min:0, max:2, step:0.001, default:0.08 },
    { key:'u_scale',  label:'scale',  type:'range', min:0.1, max:10, step:0.01, default:1.5 },
    { key:'u_swirl',  label:'swirl',  type:'range', min:-1, max:1, step:0.01, default:0.2 },
    { key:'u_mix',    label:'mix',    type:'range', min:0, max:1, step:0.01, default:1 }
  ]},
  cursorRefract: { id:'cursorRefract', label:'CURSOR REFRACT', group:'INTERACT', fs: CURSOR_REFRACT, params: [
    { key:'u_radius',   label:'radius',   type:'range', min:0.05, max:1.5, step:0.001, default:0.3 },
    { key:'u_ior',      label:'ior',      type:'range', min:-3, max:3, step:0.01, default:1 },
    { key:'u_softness', label:'softness', type:'range', min:0.01, max:1, step:0.01, default:0.3 },
    { key:'u_mix',      label:'mix',      type:'range', min:0, max:1, step:0.01, default:1 }
  ]}
}

export function defaultValues(effectId){
  const v = {}
  for(const p of EFFECTS[effectId].params) v[p.key] = p.default
  return v
}
