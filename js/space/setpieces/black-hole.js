/* CONTACT: a Gargantua-style black hole. Inside 30 Rs, null geodesics are
   ray-traced in Schwarzschild spacetime (units of Rs), bending the baked Milky
   Way cube map and picking up every crossing of the accretion disk, so the
   lensed back side of the disk and the photon ring come for free. Light that
   leaves that sphere still has some bending to do: it's added in closed form.
   Rays that pass outside it (out to 60 Rs) take one bent lookup with no loop,
   the bend tapering to zero at the edge, so the lensed sky meets the plain
   background without a seam and only one sky is ever drawn.
   The disk has a Novikov-Thorne-like temperature profile, Keplerian shear and
   partial relativistic Doppler beaming.

   During the plunge the camera is a free-falling "raindrop" observer with speed
   beta = sqrt(rs / r) relative to local static observers. In Painleve-Gullstrand
   coordinates the backward ray's spatial direction is then (viewDir + beta * r_hat),
   and light arriving from viewDir is shifted by f = 1 / (1 + beta * viewDir.r_hat)
   (brightness ~ f^3). Inside the horizon (beta > 1) rays still trace back out to
   the sky, so the outside universe stays visible; only rays that fall back to the
   singularity, or directions no light can arrive from, are black. */
import * as THREE from 'three';
import { HASH, RAY } from '../shaders/common.glsl.js';
import { BLACKBODY } from '../shaders/blackbody.glsl.js';
import { ORIGINS } from '../path-data.js';
import { skyGain } from './sky.js';

const RS = 25;          // world units per Schwarzschild radius
const PROXY = 30;       // integration sphere radius in Rs
const BAND = 60;        // outer edge of the cheap lensing band (the drawn sphere), in Rs
const OUTER = 10;       // disk outer edge in Rs

