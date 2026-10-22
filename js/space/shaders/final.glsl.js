/* FinalPass: exposure → ACES (verbatim from three r170) → grade → readability
   mask → vignette → sRGB → black lift to the page background → grain/dither.
   Also does the warp radial blur + chromatic aberration, FXAA on the plain
   path (uFXAA), and the frosted-glass panel: inside a glass rect the HDR frame
   is swapped for the GlassBlurPass output before tone mapping, and the usual
   luminance cap and dim still apply on top.

   Defines (experiments only, set from ?tm=): TONEMAP_AGX or TONEMAP_NEUTRAL
   swap ACES for three r170's AgX or Khronos PBR Neutral. */
import { HASH, FULLSCREEN_VERT } from './common.glsl.js';

export const MAX_RECTS = 8;

// Readability rect modes (uRectParams[i].x)
export const RECT_PANEL = 0; // tight mask that stays under the panel
export const RECT_SOFT = 1;  // free-standing text: wide, soft shade
export const RECT_GLASS = 2; // a panel that also shows the blurred scene behind it

export const FINAL_VERT = FULLSCREEN_VERT;

// FXAA 3.11 (Timothy Lottes, NVIDIA), quality preset 10: the shortest edge search
// (1.5, 3, 12 px), default thresholds and a lighter sub-pixel blend. Luma is the
// compressed HDR value L/(1+L) at the current exposure, so edges are found where
// tone mapping will show them. A pixel far brighter than the average around it
// (a star one or two pixels wide, measured above the local floor) is returned
// as is, so stars stay sharp.
const FXAA = /* glsl */ `
#define FXAA_EDGE 0.166
#define FXAA_EDGE_MIN 0.0833
#define FXAA_SUBPIX 0.5
#define FXAA_SPIKE 0.3
float fxaaLumaOf(vec3 c) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722)) * uExposure;
    return l / (1.0 + l);
}
float fxaaLuma(vec2 p) { return fxaaLumaOf(texture2D(tDiffuse, p).rgb); }
vec3 fxaa(vec2 posM) {
    vec2 rcp = 1.0 / uRes;
    vec3 rgbM = texture2D(tDiffuse, posM).rgb;
    float lumaM = fxaaLumaOf(rgbM);
    float lumaS = fxaaLuma(posM + vec2(0.0, 1.0) * rcp);
    float lumaE = fxaaLuma(posM + vec2(1.0, 0.0) * rcp);
    float lumaN = fxaaLuma(posM + vec2(0.0, -1.0) * rcp);
    float lumaW = fxaaLuma(posM + vec2(-1.0, 0.0) * rcp);
    float rangeMax = max(max(lumaN, lumaW), max(lumaE, max(lumaS, lumaM)));
    float rangeMin = min(min(lumaN, lumaW), min(lumaE, min(lumaS, lumaM)));
    float range = rangeMax - rangeMin;
    if (range < max(FXAA_EDGE_MIN, rangeMax * FXAA_EDGE)) return rgbM;

    float lumaNW = fxaaLuma(posM + vec2(-1.0, -1.0) * rcp);
    float lumaSE = fxaaLuma(posM + vec2(1.0, 1.0) * rcp);
    float lumaNE = fxaaLuma(posM + vec2(1.0, -1.0) * rcp);
    float lumaSW = fxaaLuma(posM + vec2(-1.0, 1.0) * rcp);
    float lumaNS = lumaN + lumaS;
    float lumaWE = lumaW + lumaE;
    float lumaNESE = lumaNE + lumaSE;
    float lumaNWNE = lumaNW + lumaNE;
    float lumaNWSW = lumaNW + lumaSW;
    float lumaSWSE = lumaSW + lumaSE;
    float subpixA = (lumaNS + lumaWE) * 2.0 + lumaNWSW + lumaNESE;
    // Above the local floor, so a star on the bright Milky Way band counts as well
    if (subpixA * (1.0 / 12.0) - rangeMin < FXAA_SPIKE * (lumaM - rangeMin)) return rgbM;

    float edgeHorz = abs(-2.0 * lumaW + lumaNWSW) + abs(-2.0 * lumaM + lumaNS) * 2.0 + abs(-2.0 * lumaE + lumaNESE);
    float edgeVert = abs(-2.0 * lumaS + lumaSWSE) + abs(-2.0 * lumaM + lumaWE) * 2.0 + abs(-2.0 * lumaN + lumaNWNE);
    bool horzSpan = edgeHorz >= edgeVert;
    float lengthSign = horzSpan ? rcp.y : rcp.x;
    if (!horzSpan) {
        lumaN = lumaW;
        lumaS = lumaE;
    }
    float subpixB = subpixA * (1.0 / 12.0) - lumaM;
    float gradientN = lumaN - lumaM;
    float gradientS = lumaS - lumaM;
    bool pairN = abs(gradientN) >= abs(gradientS);
    float gradient = max(abs(gradientN), abs(gradientS));
    if (pairN) lengthSign = -lengthSign;
    float subpixC = clamp(abs(subpixB) / range, 0.0, 1.0);

    // Walk along the edge in both directions until the luma pair changes
    vec2 posB = posM;
    vec2 offNP = horzSpan ? vec2(rcp.x, 0.0) : vec2(0.0, rcp.y);
    if (horzSpan) posB.y += lengthSign * 0.5;
    else posB.x += lengthSign * 0.5;
    vec2 posN = posB - offNP * 1.5;
    vec2 posP = posB + offNP * 1.5;
    float lumaNN = (pairN ? lumaN : lumaS) + lumaM;
    float gradientScaled = gradient * 0.25;
    bool lumaMLTZero = lumaM - lumaNN * 0.5 < 0.0;
    float lumaEndN = fxaaLuma(posN) - lumaNN * 0.5;
    float lumaEndP = fxaaLuma(posP) - lumaNN * 0.5;
    bool doneN = abs(lumaEndN) >= gradientScaled;
    bool doneP = abs(lumaEndP) >= gradientScaled;
    if (!doneN) posN -= offNP * 3.0;
    if (!doneP) posP += offNP * 3.0;
    if (!doneN || !doneP) {
        if (!doneN) lumaEndN = fxaaLuma(posN) - lumaNN * 0.5;
        if (!doneP) lumaEndP = fxaaLuma(posP) - lumaNN * 0.5;
        doneN = abs(lumaEndN) >= gradientScaled;
        doneP = abs(lumaEndP) >= gradientScaled;
        if (!doneN) posN -= offNP * 12.0;
        if (!doneP) posP += offNP * 12.0;
    }

    float dstN = horzSpan ? posM.x - posN.x : posM.y - posN.y;
    float dstP = horzSpan ? posP.x - posM.x : posP.y - posM.y;
    bool goodSpan = dstN < dstP ? (lumaEndN < 0.0) != lumaMLTZero : (lumaEndP < 0.0) != lumaMLTZero;
    float pixelOffset = goodSpan ? 0.5 - min(dstN, dstP) / (dstN + dstP) : 0.0;
    float subpixF = (-2.0 * subpixC + 3.0) * subpixC * subpixC;
    float offset = max(pixelOffset, subpixF * subpixF * FXAA_SUBPIX) * lengthSign;
    if (horzSpan) posM.y += offset;
    else posM.x += offset;
    return texture2D(tDiffuse, posM).rgb;
}
`;

