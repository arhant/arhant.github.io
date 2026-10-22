/* Frosted glass: a dual-Kawase blur of the HDR frame (after bloom) that the
   FinalPass shows behind one panel. Three downsamples (1/2 → 1/4 → 1/8) and one
   upsample back to 1/4, which is what the FinalPass samples; four tiny passes.
   Post disables the pass (the composer then skips it) whenever no glass rect is
   on screen, so it costs nothing while scrolling or away from Contact.
   Dual filtering: Marius Bjørge, "Bandwidth-Efficient Rendering", SIGGRAPH 2015. */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FULLSCREEN_VERT } from './shaders/common.glsl.js';

// 4 bilinear taps on the diagonals plus the centre; drops NaN/inf like the bloom high-pass does
const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 tap(vec2 p) { return clamp(texture2D(tSrc, p).rgb, vec3(0.0), vec3(6.0e4)); }
void main() {
    vec3 s = tap(vUv) * 4.0;
    s += tap(vUv - uTexel);
    s += tap(vUv + uTexel);
    s += tap(vUv + vec2(uTexel.x, -uTexel.y));
    s += tap(vUv - vec2(uTexel.x, -uTexel.y));
    gl_FragColor = vec4(s * 0.125, 1.0);
}
`;

// 8-tap tent: axis taps one source texel out, diagonal taps half a texel out at double weight
const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
    vec2 h = uTexel * 0.5;
    vec3 s = texture2D(tSrc, vUv + vec2(-uTexel.x, 0.0)).rgb;
    s += texture2D(tSrc, vUv + vec2(uTexel.x, 0.0)).rgb;
    s += texture2D(tSrc, vUv + vec2(0.0, uTexel.y)).rgb;
    s += texture2D(tSrc, vUv + vec2(0.0, -uTexel.y)).rgb;
    s += texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
    gl_FragColor = vec4(s / 12.0, 1.0);
}
`;

const material = (fragmentShader) => new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
});

const target = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

export class GlassBlurPass extends Pass {
    constructor() {
        super();
        this.needsSwap = false;
        this.enabled = false;
        // Tap spacing in source texels; Post scales it with the pixel ratio so the blur
        // radius stays about the same in CSS pixels on every screen
        this.spread = 1;
        this.down = [target(), target(), target()]; // 1/2, 1/4, 1/8
        this.up = target();                          // 1/4
        this.downMaterial = material(DOWN_FRAG);
        this.upMaterial = material(UP_FRAG);
        this.quad = new FullScreenQuad(null);
    }

    get texture() { return this.up.texture; }

    setSize(width, height) {
        let w = width;
        let h = height;
        for (const t of this.down) {
            w = Math.max(1, Math.round(w / 2));
            h = Math.max(1, Math.round(h / 2));
            t.setSize(w, h);
        }
        this.up.setSize(this.down[1].width, this.down[1].height);
    }

    blit(renderer, mat, src, dst) {
        mat.uniforms.tSrc.value = src.texture;
        mat.uniforms.uTexel.value.set(this.spread / src.width, this.spread / src.height);
        this.quad.material = mat;
        renderer.setRenderTarget(dst);
        this.quad.render(renderer);
    }

    render(renderer, writeBuffer, readBuffer) {
        let src = readBuffer;
        for (const dst of this.down) {
            this.blit(renderer, this.downMaterial, src, dst);
            src = dst;
        }
        this.blit(renderer, this.upMaterial, src, this.up);
    }

    dispose() {
        this.down.forEach((t) => t.dispose());
        this.up.dispose();
        this.downMaterial.dispose();
        this.upMaterial.dispose();
        this.quad.dispose();
    }
}