const VERT = /* glsl */ `
varying vec3 vPosW;
void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform samplerCube uSky;
uniform sampler3D uNoise;
uniform vec3 uCenter;
uniform float uRs;
uniform mat3 uToLocal;
uniform float uTime;
uniform int uSteps;
uniform float uStepScale;
uniform float uProxy;
uniform float uBand;
uniform float uOuter;
uniform float uDoppler;
uniform float uTpeak;
uniform float uDiskIntensity;
uniform float uBetaMix;
uniform float uExposure;
uniform float uSkyGain;
uniform float uPresence;
uniform vec3 uNorth;
uniform float uStarCount;
uniform float uDpr;
varying vec3 vPosW;
${HASH}
${RAY}
${BLACKBODY}

// Stars for the lensed sky, statistically the same as sky.js's far stars (count, 60% in the
// galactic plane, magnitudes, temperatures and the on-screen point profile), so the field
// doesn't change where the two hand over. One candidate star per cell of a 260-cell grid,
// measured across the line of sight; pxCells is grid cells per drawing-buffer pixel.
vec3 procStars(vec3 d, float pxCells) {
    vec3 p = d * 260.0;
    vec3 i = floor(p);
    float lat = asin(clamp(dot(d, uNorth), -1.0, 1.0)) / 0.17;
    float perSr = 0.0318 + 0.2241 * exp(-0.5 * lat * lat);
    if (hash13(i) > perSr * uStarCount / 67600.0) return vec3(0.0);
    vec3 q = fract(p) - (hash33(i + 3.1) * 0.5 + 0.25);
    q -= d * dot(q, d);
    float mag = 0.04 + 0.86 * pow(hash13(i + 7.0), 6.0);
    float x = length(q) / (max(pxCells, 1e-4) * (1.3 + 2.4 * sqrt(mag)) * uDpr);
    float a = (exp(-24.0 * x * x) + 0.08 * exp(-4.8 * x * x)) * smoothstep(0.5, 0.3, x);
    float tu = hash13(i + 11.0);
    float tv = hash13(i + 13.0);
    float T = tu < 0.55 ? 3200.0 + tv * 1800.0
        : tu < 0.85 ? 5000.0 + tv * 2000.0
        : tu < 0.97 ? 7000.0 + tv * 4000.0
        : 11000.0 + tv * 14000.0;
    return blackbody(T) * mag * a;
}

vec3 disk(vec3 q, float rr, vec3 v, float detail, out float alpha) {
    float x = rr / 3.0;
    float prof = pow(x, -0.75) * pow(max(1.0 - sqrt(1.0 / x), 0.0), 0.25) / 0.488;
    float T = prof * uTpeak;
    float th = atan(q.z, q.x);
    float omega = 0.9 * pow(rr, -1.5);
    float a = th + uTime * omega;
    vec3 sp = vec3(cos(a) * rr, sin(a) * rr, rr * 0.6) * 0.075;
    float n1 = texture(uNoise, sp).r;
    float n2 = texture(uNoise, sp * vec3(3.0, 3.0, 9.0) + 0.3).a;
    // Seen from deep inside, the disk's fine radial structure is compressed into aliasing stripes: smooth it
    float streak = mix(1.0, 0.3 + 1.2 * pow(n1, 1.6) + 0.55 * n2, detail);

    vec3 tang = normalize(vec3(-q.z, 0.0, q.x));
    float beta = min(sqrt(0.5 / max(rr - 1.0, 0.5)), 0.7);
    float gamma = inversesqrt(1.0 - beta * beta);
    float cosA = dot(tang, -normalize(v));
    float g = 1.0 / (gamma * (1.0 - beta * cosA));
    float gEff = mix(1.0, g, uDoppler);
    float grav = sqrt(max(1.0 - 1.0 / rr, 0.0));

    vec3 c = blackbody(T * gEff * grav) * pow(gEff, 3.0) * pow(prof, 3.0) * streak * uDiskIntensity;
    float edge = smoothstep(2.6, 3.3, rr) * (1.0 - smoothstep(uOuter * 0.55, uOuter, rr));
    alpha = clamp(0.92 * edge * mix(0.8, 0.55 + 0.45 * n1, detail), 0.0, 1.0);
    return c * edge;
}

// Frequency shift f: brightness ~ f^3, hue toward blue (f > 1) or red (f < 1)
vec3 shiftLight(vec3 c, float f) {
    float I = min(f * f * f, 12.0);
    vec3 tint = f > 1.0
        ? mix(vec3(1.0), vec3(0.62, 0.8, 1.35), clamp((f - 1.0) * 0.35, 0.0, 0.8))
        : mix(vec3(1.0), vec3(1.4, 0.68, 0.45), clamp((1.0 - f) * 1.2, 0.0, 0.9));
    return c * I * tint;
}

// Weak-field bending, with the integrator's own force law (acceleration -1.5 h^2 p / r^5, Rs = 1):
// between points x0 and x1 along a ray's line (x measured from closest approach), a ray with
// impact parameter b turns by (G(x1) - G(x0)) / (2b). That is 2/b in total, and it matches the
// integrated orbit where the two meet.
float bendG(float x, float b) {
    float r2 = x * x + b * b;
    return x * (2.0 * r2 + b * b) / (r2 * sqrt(r2));
}

// Direction v at p, turned by angle a toward the centre
vec3 bendToward(vec3 p, vec3 v, float a) {
    vec3 c = dot(p, v) * v - p;
    float l = length(c);
    return l < 1e-6 ? v : normalize(v * cos(a) + c * (sin(a) / l));
}

void main() {
    vec3 rdW = normalize(vPosW - cameraPosition);
    vec3 ro = uToLocal * (cameraPosition - uCenter) / uRs;
    vec3 rd = normalize(uToLocal * rdW);

    // Free-falling observer (uBetaMix = 0 is a static observer, the normal view)
    float rCam = length(ro);
    vec3 rhat = ro / max(rCam, 1e-4);
    float beta = uBetaMix * inversesqrt(max(rCam, 1e-3));
    float denom = 1.0 + beta * dot(rd, rhat);
    if (denom <= 0.002) {
        // Inside the horizon, no light can arrive from these directions
        gl_FragColor = vec4(0.0, 0.0, 0.0, uPresence);
        return;
    }
    float fObs = 1.0 / denom;
    vec3 dir = normalize(rd + beta * rhat);
    float rCapture = rCam > 1.0 ? 1.0 : 0.05;

    // The straight line the ray starts on: impact parameter, and where along it the camera sits
    float b0 = max(length(cross(ro, dir)), 1e-3);
    float x0 = dot(ro, dir);
    bool outside = rCam > uProxy;

    vec3 col = vec3(0.0);
    float a = 0.0;
    float alpha = 1.0;
    float starW = 1.0;
    bool captured = false;
    vec3 vSky = dir;
    vec2 tp = raySphere(ro, dir, vec3(0.0), uProxy);
    if (outside && tp.x < 0.0) {
        // Outer band: the ray never enters the integration sphere. One lookup, bent by the
        // closed-form deflection from the camera to infinity, tapered to zero at the band's
        // edge; the procedural stars hand over to the real star field across the outer part
        float taper = 1.0 - smoothstep(uProxy, uBand, b0);
        vSky = bendToward(ro, dir, (2.0 - bendG(x0, b0)) / (2.0 * b0) * taper);
        alpha = 1.0 - smoothstep(mix(uProxy, uBand, 0.6), uBand, b0);
        starW = alpha;
    } else {
        vec3 p = ro;
        vec3 v = dir;
        if (outside) {
            // Entering from outside: add the bending picked up between the camera and the sphere
            p = ro + dir * tp.x;
            v = bendToward(p, dir, (bendG(dot(p, dir), b0) - bendG(x0, b0)) / (2.0 * b0));
        }
        vec3 hv = cross(p, v);
        float h2 = dot(hv, hv);

        int images = 0; // higher-order disk images are sub-pixel thin; past the third they only alias
        bool escaped = false;
        float detail = smoothstep(0.8, 3.0, rCam);
        // Leapfrog (kick-drift-kick, second order) with the acceleration cached between steps;
        // steps shrink near the photon sphere (r = 1.5), where orbit errors would otherwise band the image
        float r2 = dot(p, p);
        vec3 acc = -1.5 * h2 * p / (r2 * r2 * sqrt(r2));
        int maxImages = rCam < 2.0 ? 1 : 3;
        for (int i = 0; i < 220; i++) {
            if (i >= uSteps) break;
            float r = sqrt(dot(p, p));
            float dt = clamp(uStepScale * r * (0.5 + 0.5 * smoothstep(0.0, 1.0, abs(r - 1.5))) * (1.0 + r * 0.06), 0.006, 2.4);
            vec3 pp = p;
            vec3 vh = v + acc * (0.5 * dt);
            p += vh * dt;
            r2 = dot(p, p);
            acc = -1.5 * h2 * p / (r2 * r2 * sqrt(r2));
            v = vh + acc * (0.5 * dt);
            if (dot(p, p) < rCapture * rCapture) { captured = true; break; }
            if (pp.y * p.y < 0.0) {
                vec3 q = mix(pp, p, pp.y / (pp.y - p.y));
                float rr = length(q.xz);
                if (rr > 2.6 && rr < uOuter && images < maxImages) {
                    images++;
                    float da;
                    vec3 dc = disk(q, rr, v, detail, da);
                    col += (1.0 - a) * shiftLight(dc, fObs) * da;
                    a += (1.0 - a) * da;
                }
            }
            if (a > 0.98) break;
            if (r > uProxy + 0.5 && dot(p, v) > 0.0) { escaped = true; break; }
        }
        vSky = normalize(v);
        if (escaped) {
            // The rest of the way out: the remaining weak-field bend, in closed form
            float be = max(length(cross(p, vSky)), 1e-3);
            vSky = bendToward(p, vSky, (2.0 - bendG(dot(p, vSky), be)) / (2.0 * be));
        }
    }
    vec3 dirW = normalize(transpose(uToLocal) * vSky);
    // Grid cells per pixel (taken outside any branch, where derivatives are defined). Where the
    // lens squeezes many cells into one pixel, a star field can only alias: fade it there.
    float pxCells = max(length(dFdx(dirW)), length(dFdy(dirW))) * 260.0;
    if (!captured) {
        vec3 stars = procStars(dirW, pxCells) * (starW * smoothstep(0.9, 0.5, pxCells));
        vec3 sky = (textureCube(uSky, dirW).rgb + stars) * uSkyGain;
        col += (1.0 - a) * shiftLight(sky, fObs);
    }
    col *= uExposure;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Premultiplied: the band's outer edge (and a fading presence) shows the regular sky through
    gl_FragColor *= alpha * uPresence;
}
`;

