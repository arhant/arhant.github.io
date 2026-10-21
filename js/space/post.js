/* Post chain: RenderPass (HalfFloat HDR) → UnrealBloomPass (high/medium) → FinalPass.
   Without half-float render targets it renders directly with ACES tone mapping. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FINAL_VERT, FINAL_FRAG, MAX_RECTS } from './shaders/final.glsl.js';

export class Post {
    constructor(renderer, scene, camera, tier, halfFloat) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.direct = !halfFloat;
        this.tier = tier;
        this.scale = 1;
        this.bloom = null;

        if (this.direct) {
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1;
            this.uniforms = null;
            return;
        }

        const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: tier.msaa });
        this.composer = new EffectComposer(renderer, target);
        this.composer.addPass(new RenderPass(scene, camera));

        if (tier.bloom) this.addBloom(tier);

        const rects = [];
        const rectParams = [];
        for (let i = 0; i < MAX_RECTS; i++) { rects.push(new THREE.Vector4()); rectParams.push(new THREE.Vector2()); }
        this.final = new ShaderPass({
            uniforms: {
                tDiffuse: { value: null },
                uRes: { value: new THREE.Vector2(1, 1) },
                uTime: { value: 0 },
                uExposure: { value: 1 },
                uVignette: { value: 0.35 },
                uGrain: { value: 0.018 },
                uWarp: { value: 0 },
                uCA: { value: tier.ca ? 0.0015 : 0 },
                uShadowTint: { value: new THREE.Vector3(0.92, 0.97, 1.08) },
                uBg: { value: new THREE.Vector3(7 / 255, 7 / 255, 26 / 255) },
                uRects: { value: rects },
                uRectParams: { value: rectParams },
                uFlare: { value: new THREE.Vector3() },
                uTidal: { value: 0 },
                uBlackout: { value: 0 },
                uRectCount: { value: 0 },
                uLumaCap: { value: 0.22 },
                uMaskDim: { value: 0.6 },
                uMaskStrength: { value: 1 },
                uDpr: { value: 1 },
            },
            vertexShader: FINAL_VERT,
            fragmentShader: FINAL_FRAG,
        });
        this.composer.addPass(this.final);
        this.uniforms = this.final.uniforms;
    }

    addBloom(tier) {
        const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.45, 1.0);
        // Medium starts the mip chain at a quarter of the drawing buffer instead of half
        const setSize = bloom.setSize.bind(bloom);
        const k = tier.bloomScale;
        bloom.setSize = (w, h) => setSize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
        // A single NaN pixel would be smeared by the blur pyramid into large black blocks; drop it here
        const hp = bloom.materialHighPassFilter;
        hp.fragmentShader = hp.fragmentShader.replace(
            'vec4 texel = texture2D( tDiffuse, vUv );',
            'vec4 texel = clamp( texture2D( tDiffuse, vUv ), vec4( 0.0 ), vec4( 6.0e4 ) );',
        );
        hp.needsUpdate = true;
        this.composer.insertPass(bloom, 1);
        this.bloom = bloom;
    }

    setTier(tier) {
        this.tier = tier;
        if (this.direct) return;
        if (!tier.bloom && this.bloom) {
            this.composer.removePass(this.bloom);
            this.bloom.dispose();
            this.bloom = null;
        }
        if (this.uniforms) this.uniforms.uCA.value = tier.ca ? 0.0015 : 0;
    }

    setSize(width, height, dpr) {
        const r = this.renderer;
        r.setPixelRatio(dpr);
        r.setSize(width, height, false);
        if (this.direct) return;
        this.composer.setPixelRatio(dpr);
        this.composer.setSize(width, height);
        const buf = r.getDrawingBufferSize(new THREE.Vector2());
        this.uniforms.uRes.value.copy(buf);
        this.uniforms.uDpr.value = buf.x / Math.max(1, width);
    }

    render(frame) {
        if (this.direct) {
            this.renderer.toneMappingExposure = frame.grade.exposure;
            this.renderer.render(this.scene, this.camera);
            return;
        }
        const u = this.uniforms;
        u.uTime.value = frame.t;
        u.uExposure.value = frame.grade.exposure * (1 + 0.15 * frame.warp);
        u.uVignette.value = frame.grade.vignette;
        u.uWarp.value = frame.warp;
        u.uFlare.value.copy(frame.flare);
        u.uTidal.value = frame.plunge.tidal;
        u.uBlackout.value = frame.plunge.blackout;
        // Content fades out during a velocity warp, so stop dimming the scene behind it
        u.uMaskStrength.value = 1 - frame.fade;
        if (this.bloom) this.bloom.strength = frame.grade.bloom * (1 - 0.45 * frame.plunge.beta);
        this.composer.render(frame.dt);
    }

    dispose() {
        if (this.composer) {
            this.composer.passes.forEach((p) => p.dispose && p.dispose());
            this.composer.dispose();
        }
    }
}
