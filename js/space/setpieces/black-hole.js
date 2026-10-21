/* CONTACT: a Gargantua-style black hole. A proxy sphere (30 Rs) ray-traces
   null geodesics in Schwarzschild spacetime (units of Rs), bending the baked
   Milky Way cube map and picking up every crossing of the accretion disk, so
   the lensed back side of the disk and the photon ring come for free.
   The disk has a Novikov-Thorne-like temperature profile, Keplerian shear and
   partial relativistic Doppler beaming. */
import * as THREE from 'three';
import { HASH, RAY } from '../shaders/common.glsl.js';
import { BLACKBODY } from '../shaders/blackbody.glsl.js';
import { ORIGINS } from '../path-data.js';

const RS = 25;          // world units per Schwarzschild radius
const PROXY = 30;       // proxy sphere radius in Rs
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
uniform float uOuter;
uniform float uDoppler;
uniform float uTpeak;
uniform float uDiskIntensity;
varying vec3 vPosW;
${HASH}
${RAY}
${BLACKBODY}

vec3 procStars(vec3 d) {
    vec3 p = d * 260.0;
    vec3 i = floor(p);
    float h = hash13(i);
    if (h < 0.982) return vec3(0.0);
    vec3 c = hash33(i + 3.1) * 0.8 + 0.1;
    float s = smoothstep(0.14, 0.0, length(fract(p) - c)) * pow((h - 0.982) / 0.018, 3.0) * 0.9;
    return mix(vec3(1.0, 0.8, 0.6), vec3(0.7, 0.82, 1.0), hash13(i + 7.0)) * s;
}

vec3 disk(vec3 q, float rr, vec3 v, out float alpha) {
    float x = rr / 3.0;
    float prof = pow(x, -0.75) * pow(max(1.0 - sqrt(1.0 / x), 0.0), 0.25) / 0.488;
    float T = prof * uTpeak;
    float th = atan(q.z, q.x);
    float omega = 0.9 * pow(rr, -1.5);
    float a = th + uTime * omega;
    vec3 sp = vec3(cos(a) * rr, sin(a) * rr, rr * 0.6) * 0.075;
    float n1 = texture(uNoise, sp).r;
    float n2 = texture(uNoise, sp * vec3(3.0, 3.0, 9.0) + 0.3).a;
    float streak = 0.3 + 1.2 * pow(n1, 1.6) + 0.55 * n2;

    vec3 tang = normalize(vec3(-q.z, 0.0, q.x));
    float beta = min(sqrt(0.5 / max(rr - 1.0, 0.5)), 0.7);
    float gamma = inversesqrt(1.0 - beta * beta);
    float cosA = dot(tang, -normalize(v));
    float g = 1.0 / (gamma * (1.0 - beta * cosA));
    float gEff = mix(1.0, g, uDoppler);
    float grav = sqrt(max(1.0 - 1.0 / rr, 0.0));

    vec3 c = blackbody(T * gEff * grav) * pow(gEff, 3.0) * pow(prof, 3.0) * streak * uDiskIntensity;
    float edge = smoothstep(2.6, 3.3, rr) * (1.0 - smoothstep(uOuter * 0.55, uOuter, rr));
    alpha = clamp(0.92 * edge * (0.55 + 0.45 * n1), 0.0, 1.0);
    return c * edge;
}

void main() {
    vec3 rdW = normalize(vPosW - cameraPosition);
    vec3 ro = uToLocal * (cameraPosition - uCenter) / uRs;
    vec3 rd = normalize(uToLocal * rdW);

    vec3 p = ro;
    if (dot(ro, ro) > uProxy * uProxy) {
        vec2 tp = raySphere(ro, rd, vec3(0.0), uProxy);
        if (tp.x < 0.0) discard;
        p = ro + rd * tp.x;
    }
    vec3 v = rd;
    vec3 hv = cross(p, v);
    float h2 = dot(hv, hv);
    float b = sqrt(h2);

    vec3 col = vec3(0.0);
    float a = 0.0;
    bool captured = false;
    for (int i = 0; i < 160; i++) {
        if (i >= uSteps) break;
        float r2 = dot(p, p);
        float r = sqrt(r2);
        float dt = clamp(uStepScale * r, 0.02, 1.6);
        vec3 pp = p;
        v += -1.5 * h2 * p / (r2 * r2 * r) * dt;
        p += v * dt;
        if (dot(p, p) < 1.0) { captured = true; break; }
        if (pp.y * p.y < 0.0) {
            vec3 q = mix(pp, p, pp.y / (pp.y - p.y));
            float rr = length(q.xz);
            if (rr > 2.6 && rr < uOuter) {
                float da;
                vec3 dc = disk(q, rr, v, da);
                col += (1.0 - a) * dc * da;
                a += (1.0 - a) * da;
            }
        }
        if (a > 0.98) break;
        if (r > uProxy + 0.5 && dot(p, v) > 0.0) break;
    }
    if (!captured) {
        vec3 dirW = normalize(transpose(uToLocal) * normalize(v));
        col += (1.0 - a) * (textureCube(uSky, dirW).rgb + procStars(dirW));
    }
    float edge = 1.0 - smoothstep(0.7 * uProxy, 0.96 * uProxy, b);
    gl_FragColor = vec4(col * edge, edge);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
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
        uOuter: { value: OUTER },
        uDoppler: { value: 0.45 },
        uTpeak: { value: 4800 },
        uDiskIntensity: { value: 2.4 },
    };
    // Premultiplied output: rim fades so the regular sky shows through seamlessly
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
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(PROXY * RS, 64, 32), material);
    proxy.renderOrder = 12;
    group.add(proxy);

    return {
        group,
        update(f) { uniforms.uTime.value = f.t; },
        setTier(tier) {
            uniforms.uSteps.value = tier.bhSteps;
            uniforms.uStepScale.value = 7.2 / tier.bhSteps;
        },
        dispose() {
            proxy.geometry.dispose();
            material.dispose();
        },
    };
}
