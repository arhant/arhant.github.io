/* HERO: an orbital sunrise. Earth's limb arcs through the lower right with the
   sun just behind it; scrolling lifts the camera and the sun breaks the horizon.
   Surface, clouds and city lights are baked into cube maps once. The
   atmosphere is a single-scattering shell (Rayleigh, Mie and ozone) marched in
   a few steps on medium/high, with the sunlight reaching each sample attenuated
   analytically; the same transmittance reddens the terminator. Its shell is
   ~3.5x thicker than Earth's so the limb reads at this distance. The low tier
   keeps a cheaper one-sample approximation.
   Also: aurora curtains over the night side, a space station skimming the
   glowing limb (shadowed by the planet when it passes into night), and the
   lens flare as the sun clears the horizon. */
import * as THREE from 'three';
import { bakeCubeAsync } from '../lib/bake.js';
import { SIMPLEX, RAY } from '../shaders/common.glsl.js';
import { ORIGINS, SUNS, viewPoint } from '../path-data.js';
import { createGlow } from '../lib/glow.js';

const R = 100;
const CENTER = new THREE.Vector3(95, -100, -170);

const EARTH_HEIGHT = /* glsl */ `
float earthHeight(vec3 d) {
    vec3 w = vec3(fbm3(d * 1.3 + 11.0, 4), fbm3(d * 1.3 + 23.0, 4), fbm3(d * 1.3 + 37.0, 4));
    return fbm3(d * 1.15 + w * 0.6, 7) - 0.06;
}
`;

const ALBEDO_FRAG = /* glsl */ `
varying vec3 vDir;
${SIMPLEX}
${EARTH_HEIGHT}
void main() {
    vec3 d = normalize(vDir);
    float coast = earthHeight(d);
    float land = smoothstep(0.0, 0.012, coast);
    float lat = abs(d.y);

    float arid = smoothstep(0.05, 0.45, fbm3(d * 2.2 + 51.0, 4) + 0.4 * (1.0 - abs(lat - 0.28) * 4.0));
    vec3 forest = vec3(0.030, 0.062, 0.022);
    vec3 grass = vec3(0.090, 0.110, 0.045);
    vec3 desert = vec3(0.360, 0.270, 0.150);
    vec3 rock = vec3(0.170, 0.140, 0.115);
    vec3 landCol = mix(mix(forest, grass, smoothstep(-0.2, 0.3, fbm3(d * 6.0, 3))), desert, arid);
    landCol = mix(landCol, rock, smoothstep(0.12, 0.3, coast));
    landCol *= 0.85 + 0.3 * fbm3(d * 24.0, 3);

    float ice = smoothstep(0.04, 0.10, (lat - 0.80) + fbm3(d * 5.0, 3) * 0.08);
    vec3 ocean = mix(vec3(0.004, 0.016, 0.045), vec3(0.010, 0.050, 0.085), smoothstep(-0.10, 0.0, coast));
    vec3 col = mix(ocean, landCol, land);
    col = mix(col, vec3(0.80, 0.84, 0.90), ice);
    // Stored sqrt-encoded: 8-bit linear has too few levels for the dark oceans and bands them
    gl_FragColor = vec4(sqrt(col), (1.0 - land) * (1.0 - ice));
}
`;