export async function create(ctx) {
    const { T, noise, sky } = ctx;
    const origin = new THREE.Vector3(...ORIGINS.blackHole);
    const group = new THREE.Group();
    group.position.copy(origin);

    // Disk plane tilted slightly so the composition reads as a 3D object
    const orient = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.04, 0.0, -0.12));
    const toLocal = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(orient.clone().invert()));

    const uniforms = {
        uSky: { value: sky.cube },
        uNoise: { value: noise },
        uCenter: { value: origin.clone() },
        uRs: { value: RS },
        uToLocal: { value: toLocal },
        uTime: { value: 0 },
        uSteps: { value: T.bhSteps },
        uStepScale: { value: 7.2 / T.bhSteps },
        uProxy: { value: PROXY },
        uBand: { value: BAND },
        uOuter: { value: OUTER },
        uDoppler: { value: 0.45 },
        uTpeak: { value: 4800 },
        uDiskIntensity: { value: 2.4 },
        uBetaMix: { value: 0 },
        uExposure: { value: 1 },
        uSkyGain: { value: 1 },
        uPresence: { value: 1 },
        uNorth: { value: sky.frame.north },
        uStarCount: { value: sky.starCount || T.farStars },
        uDpr: { value: 1 },
    };
    // Premultiplied output: the band's rim fades so the regular sky shows through seamlessly
    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    let baseSteps = T.bhSteps;
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(BAND * RS, 64, 32), material);
    proxy.renderOrder = 12;
    group.add(proxy);

    return {
        group,
        update(f, presence = 1) {
            uniforms.uPresence.value = presence;
            // The lensed sky must match the background it replaces
            uniforms.uSkyGain.value = skyGain(f);
            uniforms.uDpr.value = f.dpr;
            uniforms.uTime.value = f.t;
            uniforms.uBetaMix.value = f.plunge.beta;
            uniforms.uExposure.value = f.plunge.exposure;
            // Rays from deep inside need more steps to climb back out
            const steps = f.plunge.active ? Math.min(220, Math.round(baseSteps * 1.8)) : baseSteps;
            uniforms.uSteps.value = steps;
            uniforms.uStepScale.value = 7.2 / steps;
        },
        setTier(tier) {
            baseSteps = tier.bhSteps;
        },
        dispose() {
            proxy.geometry.dispose();
            material.dispose();
        },
    };
}
