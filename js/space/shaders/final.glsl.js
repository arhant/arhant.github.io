/* FinalPass: exposure → ACES (verbatim from three r170) → grade → readability
   mask → vignette → sRGB → black lift to the page background → grain/dither.
   Also does the warp radial blur + chromatic aberration. */
import { HASH, FULLSCREEN_VERT } from './common.glsl.js';

export const MAX_RECTS = 8;

export const FINAL_VERT = FULLSCREEN_VERT;

export const FINAL_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uWarp;
uniform float uCA;
uniform vec3 uShadowTint;
uniform vec3 uBg;
uniform vec4 uRects[${MAX_RECTS}];
uniform vec2 uRectParams[${MAX_RECTS}];
uniform vec3 uFlare;
uniform int uRectCount;
uniform float uLumaCap;
uniform float uMaskDim;
uniform float uMaskStrength;
uniform float uDpr;
varying vec2 vUv;

${HASH}

vec3 RRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}
vec3 acesFilmic(vec3 color) {
    const mat3 ACESInputMat = mat3(
        vec3(0.59719, 0.07600, 0.02840),
        vec3(0.35458, 0.90834, 0.13383),
        vec3(0.04823, 0.01566, 0.83777));
    const mat3 ACESOutputMat = mat3(
        vec3( 1.60475, -0.10208, -0.00327),
        vec3(-0.53108,  1.10813, -0.07276),
        vec3(-0.07367, -0.00605,  1.07602));
    color /= 0.6;
    color = ACESInputMat * color;
    color = RRTAndODTFit(color);
    color = ACESOutputMat * color;
    return clamp(color, 0.0, 1.0);
}
vec3 srgbOETF(vec3 c) {
    return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}
float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
    vec2 uv = vUv;
    vec2 fromC = uv - 0.5;
    vec3 col;

    if (uWarp > 0.01) {
        col = vec3(0.0);
        vec2 ca = fromC * 0.006 * uWarp;
        for (int i = 0; i < 8; i++) {
            float k = float(i) / 7.0;
            vec2 o = 0.5 + fromC * (1.0 - k * 0.045 * uWarp);
            col.r += texture2D(tDiffuse, o + ca).r;
            col.g += texture2D(tDiffuse, o).g;
            col.b += texture2D(tDiffuse, o - ca).b;
        }
        col /= 8.0;
    } else if (uCA > 0.0) {
        vec2 ca = fromC * uCA * dot(fromC, fromC) * 4.0;
        col = vec3(texture2D(tDiffuse, uv + ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - ca).b);
    } else {
        col = texture2D(tDiffuse, uv).rgb;
    }

    // Lens flare from the hero sun: anamorphic streak, glare and ghosts mirrored through the centre
    if (uFlare.z > 0.001) {
        vec2 asp = vec2(uRes.x / uRes.y, 1.0);
        vec2 sp = uFlare.xy;
        vec2 dp = (uv - sp) * asp;
        float streak = exp(-abs(dp.y) * 260.0) * exp(-abs(dp.x) * 1.8) * 0.9;
        float glare = exp(-length(dp) * 9.0) * 0.3;
        vec2 axis = vec2(0.5) - sp;
        vec3 ghosts = vec3(0.0);
        for (int i = 0; i < 4; i++) {
            float fi = float(i);
            vec2 gp = sp + axis * (0.7 + fi * 0.42);
            float rr = length((uv - gp) * asp);
            float size = 0.018 + 0.022 * fi;
            float disc = smoothstep(size, size * 0.82, rr) * (0.5 + 0.5 * smoothstep(size * 0.4, size, rr));
            ghosts += mix(vec3(0.35, 0.65, 1.0), vec3(1.0, 0.55, 0.35), fi / 3.0) * disc * 0.06;
        }
        col += (vec3(1.0, 0.86, 0.68) * (streak + glare) + ghosts) * uFlare.z;
    }

    col = acesFilmic(col * uExposure);

    // Grade: cool the shadows slightly
    float l0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, col * uShadowTint, (1.0 - smoothstep(0.0, 0.35, l0)) * 0.5);

    // Readability: cap luminance and dim behind content blocks
    vec2 fc = gl_FragCoord.xy;
    float m = 0.0;
    for (int i = 0; i < ${MAX_RECTS}; i++) {
        if (i >= uRectCount) break;
        vec4 r = uRects[i];
        vec2 pw = uRectParams[i];
        float mi;
        if (pw.x > 0.5) {
            // Free-standing text: wide, soft falloff that reads as shade, not a box
            float d = sdRoundBox(fc - r.xy, r.zw, min(r.z, r.w) * 0.9);
            mi = (1.0 - smoothstep(-80.0 * uDpr, 170.0 * uDpr, d)) * 0.7;
        } else {
            // Panels: stays under the panel itself, so nothing shows around it
            float d = sdRoundBox(fc - r.xy, r.zw, 20.0 * uDpr);
            mi = 1.0 - smoothstep(-8.0 * uDpr, 1.0 * uDpr, d);
        }
        m = max(m, mi * pw.y);
    }
    m *= uMaskStrength;
    float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col *= mix(1.0, min(1.0, uLumaCap / max(L, 1e-4)), m);
    col *= mix(1.0, uMaskDim, m);

    // Vignette
    float aspect = uRes.x / uRes.y;
    float vd = length(fromC * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5);
    col *= mix(1.0, smoothstep(1.15, 0.35, vd), uVignette);

    col = srgbOETF(col);
    col = uBg + col * (1.0 - uBg);

    float n = hash12(fc + fract(uTime * 0.731) * 251.0) - 0.5;
    col += n * (uGrain + 1.0 / 255.0);
    gl_FragColor = vec4(col, 1.0);
}
`;