// AgX and Khronos PBR Neutral, ported from three r170's tonemapping chunk (exposure applied by the caller)
const TONEMAP_ALT = /* glsl */ `
#if defined(TONEMAP_AGX)
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
    vec3(1.6605, -0.1246, -0.0182),
    vec3(-0.5876, 1.1329, -0.1006),
    vec3(-0.0728, -0.0083, 1.1187));
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
    vec3(0.6274, 0.0691, 0.0164),
    vec3(0.3293, 0.9195, 0.0880),
    vec3(0.0433, 0.0113, 0.8956));
vec3 agxDefaultContrastApprox(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 color) {
    const mat3 AgXInsetMatrix = mat3(
        vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
        vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
        vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
    const mat3 AgXOutsetMatrix = mat3(
        vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
        vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
        vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
    const float AgxMinEv = -12.47393;
    const float AgxMaxEv = 4.026069;
    color = AgXInsetMatrix * (LINEAR_SRGB_TO_LINEAR_REC2020 * color);
    color = clamp((log2(max(color, 1e-10)) - AgxMinEv) / (AgxMaxEv - AgxMinEv), 0.0, 1.0);
    color = AgXOutsetMatrix * agxDefaultContrastApprox(color);
    color = pow(max(vec3(0.0), color), vec3(2.2));
    return clamp(LINEAR_REC2020_TO_LINEAR_SRGB * color, 0.0, 1.0);
}
#elif defined(TONEMAP_NEUTRAL)
vec3 neutral(vec3 color) {
    const float StartCompression = 0.8 - 0.04;
    const float Desaturation = 0.15;
    float x = min(color.r, min(color.g, color.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    color -= offset;
    float peak = max(color.r, max(color.g, color.b));
    if (peak < StartCompression) return color;
    float d = 1.0 - StartCompression;
    float newPeak = 1.0 - d * d / (peak + d - StartCompression);
    color *= newPeak / peak;
    float g = 1.0 - 1.0 / (Desaturation * (peak - newPeak) + 1.0);
    return mix(color, vec3(newPeak), g);
}
#endif
`;

