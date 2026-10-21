/* Shared GLSL chunks. Every set-piece shader works in object/local space so
   large world coordinates never reach the noise functions. */

// Hash without sine (Dave Hoskins, MIT)
export const HASH = /* glsl */ `
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
}
// Interleaved gradient noise (Jimenez), for dithering ray-march start points
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

// 3D simplex noise (Stefan Gustavson / Ashima Arts, MIT), plus fbm helpers.
// Used only by one-off bakes; runtime shaders sample the baked textures instead.
export const SIMPLEX = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0))
              + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm3(vec3 p, int oct) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 9; i++) {
        if (i >= oct) break;
        s += a * snoise(p);
        p = p * 2.03 + vec3(17.1, 9.2, 3.7);
        a *= 0.5;
    }
    return s;
}

float ridged3(vec3 p, int oct) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 9; i++) {
        if (i >= oct) break;
        float n = 1.0 - abs(snoise(p));
        s += a * n * n;
        p = p * 2.03 + vec3(17.1, 9.2, 3.7);
        a *= 0.5;
    }
    return s;
}
`;

// Periodic gradient noise + Worley, for the tileable 3D noise texture
export const PERIODIC = /* glsl */ `
float gnoiseP(vec3 p, float per) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    #define GRAD(o) dot(hash33(mod(i + o, per)) * 2.0 - 1.0, f - o)
    float n000 = GRAD(vec3(0.0, 0.0, 0.0));
    float n100 = GRAD(vec3(1.0, 0.0, 0.0));
    float n010 = GRAD(vec3(0.0, 1.0, 0.0));
    float n110 = GRAD(vec3(1.0, 1.0, 0.0));
    float n001 = GRAD(vec3(0.0, 0.0, 1.0));
    float n101 = GRAD(vec3(1.0, 0.0, 1.0));
    float n011 = GRAD(vec3(0.0, 1.0, 1.0));
    float n111 = GRAD(vec3(1.0, 1.0, 1.0));
    #undef GRAD
    return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
               mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float fbmP(vec3 p, float per, int oct) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 7; i++) {
        if (i >= oct) break;
        s += a * gnoiseP(p, per);
        p *= 2.0; per *= 2.0; a *= 0.5;
    }
    return s;
}

float ridgedP(vec3 p, float per, int oct) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 7; i++) {
        if (i >= oct) break;
        float n = 1.0 - abs(gnoiseP(p, per) * 1.6);
        s += a * n * n;
        p *= 2.0; per *= 2.0; a *= 0.5;
    }
    return s;
}

float worleyP(vec3 p, float per) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float d = 8.0;
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 c = hash33(mod(i + o, per));
        d = min(d, length(o + c - f));
    }
    return d;
}
`;

export const RAY = /* glsl */ `
vec2 raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
    vec3 oc = ro - c;
    float b = dot(oc, rd);
    float h = b * b - dot(oc, oc) + r * r;
    if (h < 0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
}
// Henyey-Greenstein phase function
float hgPhase(float mu, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (12.5663706 * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}
vec3 rotateAxis(vec3 v, vec3 k, float a) {
    float c = cos(a), s = sin(a);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
`;

// Vertex shader for full-screen passes: a plane of size 2 drawn straight to clip space
export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
