/* ABOUT (entry): a comet. A bright coma, a straight blue ion tail streaming
   directly away from the sun, and a broader curved dust tail that lags behind
   the orbit. Both tails are ribbons billboarded around their own axis. */
import * as THREE from 'three';
import { viewPoint, viewBasis } from '../path-data.js';
import { createGlow, fadeGlow } from '../lib/glow.js';

const TAIL_VERT = /* glsl */ `
uniform vec3 uHead;
uniform vec3 uAxis;
uniform vec3 uBend;
uniform float uLength;
uniform vec2 uWidth;    // width at head, at tail end
uniform float uCurve;
varying vec2 vUv;
void main() {
    float y = position.y + 0.5;           // 0 at the head, 1 at the end of the tail
    vec3 spine = uHead + uAxis * uLength * y + uBend * uLength * uCurve * y * y;
    vec3 tangent = normalize(uAxis + uBend * 2.0 * uCurve * y);
    vec3 side = cross(tangent, cameraPosition - spine);
    side /= max(length(side), 1e-4);
    vec3 p = spine + side * position.x * mix(uWidth.x, uWidth.y, y);
    vUv = vec2(position.x + 0.5, y);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const ION_FRAG = /* glsl */ `
uniform sampler3D uNoise;
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main() {
    float x = vUv.x - 0.5;
    float y = vUv.y;
    float rays = texture(uNoise, vec3(x * 5.0, y * 0.5 - uTime * 0.06, 0.37)).a;
    float core = exp(-x * x * 40.0);
    float a = pow(max(1.0 - y, 0.0), 1.3) * (0.35 * core + 0.9 * rays * rays * exp(-x * x * 10.0)) * smoothstep(0.0, 0.04, y);
    gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const DUST_FRAG = /* glsl */ `
uniform sampler3D uNoise;
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main() {
    float x = vUv.x - 0.5;
    float y = vUv.y;
    float striae = 0.75 + 0.25 * texture(uNoise, vec3(y * 3.0 + x * 0.8, 0.6, uTime * 0.004)).r;
    float body = exp(-x * x * (14.0 - 10.0 * y));
    float a = pow(max(1.0 - y, 0.0), 1.6) * body * striae * smoothstep(0.0, 0.05, y);
    gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export async function create(ctx) {
    const { noise } = ctx;
    const group = new THREE.Group();
    const head = new THREE.Vector3(...viewPoint(1.0, 23, 8, 1050));

    // Tails point away from this comet's sun: up and to the right of the shot, slightly away
    const { right, up, fwd } = viewBasis(1.0);
    const axis = new THREE.Vector3(...right).multiplyScalar(0.8)
        .add(new THREE.Vector3(...up).multiplyScalar(0.5))
        .add(new THREE.Vector3(...fwd).multiplyScalar(0.3))
        .normalize();
    const bend = new THREE.Vector3(...up).multiplyScalar(-0.6).add(new THREE.Vector3(...right).multiplyScalar(0.2)).normalize();

    const ribbon = new THREE.PlaneGeometry(1, 1, 1, 48);
    const makeTail = (frag, { length, width, curve, color, intensity }) => {
        const uniforms = {
            uNoise: { value: noise },
            uTime: { value: 0 },
            uHead: { value: head },
            uAxis: { value: axis },
            uBend: { value: bend },
            uLength: { value: length },
            uWidth: { value: new THREE.Vector2(...width) },
            uCurve: { value: curve },
            uColor: { value: new THREE.Vector3(...color) },
            uIntensity: { value: intensity },
        };
        const mesh = new THREE.Mesh(ribbon, new THREE.ShaderMaterial({
            uniforms,
            vertexShader: TAIL_VERT,
            fragmentShader: frag,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        }));
        mesh.frustumCulled = false;
        mesh.renderOrder = 22;
        group.add(mesh);
        return uniforms;
    };
    const ION_I = 0.85;
    const DUST_I = 0.6;
    const ion = makeTail(ION_FRAG, { length: 620, width: [8, 46], curve: 0.02, color: [0.35, 0.62, 1.0], intensity: ION_I });
    const dust = makeTail(DUST_FRAG, { length: 470, width: [16, 190], curve: 0.32, color: [1.0, 0.9, 0.72], intensity: DUST_I });

    const coma = createGlow({ color: [0.75, 0.92, 1.0], core: 2.2, halo: 1.4, size: 70 });
    coma.position.copy(head);
    group.add(coma);

    return {
        group,
        update(f, presence = 1) {
            ion.uTime.value = f.t;
            dust.uTime.value = f.t;
            ion.uIntensity.value = ION_I * presence;
            dust.uIntensity.value = DUST_I * presence;
            fadeGlow(coma, presence);
        },
        setTier() {},
        dispose() {
            ribbon.dispose();
            group.traverse((o) => { if (o.material) o.material.dispose(); });
        },
    };
}