const AUX_FRAG = /* glsl */ `
varying vec3 vDir;
${SIMPLEX}
${EARTH_HEIGHT}
void main() {
    vec3 d = normalize(vDir);
    vec3 w = vec3(fbm3(d * 2.0 + 3.0, 3), fbm3(d * 2.0 + 13.0, 3), fbm3(d * 2.0 + 29.0, 3));
    float c = fbm3(d * 2.6 + w * 0.9, 6);
    float lat = d.y;
    float bl = lat / 0.12;
    float bm = (abs(lat) - 0.6) / 0.15;
    float belts = 0.15 * exp(-bl * bl) + 0.18 * exp(-bm * bm);
    float cloud = smoothstep(0.02, 0.5, c + belts - 0.04);
    cloud *= 0.7 + 0.3 * (fbm3(d * 18.0, 3) * 0.5 + 0.5);

    float coast = earthHeight(d);
    float land = smoothstep(0.0, 0.012, coast);
    float near = 1.0 - smoothstep(0.0, 0.14, coast);
    float pop = smoothstep(0.15, 0.7, fbm3(d * 7.0 + 77.0, 4) + 0.3) * smoothstep(0.78, 0.25, abs(lat));
    float points = smoothstep(0.55, 0.95, snoise(d * 240.0)) + 0.35 * smoothstep(0.45, 0.9, snoise(d * 90.0 + 4.0));
    float city = land * pop * (0.35 + 0.65 * near) * points;
    gl_FragColor = vec4(clamp(city * 1.4, 0.0, 1.0), clamp(cloud, 0.0, 1.0), 0.0, 1.0);
}
`;

/* Shared by the shell and the surface. World units: the planet radius is 100. */
const ATMOSPHERE = /* glsl */ `
uniform float uRp;
uniform float uRa;
uniform vec3 uBetaR;    // Rayleigh scattering, per world unit
uniform float uBetaM;   // Mie scattering (extinction is 1.1x)
uniform vec3 uBetaO;    // ozone absorption
uniform vec2 uH;        // Rayleigh and Mie scale heights
uniform vec2 uOzone;    // ozone layer: centre altitude, half-width (tent profile)

// Air mass (optical depth over the vertical column above r) of an exponential layer with scale
// height H, along a ray from radius r with zenith cosine mu, over length d. Analytic, after
// Bruneton & Neyret 2008, "Precomputed Atmospheric Scattering" (BSD-3); ground ignored.
float airMass(float H, float r, float mu, float d) {
    float a = sqrt((0.5 / H) * r);
    vec2 a01 = a * vec2(mu, mu + d / r);
    vec2 a01s = sign(a01);
    vec2 a01sq = a01 * a01;
    float x = a01s.y > a01s.x ? exp(a01sq.x) : 0.0;
    vec2 y = a01s / (2.3193 * abs(a01) + sqrt(1.52 * a01sq + 4.0)) * vec2(1.0, exp(-d / H * (d / (2.0 * r) + mu)));
    return max(sqrt(6.2831 * r / H) * (x + dot(y, vec2(1.0, -1.0))), 0.0);
}

// Ozone column above altitude h
float ozoneAbove(float h) {
    float lo = uOzone.x - uOzone.y;
    float hi = uOzone.x + uOzone.y;
    if (h <= lo) return uOzone.y;
    if (h >= hi) return 0.0;
    return h < uOzone.x ? uOzone.y - 0.5 * (h - lo) * (h - lo) / uOzone.y : 0.5 * (hi - h) * (hi - h) / uOzone.y;
}

// Optical depth toward the sun from radius r (sun at zenith cosine mu, local Rayleigh and Mie
// densities rhoR, rhoM), and in .a whether the planet leaves the sun in view there (softened over
// a fraction of a degree). Mie and ozone ride on the Rayleigh air mass, scaled by their own column.
vec4 sunPath(float r, float mu, float rhoR, float rhoM) {
    r = clamp(r, uRp, uRa);
    float dTop = -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + uRa * uRa, 0.0));
    float am = airMass(uH.x, r, mu, dTop);
    float muH = -sqrt(max(1.0 - (uRp / r) * (uRp / r), 0.0));
    vec3 od = am * (uBetaR * (uH.x * rhoR) + (1.1 * uBetaM * uH.y) * rhoM + uBetaO * ozoneAbove(r - uRp));
    return vec4(od, smoothstep(muH - 0.01, muH + 0.01, mu));
}

// Fraction of sunlight reaching radius r with the sun at zenith cosine mu
vec3 sunTransmittance(float r, float mu) {
    float h = clamp(r - uRp, 0.0, uRa - uRp);
    vec4 sp = sunPath(r, mu, exp(-h / uH.x), exp(-h / uH.y));
    return exp(-sp.rgb) * sp.a;
}
`;

