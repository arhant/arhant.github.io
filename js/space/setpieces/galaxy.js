/* MISSION LOG: a barred-less two-arm spiral galaxy. A polar-coordinate disk
   impostor (log-spiral arms, dust lanes on the inner arm edges, HII knots,
   bulge) plus star points generated with the same spiral math for parallax,
   and relativistic jets from the nucleus with Doppler beaming. */
import * as THREE from 'three';
import { ORIGINS } from '../path-data.js';
import { tempToColor } from '../lib/color.js';
import { mulberry32, gaussian } from '../lib/math.js';
import { createGlow } from '../lib/glow.js';

const RG = 2600;
const PITCH = Math.tan(THREE.MathUtils.degToRad(14));

const DISK_VERT = /* glsl */ `
varying vec2 vP;
void main() {
    vP = position.xz / ${RG.toFixed(1)};
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DISK_FRAG = /* glsl */ `
uniform sampler3D uNoise;
uniform float uIntensity;
varying vec2 vP;
void main() {
    float r = length(vP);
    if (r > 1.0) discard;
    float th = atan(vP.y, vP.x);
    float logr = log(max(r, 0.015));
    float warp = texture(uNoise, vec3(vP * 1.3, 0.2)).r - 0.5;
    float phase = 2.0 * (th - logr / ${PITCH.toFixed(5)}) + warp * 2.5;
    float arm = pow(0.5 + 0.5 * cos(phase), 3.0);
    float disk = exp(-r / 0.26);
    float bulge = exp(-r / 0.045) * 2.5 + exp(-r / 0.11) * 0.6;
    float dust = pow(0.5 + 0.5 * cos(phase + 0.6), 10.0) * smoothstep(0.06, 0.22, r) * (0.5 + texture(uNoise, vec3(vP * 5.0, 0.5)).g);
    float knots = smoothstep(0.62, 0.82, texture(uNoise, vec3(vP * 7.0, 0.7)).r) * arm;
    vec3 col = vec3(1.0, 0.80, 0.58) * (bulge + disk * 0.3)
             + vec3(0.55, 0.68, 1.0) * arm * disk * 1.3
             + vec3(1.0, 0.35, 0.55) * knots * disk * 2.2;
    col *= 1.0 - 0.8 * clamp(dust, 0.0, 1.0);
    col *= smoothstep(1.0, 0.7, r);
    gl_FragColor = vec4(col * uIntensity, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const PTS_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aMag;
uniform float uScale;
uniform float uDpr;
varying vec3 vCol;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uScale * (0.6 + aMag) / -mv.z, 1.0, 4.0) * uDpr;
    vCol = aColor * aMag;
}
`;

const PTS_FRAG = /* glsl */ `
uniform float uIntensity;
varying vec3 vCol;
void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = exp(-dot(c, c) * 18.0) * smoothstep(0.5, 0.3, length(c));
    gl_FragColor = vec4(vCol * a * uIntensity, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const JET_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const JET_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBoost;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
    float s = vUv.y;
    vec3 V = normalize(cameraPosition - vPosW);
    float edge = pow(abs(dot(normalize(vNormalW), V)), 3.0);
    float body = exp(-s * 2.6) * 0.6;
    float k = fract(s * 4.0 - uTime * 0.1) - 0.5;
    float knots = exp(-k * k / 0.012) * 1.2 * exp(-s * 1.4);
    float helix = 0.75 + 0.25 * sin(vUv.x * 12.566 + s * 30.0 - uTime * 0.8);
    float tip = smoothstep(1.0, 0.7, s);
    gl_FragColor = vec4(uColor * (body + knots) * helix * edge * tip * uBoost, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export async function create(ctx) {
    const { T, noise } = ctx;
    const rand = mulberry32(2718);
    const origin = new THREE.Vector3(...ORIGINS.galaxy);
    const group = new THREE.Group();
    group.position.copy(origin);
    group.rotation.set(0.35, 0, 0.2);
    const disk = new THREE.Group();
    group.add(disk);

    const diskUniforms = { uNoise: { value: noise }, uIntensity: { value: 0.95 } };
    const diskGeo = new THREE.PlaneGeometry(RG * 2, RG * 2, 1, 1);
    diskGeo.rotateX(-Math.PI / 2);
    const impostor = new THREE.Mesh(diskGeo, new THREE.ShaderMaterial({
        uniforms: diskUniforms,
        vertexShader: DISK_VERT,
        fragmentShader: DISK_FRAG,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    }));
    impostor.renderOrder = 18;
    disk.add(impostor);

    // Stars on the same log spirals, for parallax and thickness
    const MAX = 60000;
    const pos = new Float32Array(MAX * 3);
    const col = new Float32Array(MAX * 3);
    const mag = new Float32Array(MAX);
    const c = [0, 0, 0];
    for (let i = 0; i < MAX; i++) {
        let x, y, z, temp;
        if (rand() < 0.18) {
            const r = Math.abs(gaussian(rand)) * 0.08;
            const u = rand() * 2 - 1;
            const a = rand() * Math.PI * 2;
            const s = Math.sqrt(1 - u * u);
            x = r * s * Math.cos(a); y = r * u * 0.6; z = r * s * Math.sin(a);
            temp = 3400 + rand() * 1800;
        } else {
            const r = Math.min(0.98, 0.04 + -Math.log(1 - rand() * 0.98) * 0.24);
            const arm = rand() < 0.5 ? 0 : Math.PI;
            const th = Math.log(r) / PITCH + arm + gaussian(rand) * 0.32 * (1.1 - r * 0.4);
            x = r * Math.cos(th); z = r * Math.sin(th); y = gaussian(rand) * 0.012;
            temp = rand() < 0.65 ? 7000 + rand() * 14000 : 3800 + rand() * 2400;
        }
        pos[i * 3] = x * RG; pos[i * 3 + 1] = y * RG; pos[i * 3 + 2] = z * RG;
        tempToColor(temp, c);
        col.set(c, i * 3);
        mag[i] = 0.2 + 1.6 * Math.pow(rand(), 5);
    }
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ptsGeo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    ptsGeo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    ptsGeo.setDrawRange(0, T.galaxyPoints);
    const ptsUniforms = { uScale: { value: 7000 }, uDpr: { value: 1 }, uIntensity: { value: 0.42 } };
    const points = new THREE.Points(ptsGeo, new THREE.ShaderMaterial({
        uniforms: ptsUniforms,
        vertexShader: PTS_VERT,
        fragmentShader: PTS_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    }));
    points.renderOrder = 19;
    points.frustumCulled = false;
    disk.add(points);

    // Jets along the disk normal; the approaching one is Doppler-boosted
    const H = RG * 1.1;
    const jets = [];
    for (const sign of [1, -1]) {
        const geo = new THREE.CylinderGeometry(RG * 0.026, RG * 0.003, H, 24, 1, true);
        geo.translate(0, H / 2, 0);
        const uniforms = { uTime: { value: 0 }, uBoost: { value: 1 }, uColor: { value: new THREE.Vector3(0.32, 0.48, 0.95) } };
        const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
            uniforms,
            vertexShader: JET_VERT,
            fragmentShader: JET_FRAG,
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }));
        if (sign < 0) mesh.rotation.x = Math.PI;
        mesh.renderOrder = 20;
        group.add(mesh);
        jets.push({ mesh, uniforms, dir: new THREE.Vector3(0, sign, 0) });
    }

    const core = createGlow({ color: [1.0, 0.85, 0.7], core: 5, halo: 1.6, size: RG * 0.16 });
    group.add(core);

    const toCam = new THREE.Vector3();
    const jetW = new THREE.Vector3();
    const BETA = 0.9;
    const GAMMA = 1 / Math.sqrt(1 - BETA * BETA);

    return {
        group,
        update(f) {
            disk.rotation.y = -f.t * 0.004;
            ptsUniforms.uDpr.value = f.dpr;
            toCam.subVectors(f.camera.position, origin).normalize();
            for (const j of jets) {
                j.uniforms.uTime.value = f.t;
                jetW.copy(j.dir).applyEuler(group.rotation);
                const D = 1 / (GAMMA * (1 - BETA * jetW.dot(toCam)));
                j.uniforms.uBoost.value = Math.min(2, Math.max(0.08, Math.pow(D, 3) * 0.5));
            }
        },
        setTier(tier) {
            ptsGeo.setDrawRange(0, tier.galaxyPoints);
        },
        dispose() {
            group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        },
    };
}
