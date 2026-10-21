/* Near stars: instanced quads in a box that wraps around the camera (an
   infinite field at zero CPU cost). Each quad stretches along the real
   per-frame camera velocity, so fast scrolling streaks and warp just
   lengthens the streaks. At rest they're faint specks. Always loaded. */
import * as THREE from 'three';
import { tempToColor, sampleStarTemp } from '../lib/color.js';
import { mulberry32, clamp } from '../lib/math.js';

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aColor;
attribute float aMag;
uniform vec3 uCam;
uniform float uBox;
uniform vec3 uVel;
uniform float uStreakDt;
uniform vec2 uRes;
uniform float uSize;
uniform float uBright;
varying vec2 vUv;
varying vec3 vCol;
varying float vLen;
varying float vW;
void main() {
    vec3 rel = mod(aPos - uCam, uBox) - 0.5 * uBox;
    float fade = 1.0 - smoothstep(0.3, 0.5, length(rel) / uBox);
    vec3 wp = uCam + rel;
    mat4 vp = projectionMatrix * viewMatrix;
    vec4 c0 = vp * vec4(wp, 1.0);
    vec4 c1 = vp * vec4(wp + uVel * uStreakDt, 1.0);
    if (c0.w < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    if (c1.w < 1.0) c1 = c0;
    vec2 s0 = c0.xy / c0.w * 0.5 * uRes;
    vec2 s1 = c1.xy / c1.w * 0.5 * uRes;
    vec2 d = s0 - s1;
    float len = min(length(d), 400.0);
    vec2 dir = len > 0.001 ? normalize(d) : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float w = uSize * (0.7 + 0.6 * aMag);
    vec2 center = s0 - dir * len * 0.5;
    vec2 px = center + dir * position.x * (len + w) + perp * position.y * w;
    gl_Position = vec4(px / (0.5 * uRes) * c0.w, c0.z, c0.w);
    vUv = position.xy * 2.0;
    vLen = len;
    vW = w;
    vCol = aColor * aMag * fade * uBright / (1.0 + len * 0.015);
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vLen;
varying float vW;
void main() {
    vec2 px = vec2(vUv.x * (vLen + vW), vUv.y * vW) * 0.5;
    float d = length(vec2(max(abs(px.x) - vLen * 0.5, 0.0), px.y)) / (vW * 0.5);
    float a = exp(-d * d * 3.0) * (1.0 - smoothstep(0.75, 1.0, d));
    gl_FragColor = vec4(vCol * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export function createStars(ctx) {
    const { scene, T } = ctx;
    const BOX = 2200;
    const n = T.nearStars;
    const rand = mulberry32(4242);
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    const aPos = new Float32Array(n * 3);
    const aColor = new Float32Array(n * 3);
    const aMag = new Float32Array(n);
    const c = [0, 0, 0];
    for (let i = 0; i < n; i++) {
        aPos[i * 3] = rand() * BOX;
        aPos[i * 3 + 1] = rand() * BOX;
        aPos[i * 3 + 2] = rand() * BOX;
        tempToColor(sampleStarTemp(rand), c);
        aColor.set(c, i * 3);
        aMag[i] = 0.35 + 0.65 * Math.pow(rand(), 3);
    }
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
    geo.setAttribute('aMag', new THREE.InstancedBufferAttribute(aMag, 1));
    geo.instanceCount = n;

    const uniforms = {
        uCam: { value: new THREE.Vector3() },
        uBox: { value: BOX },
        uVel: { value: new THREE.Vector3() },
        uStreakDt: { value: 1 / 60 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uSize: { value: 1.6 },
        uBright: { value: 0.2 },
    };
    const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 15;
    scene.add(mesh);

    return {
        update(f) {
            uniforms.uCam.value.copy(f.camera.position);
            uniforms.uVel.value.copy(f.velocity);
            uniforms.uStreakDt.value = (1 / 60) * (1 + 3 * f.warp);
            uniforms.uRes.value.copy(f.res);
            uniforms.uSize.value = 1.6 * f.dpr;
            const speed = clamp(f.speed / 2500, 0, 1);
            // Capped under the bloom threshold: bloomed points render as square halos
            uniforms.uBright.value = Math.min(0.9, 0.16 + 0.6 * speed + 0.35 * f.warp);
        },
        setTier(tier) {
            geo.instanceCount = Math.min(n, tier.nearStars);
        },
        dispose() {
            scene.remove(mesh);
            geo.dispose();
            base.dispose();
            mat.dispose();
        },
    };
}