const SURFACE_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
    vObj = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SURFACE_FRAG = /* glsl */ `
uniform samplerCube uAlbedo;
uniform samplerCube uAux;
uniform vec3 uSunDir;
uniform vec3 uSunObj;
uniform vec3 uSunColor;
uniform float uCloudRot;
uniform float uCity;
uniform int uSteps;       // 0 on the low tier: hand-tuned sunlight tint instead of transmittance
uniform vec3 uZenithT;    // transmittance with the sun overhead (keeps midday white)
uniform float uGlint;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
${ATMOSPHERE}

vec3 rotY(vec3 v, float a) {
    float c = cos(a), s = sin(a);
    return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    vec3 L = uSunDir;
    vec4 alb = textureCube(uAlbedo, vObj);
    alb.rgb *= alb.rgb;
    float ocean = alb.a;
    float NdL = dot(N, L);
    float NdV = max(dot(N, V), 0.0);
    float day = smoothstep(-0.1, 0.25, NdL);
    float diff = max((NdL + 0.06) / 1.06, 0.0);
    vec3 tint;
    vec3 cloudTint;
    float cloudDiff;
    if (uSteps > 0) {
        // Sunlight reddened by the air it crosses; cloud tops sit higher, so they catch the
        // dawn a little past the ground's terminator
        tint = sunTransmittance(uRp + 0.05, NdL) / uZenithT;
        cloudTint = sunTransmittance(uRp + 0.6, NdL + 0.08) / uZenithT;
        cloudDiff = max((NdL + 0.12) / 1.12, 0.0);
    } else {
        tint = mix(vec3(1.0, 0.5, 0.3), vec3(1.0), smoothstep(0.0, 0.3, NdL));
        cloudTint = tint;
        cloudDiff = diff;
    }

    float city = textureCube(uAux, vObj).r;
    float cloud = textureCube(uAux, rotY(vObj, uCloudRot)).g;
    float shadow = textureCube(uAux, rotY(normalize(vObj + uSunObj * 0.012), uCloudRot)).g;

    vec3 surf = alb.rgb * diff * tint * (1.0 - 0.55 * shadow * day);
    // Sun glint on wind-roughened water: a Cox-Munk (Beckmann) lobe with mean square slope
    // 0.003 + 0.00512 * 7 m/s, in the sunlight that reaches the sea (orange at sunrise)
    vec3 H = normalize(L + V);
    float c2 = max(dot(N, H), 1e-3);
    c2 *= c2;
    float lobe = exp((c2 - 1.0) / (c2 * 0.0388)) / (3.14159 * 0.0388 * c2 * c2);
    float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    float fresH = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    float glint = lobe * fresH / (4.0 * max(NdV, 0.2)) * smoothstep(0.0, 0.04, NdL) * ocean * (1.0 - cloud);
    surf += vec3(1.0, 0.9, 0.75) * tint * glint * uGlint * day + vec3(0.02, 0.05, 0.09) * fres * ocean * day * 0.6;

    vec3 col = mix(surf, vec3(0.95) * cloudDiff * cloudTint, cloud * 0.92) * uSunColor;
    float night = 1.0 - smoothstep(-0.18, 0.04, NdL);
    col += vec3(1.0, 0.62, 0.32) * city * night * (1.0 - cloud * 0.85) * uCity;
    col += vec3(0.18, 0.35, 0.8) * pow(1.0 - NdV, 3.0) * smoothstep(-0.25, 0.3, NdL) * 0.5;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const ATMO_VERT = /* glsl */ `