export const FINAL_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tGlass;
uniform vec2 uRes;
uniform float uTime;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uWarp;
uniform float uCA;
uniform float uFXAA;
uniform float uGlass;
uniform vec3 uShadowTint;
uniform vec3 uBg;
uniform vec4 uRects[${MAX_RECTS}];
uniform vec3 uRectParams[${MAX_RECTS}];
uniform vec3 uFlare;
uniform float uTidal;
uniform float uBlackout;
uniform int uRectCount;
uniform float uLumaCap;
uniform float uMaskDim;
uniform float uMaskStrength;
uniform float uDpr;
varying vec2 vUv;

${HASH}
${FXAA}
${TONEMAP_ALT}

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
    // Tidal stretching near the singularity: squeezed sideways, pulled out along the fall
    if (uTidal > 0.001) {
        vec2 c = uv - 0.5;
        c *= vec2(1.0 / (1.0 + uTidal * 1.4), 1.0 / (1.0 + uTidal * 0.15));
        uv = 0.5 + c;
    }
    vec2 fromC = uv - 0.5;
    vec3 col;
    float warpAmt = max(uWarp, uTidal * 1.8);

    if (warpAmt > 0.01) {
        col = vec3(0.0);
        vec2 ca = fromC * 0.006 * warpAmt;
        for (int i = 0; i < 8; i++) {
            float k = float(i) / 7.0;
            vec2 o = 0.5 + fromC * (1.0 - k * 0.045 * warpAmt);
            col.r += texture2D(tDiffuse, o + ca).r;
            col.g += texture2D(tDiffuse, o).g;
            col.b += texture2D(tDiffuse, o - ca).b;
        }
        col /= 8.0;
    } else if (uCA > 0.0) {
        vec2 ca = fromC * uCA * dot(fromC, fromC) * 4.0;
        col = vec3(texture2D(tDiffuse, uv + ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - ca).b);
    } else if (uFXAA > 0.5) {
        col = fxaa(uv);
    } else {
        col = texture2D(tDiffuse, uv).rgb;
    }

    // Readability: m dims and caps behind content blocks; g is how much frosted glass shows
    vec2 fc = gl_FragCoord.xy;
    float m = 0.0;
    float g = 0.0;
    for (int i = 0; i < ${MAX_RECTS}; i++) {
        if (i >= uRectCount) break;
        vec4 r = uRects[i];
        vec3 pw = uRectParams[i];
        float mi;
        if (pw.x > 0.5 && pw.x < 1.5) {
            // Free-standing text: wide, soft falloff that reads as shade, not a box (pw.z is its strength)
            float d = sdRoundBox(fc - r.xy, r.zw, min(r.z, r.w) * 0.9);
            mi = (1.0 - smoothstep(-80.0 * uDpr, 170.0 * uDpr, d)) * pw.z;
        } else {
            // Panels: stays under the panel itself, so nothing shows around it
            float rad = pw.z * uDpr;
            float d = sdRoundBox(fc - r.xy, r.zw, rad);
            mi = 1.0 - smoothstep(-8.0 * uDpr, 1.0 * uDpr, d);
            if (pw.x > 1.5) {
                // Glass: inset by the corner radius, then a 12 px feather, so the blur's
                // edge sits well inside the panel and a frame of rect lag never shows
                vec2 inner = max(r.zw - rad, vec2(1.0));
                float dg = sdRoundBox(fc - r.xy, inner, min(rad, min(inner.x, inner.y)));
                g = max(g, (1.0 - smoothstep(-12.0 * uDpr, 0.0, dg)) * pw.y);
            }
        }
        m = max(m, mi * pw.y);
    }
    m *= uMaskStrength;
    g *= uGlass * uMaskStrength;
    if (g > 0.001) col = mix(col, texture2D(tGlass, uv).rgb, g);

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

#if defined(TONEMAP_AGX)
    col = agx(col * uExposure);
#elif defined(TONEMAP_NEUTRAL)
    col = neutral(col * uExposure);
#else
    col = acesFilmic(col * uExposure);
#endif

    // Grade: cool the shadows slightly
    float l0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, col * uShadowTint, (1.0 - smoothstep(0.0, 0.35, l0)) * 0.5);

    // Readability: cap luminance and dim behind content blocks
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
    col *= 1.0 - uBlackout;
    gl_FragColor = vec4(col, 1.0);
}
`;
