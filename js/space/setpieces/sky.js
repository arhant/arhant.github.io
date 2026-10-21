/* Sky: a Milky Way band baked once into an HDR cube map (used as the scene
   background and as the light the black hole bends), plus far stars drawn as
   sharp points at infinity with blackbody colours. Always loaded. */
import * as THREE from 'three';
import { bakeCube } from '../lib/bake.js';
import { SIMPLEX } from '../shaders/common.glsl.js';
import { tempToColor, sampleStarTemp } from '../lib/color.js';
import { mulberry32, gaussian } from '../lib/math.js';

const SKY_FRAG = /* glsl */ `
uniform vec3 uNorth;
uniform vec3 uCenter;
varying vec3 vDir;
${SIMPLEX}
void main() {
    vec3 d = normalize(vDir);
    float b = asin(clamp(dot(d, uNorth), -1.0, 1.0));
    vec3 w = vec3(fbm3(d * 2.0 + 1.0, 3), fbm3(d * 2.0 + 7.0, 3), fbm3(d * 2.0 + 13.0, 3)) * 0.25;

    float width = 0.11 + 0.035 * fbm3(d * 1.5 + 3.3, 3);
    float band = exp(-abs(b + 0.03 * fbm3(d * 3.0, 3)) / width);
    float clouds = 0.55 + 0.45 * fbm3(d * 4.0 + w, 5);
    float grain = 0.65 + 0.35 * smoothstep(-0.3, 0.6, fbm3(d * 22.0, 3));

    float cg = acos(clamp(dot(d, uCenter), -1.0, 1.0));
    float bulge = exp(-pow(cg / 0.34, 2.0)) * exp(-abs(b) / 0.15);

    float lanes = ridged3(d * 5.0 + w * 2.0, 4);
    float dust = smoothstep(0.32, 0.75, lanes) * exp(-abs(b) / 0.05);

    vec3 disk = vec3(0.60, 0.65, 0.82);
    vec3 core = vec3(0.98, 0.74, 0.50);
    vec3 col = disk * band * clouds * grain * 0.065 + core * bulge * 0.15;
    col *= 1.0 - 0.82 * dust;

    float ha = smoothstep(0.55, 0.85, fbm3(d * 5.0 + 40.0, 4)) * band;
    float o3 = smoothstep(0.6, 0.9, fbm3(d * 4.0 + 90.0, 4)) * exp(-abs(b) / 0.3);
    col += vec3(1.0, 0.36, 0.55) * ha * 0.025 + vec3(0.2, 0.75, 0.95) * o3 * 0.014;

    col += vec3(0.010, 0.010, 0.020) * (0.6 + 0.4 * fbm3(d * 1.2, 2));
    gl_FragColor = vec4(col, 1.0);
}
`;

const STAR_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aMag;
attribute float aPhase;
uniform float uDpr;
uniform float uTime;
uniform float uTwinkle;
varying vec3 vCol;
void main() {
    vec4 vp = viewMatrix * vec4(position, 0.0);
    gl_Position = projectionMatrix * vec4(vp.xyz * 1000.0, 1.0);
    gl_Position.z = gl_Position.w * 0.99999;
    float tw = 1.0 + uTwinkle * 0.05 * sin(uTime * (1.3 + aPhase * 2.0) + aPhase * 40.0);
    vCol = aColor * aMag * tw;
    gl_PointSize = (1.3 + 2.4 * sqrt(aMag)) * uDpr;
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c) * 4.0;
    float a = (exp(-r2 * 6.0) + 0.08 * exp(-r2 * 1.2)) * smoothstep(0.5, 0.3, length(c));
    gl_FragColor = vec4(vCol * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export function galacticFrame() {
    const north = new THREE.Vector3(0.55, 0.8, 0.2).normalize();
    const center = new THREE.Vector3(-0.35, 0.05, -1);
    center.addScaledVector(north, -center.dot(north)).normalize();
    const third = new THREE.Vector3().crossVectors(north, center).normalize();
    return { north, center, third };
}

export function createSky(ctx) {
    const { renderer, T, scene } = ctx;
    const frame = galacticFrame();

    const cube = bakeCube(renderer, {
        size: T.skyCube,
        fragment: SKY_FRAG,
        type: ctx.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        uniforms: { uNorth: { value: frame.north }, uCenter: { value: frame.center } },
    });
    scene.background = cube.texture;
    scene.backgroundIntensity = 1;

    // Far stars: 60% concentrated toward the galactic plane, 40% isotropic
    const n = T.farStars;
    const rand = mulberry32(1337);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const mag = new Float32Array(n);
    const phase = new Float32Array(n);
    const v = new THREE.Vector3();
    const c = [0, 0, 0];
    for (let i = 0; i < n; i++) {
        if (rand() < 0.6) {
            const lat = gaussian(rand) * 0.17;
            const lon = rand() * Math.PI * 2;
            v.copy(frame.center).multiplyScalar(Math.cos(lat) * Math.cos(lon))
                .addScaledVector(frame.third, Math.cos(lat) * Math.sin(lon))
                .addScaledVector(frame.north, Math.sin(lat));
        } else {
            const z = rand() * 2 - 1;
            const a = rand() * Math.PI * 2;
            const r = Math.sqrt(1 - z * z);
            v.set(r * Math.cos(a), z, r * Math.sin(a));
        }
        v.normalize();
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        tempToColor(sampleStarTemp(rand), c);
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
        mag[i] = 0.05 + 1.7 * Math.pow(rand(), 7);
        phase[i] = rand();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const mat = new THREE.ShaderMaterial({
        uniforms: { uDpr: { value: 1 }, uTime: { value: 0 }, uTwinkle: { value: 1 } },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(geo, mat);
    stars.frustumCulled = false;
    stars.renderOrder = -5;
    scene.add(stars);

    return {
        cube: cube.texture,
        frame,
        update(f) {
            mat.uniforms.uTime.value = f.t;
            mat.uniforms.uDpr.value = f.dpr;
        },
        dispose() {
            cube.dispose();
            geo.dispose();
            mat.dispose();
            scene.remove(stars);
        },
    };
}