varying vec3 vPosW;
void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uCenter;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uIntensity;
uniform int uSteps;       // 0: the original one-sample approximation (low tier)
uniform float uScatter;
varying vec3 vPosW;
${RAY}
${ATMOSPHERE}
void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vPosW - ro);
    vec2 tA = raySphere(ro, rd, uCenter, uRa);
    vec2 tP = raySphere(ro, rd, uCenter, uRp);
    float t0 = max(tA.x, 0.0);
    float t1 = tP.x > 0.0 ? tP.x : tA.y;
    float mu = dot(rd, uSunDir);
    vec3 col;
    if (uSteps == 0) {
        float thick = uRa - uRp;
        float chord = max(t1 - t0, 0.0) / thick;
        vec3 mid = ro + rd * (0.5 * (t0 + t1)) - uCenter;
        float hgt = clamp((length(mid) - uRp) / thick, 0.0, 1.0);
        float sunH = dot(normalize(mid), uSunDir);
        float dens = chord * exp(-hgt * 2.0);
        vec3 beta = vec3(0.075, 0.18, 0.45);
        vec3 scat = 1.0 - exp(-beta * dens);
        vec3 sunT = exp(-beta * 7.0 * (1.0 - smoothstep(-0.2, 0.5, sunH)));
        float lit = smoothstep(-0.3, 0.12, sunH);
        float rayleigh = 0.75 * (1.0 + mu * mu);
        float mie = hgPhase(mu, 0.76) * (1.0 - exp(-dens * 0.08)) * 9.0;
        col = (scat * rayleigh + mie * vec3(1.0, 0.82, 0.62)) * sunT * lit * uSunColor * uIntensity;
    } else {
        // Single scattering along the view ray: each sample adds the sunlight that reaches it,
        // scattered toward the camera and dimmed by the air between it and the camera.
        // (Silhouette pixels can miss the analytic shell: nothing to add there.)
        if (tA.y <= 0.0 || t1 <= t0) discard;
        float ds = (t1 - t0) / float(uSteps);
        vec3 tau = vec3(0.0);
        vec3 sumR = vec3(0.0);
        vec3 sumM = vec3(0.0);
        for (int i = 0; i < 8; i++) {
            if (i >= uSteps) break;
            vec3 P = ro + rd * (t0 + (float(i) + 0.5) * ds) - uCenter;
            float r = length(P);
            float h = max(r - uRp, 0.0);
            float rhoR = exp(-h / uH.x);
            float rhoM = exp(-h / uH.y);
            float rhoO = max(1.0 - abs(h - uOzone.x) / uOzone.y, 0.0);
            vec3 ext = (uBetaR * rhoR + 1.1 * uBetaM * rhoM + uBetaO * rhoO) * ds;
            vec4 sp = sunPath(r, dot(P, uSunDir) / r, rhoR, rhoM);
            vec3 T = exp(-(tau + 0.5 * ext + sp.rgb)) * sp.a;
            sumR += T * rhoR;
            sumM += T * rhoM;
            tau += ext;
        }
        float phaseR = 0.0597 * (1.0 + mu * mu);
        col = (sumR * uBetaR * phaseR + sumM * (uBetaM * hgPhase(mu, 0.76))) * ds * uSunColor * uScatter;
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const MOON_FRAG = /* glsl */ `
uniform sampler3D uNoise;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
    vec3 n = normalize(vObj);
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float maria = smoothstep(0.42, 0.62, texture(uNoise, n * 0.35 + 0.2).r);
    float f1 = texture(uNoise, n * 1.1 + 0.3).b;
    float f2 = texture(uNoise, n * 2.7 + 0.5).b;
    float rims = smoothstep(0.30, 0.38, f1) * (1.0 - smoothstep(0.38, 0.5, f1)) + 0.6 * smoothstep(0.32, 0.4, f2) * (1.0 - smoothstep(0.4, 0.5, f2));
    float albedo = 0.17 - 0.07 * maria + 0.05 * rims + 0.03 * (texture(uNoise, n * 6.0).g - 0.5);
    float NdL = max(dot(N, uSunDir), 0.0);
    float NdV = max(dot(N, V), 0.0);
    float ls = NdL / max(NdL + NdV, 1e-3);
    vec3 earthshine = vec3(0.010, 0.013, 0.020) * (0.6 + 0.4 * dot(N, V));
    gl_FragColor = vec4(vec3(albedo) * ls * 2.0 * uSunColor + albedo * earthshine * 6.0, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const SUN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SUN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uCore;
uniform float uScale;
varying vec2 vUv;
void main() {
    float rr = length(vUv * 2.0 - 1.0) * uScale;
    float disc = smoothstep(1.03, 0.97, rr);
    float glow = 0.5 * exp(-rr * 0.9) + 0.18 * exp(-rr * 0.22);
    gl_FragColor = vec4(uColor * (disc * uCore + glow * 3.0) * smoothstep(uScale, uScale * 0.6, rr), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const AURORA_FRAG = /* glsl */ `
uniform sampler3D uNoise;
uniform float uTime;
uniform vec3 uSunDir;
uniform float uIntensity;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
    vec3 n = normalize(vObj);
    float lat = abs(n.y);
    float lon = atan(n.z, n.x);
    float wob = texture(uNoise, vec3(lon * 0.6, uTime * 0.01, 0.2)).r - 0.5;
    float ov = (lat - 0.74 - wob * 0.05) / 0.035;
    float oval = exp(-ov * ov);
    float folds = texture(uNoise, vec3(lon * 0.8, uTime * 0.015, lat * 2.0)).a;
    float rays = 0.8 + 0.2 * sin(lon * 70.0 + folds * 10.0 + uTime * 0.4);
    vec3 N = normalize(vNormalW);
    float night = 1.0 - smoothstep(-0.15, 0.08, dot(N, uSunDir));
    vec3 V = normalize(cameraPosition - vPosW);
    float limb = 1.0 / (0.18 + max(dot(N, V), 0.0));
    float I = oval * folds * folds * rays * night * limb * uIntensity;
    vec3 col = mix(vec3(0.12, 1.0, 0.45), vec3(0.9, 0.25, 0.55), smoothstep(0.75, 0.8, lat + wob * 0.04));
    gl_FragColor = vec4(col * I, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const STATION_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;
void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const STATION_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPanel;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCenter;
uniform float uR;
uniform vec3 uFill;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;
void main() {
    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vPosW);
    vec3 L = uSunDir;
    // Planet shadow: does the ray toward the sun hit the planet?
    vec3 oc = vPosW - uCenter;
    float b = dot(oc, L);
    float d2 = dot(oc, oc) - b * b;
    float lit = b < 0.0 ? smoothstep(uR * uR * 0.97, uR * uR * 1.03, d2) : 1.0;
    vec3 base = uColor;
    float shine = 24.0;
    if (uPanel > 0.5) {
        // Cell frames, anti-aliased to one pixel; once cells shrink toward a pixel the grid
        // turns into its average instead of shimmering as the station drifts
        vec2 cell = vUv * vec2(5.0, 18.0);
        vec2 fw = max(fwidth(cell), vec2(1e-4));
        vec2 g = abs(fract(cell) - 0.5);
        vec2 line = smoothstep(0.47 - fw, 0.47 + fw, g);
        float grid = max(line.x, line.y);
        grid = mix(grid, 0.12, smoothstep(0.2, 0.45, max(fw.x, fw.y)));
        base = mix(vec3(0.03, 0.05, 0.12), vec3(0.32, 0.27, 0.18), grid);
        shine = 80.0;
    }
    float diff = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), shine) * (uPanel > 0.5 ? 2.0 : 0.6);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    float fill = max(dot(N, normalize(uFill)), 0.0) * 0.55 + 0.12;
    vec3 col = (base * diff + vec3(1.0, 0.92, 0.8) * spec) * uSunColor * lit
             + base * fill * vec3(0.75, 0.8, 1.0)
             + vec3(1.0, 0.6, 0.3) * rim * 0.12;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

