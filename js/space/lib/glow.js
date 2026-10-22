/* Camera-facing HDR glow sprite (star cores, galactic nucleus), billboarded in
   the vertex shader. Bright enough to cross the bloom threshold; depth-tested
   so planets occlude it. */
import * as THREE from 'three';

const VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * uSize;
    gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uCore;
uniform float uHalo;
varying vec2 vUv;
void main() {
    float r = length(vUv * 2.0 - 1.0);
    float core = exp(-r * r * 90.0) * uCore;
    float halo = (exp(-r * 7.0) * 0.6 + exp(-r * 2.5) * 0.12) * uHalo;
    gl_FragColor = vec4(uColor * (core + halo) * smoothstep(1.0, 0.75, r), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

let sharedGeometry = null;

export function createGlow({ color = [1, 1, 1], core = 6, halo = 1, size = 10 }) {
    if (!sharedGeometry) sharedGeometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Vector3(...color) },
            uCore: { value: core },
            uHalo: { value: halo },
            uSize: { value: size },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(sharedGeometry, material);
    mesh.renderOrder = 21;
    mesh.frustumCulled = false;
    mesh.userData.glow = { core, halo };
    return mesh;
}

/* Scale a glow's authored core/halo by k (set-piece presence); always from the
   stored base values, so repeated calls never compound */
export function fadeGlow(mesh, k) {
    const base = mesh.userData.glow;
    const u = mesh.material.uniforms;
    u.uCore.value = base.core * k;
    u.uHalo.value = base.halo * k;
}
