/* One-off GPU bakes: procedural content is rendered into textures at load,
   so runtime shaders do a texture lookup instead of evaluating noise. */
import * as THREE from 'three';
import { HASH, PERIODIC, FULLSCREEN_VERT } from '../shaders/common.glsl.js';
import { nextFrame } from './math.js';

const CUBE_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/* Render a direction → colour shader into a cube map. `fragment` receives `varying vec3 vDir`. */
export function bakeCube(renderer, { size, fragment, type = THREE.UnsignedByteType, uniforms = {}, mipmaps = true }) {
    const rt = new THREE.WebGLCubeRenderTarget(size, {
        type,
        generateMipmaps: mipmaps,
        minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
    });
    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: CUBE_VERT,
        fragmentShader: fragment,
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
    });
    const scene = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
    scene.add(box);
    const camera = new THREE.CubeCamera(0.1, 10, rt);
    camera.update(renderer, scene);
    box.geometry.dispose();
    material.dispose();
    return rt;
}

/* Render a uv → colour shader into a 2D texture. `fragment` receives `varying vec2 vUv`. */
export function bake2D(renderer, { width, height, fragment, uniforms = {}, wrapS = THREE.RepeatWrapping }) {
    const rt = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.UnsignedByteType,
        wrapS,
        wrapT: THREE.ClampToEdgeWrapping,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
    });
    const material = new THREE.ShaderMaterial({ uniforms, vertexShader: FULLSCREEN_VERT, fragmentShader: fragment, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    renderer.setRenderTarget(prev);
    quad.geometry.dispose();
    material.dispose();
    return rt;
}

const NOISE_FRAG = /* glsl */ `
uniform float uLayer;
uniform float uSize;
${HASH}
${PERIODIC}
void main() {
    vec3 uvw = vec3(gl_FragCoord.xy, uLayer + 0.5) / uSize;
    float r = fbmP(uvw * 4.0, 4.0, 5) * 0.85 + 0.5;
    float g = fbmP(uvw * 4.0 + vec3(1.7, 9.2, 4.1), 4.0, 4) * 0.85 + 0.5;
    float b = worleyP(uvw * 5.0, 5.0);
    float a = ridgedP(uvw * 3.0 + vec3(5.3, 1.1, 7.7), 3.0, 5);
    gl_FragColor = vec4(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0), clamp(a, 0.0, 1.0));
}
`;

/* Tileable 3D noise texture shared by every set-piece.
   R: fbm, G: fbm (second seed), B: Worley F1 distance, A: ridged fbm. */
export async function bakeNoise3D(renderer, size) {
    const rt = new THREE.WebGL3DRenderTarget(size, size, size, { depthBuffer: false });
    const tex = rt.texture;
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
    tex.generateMipmaps = false;

    const material = new THREE.ShaderMaterial({
        uniforms: { uLayer: { value: 0 }, uSize: { value: size } },
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: NOISE_FRAG,
        depthTest: false,
        depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const perFrame = size > 64 ? 16 : 32;
    for (let z = 0; z < size; z++) {
        material.uniforms.uLayer.value = z;
        renderer.setRenderTarget(rt, z);
        renderer.render(scene, camera);
        if (z % perFrame === perFrame - 1) await nextFrame();
    }
    renderer.setRenderTarget(null);
    quad.geometry.dispose();
    material.dispose();
    return { texture: tex, dispose: () => rt.dispose() };
}

/* Full-screen triangle-ish mesh for compositing an off-screen layer into the main scene */
export function makeCompositeMesh(material) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    return mesh;
}