/* A small ISS-like station: truss, solar array wings, pressurised modules, radiators */
function buildStation(uniformsBase) {
    const station = new THREE.Group();
    const mat = (color, panel = 0) => new THREE.ShaderMaterial({
        uniforms: { ...uniformsBase, uColor: { value: new THREE.Vector3(...color) }, uPanel: { value: panel } },
        vertexShader: STATION_VERT,
        fragmentShader: STATION_FRAG,
        side: THREE.DoubleSide,
    });
    const metal = mat([0.55, 0.55, 0.58]);
    const white = mat([0.8, 0.8, 0.78]);
    const panels = mat([0, 0, 0], 1);
    const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x, y, z);
        mesh.rotation.set(rx, ry, rz);
        mesh.renderOrder = 10;
        station.add(mesh);
    };
    add(new THREE.BoxGeometry(8, 0.22, 0.22), metal, 0, 0, 0);
    const wing = new THREE.PlaneGeometry(0.75, 2.6);
    for (const x of [-3.6, -2.7, 2.7, 3.6]) {
        add(wing, panels, x, 1.5, 0);
        add(wing, panels, x, -1.5, 0);
    }
    add(new THREE.CylinderGeometry(0.32, 0.32, 3.2, 16), white, 0, 0, 0.1, Math.PI / 2, 0, 0);
    add(new THREE.CylinderGeometry(0.28, 0.28, 1.6, 16), white, 0.7, 0, 1.2, 0, 0, Math.PI / 2);
    const radiator = new THREE.PlaneGeometry(0.5, 1.6);
    add(radiator, white, -1.2, 0, -1.1, Math.PI / 2, 0, 0);
    add(radiator, white, 1.2, 0, -1.1, Math.PI / 2, 0, 0);
    return station;
}

