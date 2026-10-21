/* SKILLS: a 9000 K blue-white star seen up close. Worley granulation, sunspots
   and limb darkening on the photosphere; a corona of outward-flowing
   streamers; and tube prominences on staggered eruption cycles. */
import * as THREE from 'three';
import { ORIGINS } from '../path-data.js';
import { tempToColor } from '../lib/color.js';
import { mulberry32 } from '../lib/math.js';

const R = 70;
const TEMP = 11000;

const SURF_VERT = /* glsl */ `
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

const SURF_FRAG = /* glsl */ `
uniform sampler3D uNoise;
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
    vec3 n = vObj;
    vec3 V = normalize(cameraPosition - vPosW);
    float mu = max(dot(normalize(vNormalW), V), 0.0);
    float limb = 1.0 - 0.55 * (1.0 - mu) - 0.2 * (1.0 - mu * mu);

    float g1 = texture(uNoise, n * 4.6 + vec3(uTime * 0.004, 0.0, uTime * 0.003)).b;
    float g2 = texture(uNoise, n * 11.0 - vec3(0.0, uTime * 0.006, 0.0)).b;
    float gran = 1.0 - 0.16 * smoothstep(0.25, 0.6, g1) - 0.1 * smoothstep(0.3, 0.65, g2);
    float sg = texture(uNoise, n * 0.9 + uTime * 0.001).r;

    float spotN = texture(uNoise, n * 0.7 + 0.37).g;
    float band = smoothstep(0.6, 0.15, abs(n.y)) * smoothstep(0.03, 0.12, abs(n.y));
    float spot = smoothstep(0.66, 0.74, spotN) * band;
    float umbra = smoothstep(0.72, 0.8, spotN) * band;

    float I = gran * (0.88 + 0.24 * sg) * (1.0 - 0.5 * spot - 0.4 * umbra);
    vec3 col = uColor * I * limb * uIntensity;
    col *= mix(vec3(1.0, 0.8, 0.66), vec3(1.0), mu);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const CORONA_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * uSize;
    gl_Position = projectionMatrix * mv;
}
`;

const CORONA_FRAG = /* glsl */ `
uniform sampler3D uNoise;
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uExtent;
varying vec2 vUv;
void main() {
    vec2 p = (vUv * 2.0 - 1.0) * uExtent;
    float r = length(p);
    vec2 dir = p / max(r, 1e-4);
    float base = pow(1.0 / max(r, 1.0), 2.6);
    float flow = r * 0.12 - uTime * 0.015;
    float rays = texture(uNoise, vec3(dir * 0.9, flow)).a;
    float rays2 = texture(uNoise, vec3(dir * 2.3 + 0.5, flow * 1.7)).r;
    float streak = pow(rays, 2.0) * 1.4 + rays2 * 0.5;
    float c = base * (0.3 + streak) * smoothstep(uExtent, uExtent * 0.5, r);
    c += exp(-pow((r - 1.0) / 0.03, 2.0)) * 0.5;
    gl_FragColor = vec4(uColor * c * uIntensity, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const PROM_VERT = /* glsl */ `
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

const PROM_FRAG = /* glsl */ `
uniform sampler3D uNoise;
uniform float uTime;
uniform float uSeed;
uniform float uLife;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
    float along = vUv.x;
    vec3 V = normalize(cameraPosition - vPosW);
    float core = pow(abs(dot(normalize(vNormalW), V)), 0.8);
    float n = texture(uNoise, vec3(along * 2.5 - uTime * 0.04, vUv.y * 0.35, uSeed)).r;
    float ends = smoothstep(0.0, 0.1, along) * smoothstep(1.0, 0.9, along);
    float a = core * (0.2 + 0.8 * n * n) * uLife * ends * 0.3;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export async function create(ctx) {
    const { T, noise } = ctx;
    const rand = mulberry32(9001);
    const origin = new THREE.Vector3(...ORIGINS.star);
    const group = new THREE.Group();
    group.position.copy(origin);
    const color = new THREE.Vector3(...tempToColor(TEMP));

    const surfUniforms = {
        uNoise: { value: noise }, uTime: { value: 0 }, uColor: { value: color }, uIntensity: { value: 1.7 },
    };
    const surface = new THREE.Mesh(
        new THREE.SphereGeometry(R, T.sphereSeg, T.sphereSeg / 2),
        new THREE.ShaderMaterial({ uniforms: surfUniforms, vertexShader: SURF_VERT, fragmentShader: SURF_FRAG }),
    );
    surface.renderOrder = 10;
    group.add(surface);

    const EXTENT = 5;
    const coronaUniforms = {
        uNoise: { value: noise }, uTime: { value: 0 }, uColor: { value: color },
        uIntensity: { value: 0.55 }, uExtent: { value: EXTENT }, uSize: { value: R * EXTENT * 2 },
    };
    const corona = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
            uniforms: coronaUniforms,
            vertexShader: CORONA_VERT,
            fragmentShader: CORONA_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }),
    );
    corona.frustumCulled = false;
    corona.renderOrder = 20;
    group.add(corona);

    // Prominences: arcs anchored near the limb as seen from the Skills camera (which sits toward -x/+z)
    const proms = [];
    const view = new THREE.Vector3(-0.6, 0.05, 0.8).normalize();
    for (let i = 0; i < 6; i++) {
        const a = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5);
        a.addScaledVector(view, -a.dot(view)).normalize();          // on the limb circle
        a.addScaledVector(view, (rand() - 0.5) * 0.35).normalize();
        const axis = new THREE.Vector3().crossVectors(a, view).normalize();
        const span = 0.18 + rand() * 0.22;
        const b = a.clone().applyAxisAngle(view, span);
        const mid = a.clone().add(b).normalize().multiplyScalar(R * (1.25 + rand() * 0.35));
        mid.addScaledVector(axis, (rand() - 0.5) * R * 0.2);
        const curve = new THREE.QuadraticBezierCurve3(a.multiplyScalar(R * 0.995), mid, b.multiplyScalar(R * 0.995));
        const geo = new THREE.TubeGeometry(curve, 64, 2.6 + rand() * 2.4, 10, false);
        const uniforms = {
            uNoise: { value: noise }, uTime: { value: 0 }, uSeed: { value: rand() },
            uLife: { value: 0 }, uColor: { value: new THREE.Vector3(3.2, 0.9, 0.75) },
        };
        const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
            uniforms,
            vertexShader: PROM_VERT,
            fragmentShader: PROM_FRAG,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        }));
        mesh.renderOrder = 20;
        mesh.visible = i < Math.min(3, T.prominences);
        group.add(mesh);
        proms.push({ mesh, uniforms, period: 8 + rand() * 6, offset: rand() * 10 });
    }

    return {
        group,
        update(f) {
            surfUniforms.uTime.value = f.t;
            coronaUniforms.uTime.value = f.t;
            for (const p of proms) {
                if (!p.mesh.visible) continue;
                const phase = ((f.t + p.offset) % p.period) / p.period;
                p.uniforms.uLife.value = Math.pow(Math.sin(Math.PI * phase), 0.7);
                p.uniforms.uTime.value = f.t;
            }
        },
        setTier(tier) {
            proms.forEach((p, i) => { p.mesh.visible = i < Math.min(3, tier.prominences); });
        },
        dispose() {
            group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        },
    };
}