// View-ray samples through the shell per tier; 0 keeps the one-sample approximation
const ATMO_STEPS = { high: 8, medium: 4, low: 0 };
const ATMO_THICK = 3.5;

/* Earth's vertical optical depths (Rayleigh 0.047/0.109/0.265, ozone 0.010/0.028/0.001), spread
   over scale heights stretched with the shell. Rayleigh (1.4x, a warmer low sun), Mie (0.15, a
   hazy day) and ozone (1.5x) are raised and the shell's gain set by eye against the original
   hero shot. */
function atmosphereUniforms() {
    const H = [1.5, 0.8];               // Rayleigh, Mie scale heights in world units
    const ozone = [1.45, 0.9];
    const betaR = new THREE.Vector3(0.0465, 0.1086, 0.265).multiplyScalar(1.4 / H[0]);
    const betaM = 0.15 / H[1];
    const betaO = new THREE.Vector3(0.00975, 0.0282, 0.0013).multiplyScalar(1.5 / ozone[1]);
    // Transmittance with the sun overhead (vertical columns), so midday stays white
    const col = (h) => h * (1 - Math.exp(-ATMO_THICK / h));
    const zen = new THREE.Vector3(
        Math.exp(-(betaR.x * col(H[0]) + 1.1 * betaM * col(H[1]) + betaO.x * ozone[1])),
        Math.exp(-(betaR.y * col(H[0]) + 1.1 * betaM * col(H[1]) + betaO.y * ozone[1])),
        Math.exp(-(betaR.z * col(H[0]) + 1.1 * betaM * col(H[1]) + betaO.z * ozone[1])),
    );
    return {
        uRp: { value: R },
        uRa: { value: R + ATMO_THICK },
        uBetaR: { value: betaR },
        uBetaM: { value: betaM },
        uBetaO: { value: betaO },
        uH: { value: new THREE.Vector2(...H) },
        uOzone: { value: new THREE.Vector2(...ozone) },
        uZenithT: { value: zen },
    };
}

export async function create(ctx) {
    const { renderer, T, noise } = ctx;
    const origin = new THREE.Vector3(...ORIGINS.earth);
    const group = new THREE.Group();
    group.position.copy(origin);

    const sunDir = new THREE.Vector3(...SUNS.earth).normalize();
    const sunColor = new THREE.Vector3(2.1, 2.0, 1.85);

    const [albedo, aux] = await Promise.all([
        bakeCubeAsync(renderer, { size: T.earthCube, fragment: ALBEDO_FRAG, label: 'earth-albedo' }),
        bakeCubeAsync(renderer, { size: T.earthCube, fragment: AUX_FRAG, label: 'earth-aux' }),
    ]);

    const atmo = atmosphereUniforms();
    const steps = { uSteps: { value: ATMO_STEPS[T.name] || 0 } };

    // Planet: tilted axis, slow spin
    const tilt = new THREE.Group();
    tilt.position.copy(CENTER);
    tilt.rotation.set(0.35, 0, THREE.MathUtils.degToRad(-23.4));
    group.add(tilt);
    const spin = new THREE.Group();
    tilt.add(spin);

    const seg = T.sphereSeg;
    const surfUniforms = {
        ...atmo,
        ...steps,
        uAlbedo: { value: albedo.texture },
        uAux: { value: aux.texture },
        uSunDir: { value: sunDir },
        uSunObj: { value: new THREE.Vector3() },
        uSunColor: { value: sunColor },
        uCloudRot: { value: 0 },
        uCity: { value: 1.6 },
        uGlint: { value: 1 },
    };
    const surface = new THREE.Mesh(
        new THREE.SphereGeometry(R, seg, seg / 2),
        new THREE.ShaderMaterial({ uniforms: surfUniforms, vertexShader: SURFACE_VERT, fragmentShader: SURFACE_FRAG }),
    );
    surface.renderOrder = 10;
    spin.add(surface);

    const atmoUniforms = {
        ...atmo,
        ...steps,
        uCenter: { value: new THREE.Vector3() },
        uSunDir: { value: sunDir },
        uSunColor: { value: sunColor },
        uIntensity: { value: 0.8 },
        uScatter: { value: 12 },
    };
    const shell = new THREE.Mesh(
        new THREE.SphereGeometry(R * 1.035, seg, seg / 2),
        new THREE.ShaderMaterial({
            uniforms: atmoUniforms,
            vertexShader: ATMO_VERT,
            fragmentShader: ATMO_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }),
    );
    shell.position.copy(CENTER);
    shell.renderOrder = 20;
    group.add(shell);

    // Moon: craters and maria from the shared noise texture, Lommel-Seeliger shading
    const moon = new THREE.Mesh(
        new THREE.SphereGeometry(20, 64, 32),
        new THREE.ShaderMaterial({
            uniforms: { uNoise: { value: noise }, uSunDir: { value: sunDir }, uSunColor: { value: sunColor } },
            vertexShader: SURFACE_VERT,
            fragmentShader: MOON_FRAG,
        }),
    );
    moon.position.set(250, 135, -820);
    moon.renderOrder = 10;
    group.add(moon);

    // Sun: an HDR billboard placed "at infinity" along sunDir from the camera
    const SUN_SCALE = 14;
    const sunUniforms = { uColor: { value: new THREE.Vector3(1.0, 0.93, 0.82) }, uCore: { value: 30 }, uScale: { value: SUN_SCALE } };
    const sun = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
            uniforms: sunUniforms,
            vertexShader: SUN_VERT,
            fragmentShader: SUN_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }),
    );
    sun.renderOrder = 1;
    sun.frustumCulled = false;
    const SUN_DIST = 20000;
    const sunRadius = Math.tan(THREE.MathUtils.degToRad(0.55)) * SUN_DIST;
    sun.scale.setScalar(sunRadius * SUN_SCALE * 2);
    ctx.scene.add(sun);

    // Aurora: a thin emissive shell fixed to the tilted axis (not the spin)
    const auroraUniforms = {
        uNoise: { value: noise }, uTime: { value: 0 }, uSunDir: { value: sunDir }, uIntensity: { value: 0.42 },
    };
    const aurora = new THREE.Mesh(
        new THREE.SphereGeometry(R * 1.014, seg, seg / 2),
        new THREE.ShaderMaterial({
            uniforms: auroraUniforms,
            vertexShader: SURFACE_VERT,
            fragmentShader: AURORA_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }),
    );
    aurora.renderOrder = 19;
    tilt.add(aurora);

    // Space station against the dark sky above the limb; a soft fill light keeps it readable
    // while the sun (behind the planet) only catches its edges
    const stationHome = new THREE.Vector3(...viewPoint(0.0, 22, 13, 100)).sub(origin);
    const station = buildStation({
        uSunDir: { value: sunDir },
        uSunColor: { value: sunColor },
        uCenter: { value: CENTER.clone().add(origin) },
        uR: { value: R },
        uFill: { value: new THREE.Vector3(-0.4, 0.5, 0.8) },
    });
    group.add(station);
    const navLights = [
        { glow: createGlow({ color: [1, 0.15, 0.1], core: 0.9, halo: 0.6, size: 1.4 }), pos: [-4, 0, 0], phase: 0 },
        { glow: createGlow({ color: [0.2, 1, 0.3], core: 0.9, halo: 0.6, size: 1.4 }), pos: [4, 0, 0], phase: 0.5 },
    ];
    navLights.forEach((l) => { l.glow.position.set(...l.pos); station.add(l.glow); });

    const inv = new THREE.Matrix4();
    const tmp = new THREE.Vector3();
    const toC = new THREE.Vector3();
    const sunNdc = new THREE.Vector3();
    const camFwd = new THREE.Vector3();

    return {
        group,
        update(f) {
            spin.rotation.y = f.t * 0.01;
            surfUniforms.uCloudRot.value = f.t * 0.004;
            atmoUniforms.uCenter.value.copy(tilt.getWorldPosition(tmp));
            // Sun direction in the spinning surface's object space (for cloud shadows)
            surface.updateMatrixWorld();
            inv.copy(surface.matrixWorld).invert();
            surfUniforms.uSunObj.value.copy(sunDir).transformDirection(inv);
            sun.position.copy(f.camera.position).addScaledVector(sunDir, SUN_DIST);
            sun.quaternion.copy(f.camera.quaternion);
            auroraUniforms.uTime.value = f.t;

            // Station: slow drift and tumble around its spot
            station.position.copy(stationHome);
            station.position.x += Math.sin(f.t * 0.05) * 3;
            station.position.y += Math.sin(f.t * 0.037) * 1.2;
            station.rotation.set(0.5 + Math.sin(f.t * 0.03) * 0.08, -0.35 + Math.sin(f.t * 0.02) * 0.25, 0.3);

            // The hero's sun and flare belong to the hero: fade them as the camera leaves
            const heroOnly = 1 - THREE.MathUtils.smoothstep(f.s, 0.55, 0.85);
            sunUniforms.uCore.value = 30 * heroOnly;
            sunUniforms.uColor.value.set(1.0, 0.93, 0.82).multiplyScalar(heroOnly);
            const blink = (f.t % 1.4) / 1.4;
            navLights.forEach((l) => { l.glow.visible = Math.abs(blink - l.phase) < 0.08; });

            // Lens flare once the sun clears the limb
            toC.copy(tilt.getWorldPosition(tmp)).sub(f.camera.position);
            const dist = toC.length();
            toC.divideScalar(dist);
            const angR = Math.asin(Math.min(1, (R * 1.01) / dist));
            const ang = Math.acos(Math.min(1, Math.max(-1, toC.dot(sunDir))));
            const clear = THREE.MathUtils.smoothstep(ang - angR, -0.004, 0.03);
            f.camera.getWorldDirection(camFwd);
            if (clear > 0 && camFwd.dot(sunDir) > 0.2) {
                sunNdc.copy(f.camera.position).addScaledVector(sunDir, 1000).project(f.camera);
                const edge = Math.max(Math.abs(sunNdc.x), Math.abs(sunNdc.y));
                const onScreen = 1 - THREE.MathUtils.smoothstep(edge, 0.95, 1.35);
                f.flare.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5, clear * onScreen * 0.85 * heroOnly);
            }
        },
        setVisible(v) { sun.visible = v; },
        setTier(tier) {
            steps.uSteps.value = ATMO_STEPS[tier.name] || 0;
        },
        dispose() {
            ctx.scene.remove(sun);
            albedo.dispose();
            aux.dispose();
            group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
            sun.geometry.dispose();
            sun.material.dispose();
        },
    };
}
