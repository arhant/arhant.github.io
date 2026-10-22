/* Post chain: RenderPass (HalfFloat HDR) → UnrealBloomPass (high/medium) →
   GlassBlurPass (only while a frosted-glass panel is on screen) → FinalPass.
   Without half-float render targets it renders directly with ACES tone mapping.

   Grading experiments, never defaults (the set pieces are graded for ACES and
   a 1.0 bloom threshold): ?tm=agx|neutral swaps the tone-map operator, and
   ?knee=0..1 gives the bloom threshold a soft knee of that width. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FINAL_VERT, FINAL_FRAG, MAX_RECTS, RECT_GLASS } from './shaders/final.glsl.js';
import { GlassBlurPass } from './glass.js';
import { damp, clamp } from './lib/math.js';

const PARAMS = new URLSearchParams(location.search);
const TONE_MAP = PARAMS.get('tm');
const KNEE = clamp(parseFloat(PARAMS.get('knee')) || 0, 0, 1);

// Warp brightens the frame a little; kept small because the page text stays up during it
const WARP_LIFT = 0.05;

// Frosted-glass tap spacing: 2 texels per CSS pixel, so the blur looks the same at any pixel
// ratio, capped where wider taps would start to skip detail on dense screens
const glassSpread = (dpr) => Math.min(3.5, 2 * dpr);

// FXAA follows the tier (tier.fxaa); when a tier doesn't say, only medium gets it
// (high has MSAA, low keeps every millisecond)
const fxaaFor = (tier) => (tier.fxaa !== undefined ? !!tier.fxaa : tier.name === 'medium');

export class Post {
    constructor(renderer, scene, camera, tier, halfFloat) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.direct = !halfFloat;
        this.tier = tier;
        this.scale = 1;
        this.bloom = null;
        this.glass = null;      // the blur pass once it is in the chain
        this.glassPass = null;  // created (and compiled) ahead of first use by precompile()
        this.glassOn = false;
        this.glassMix = 0;
        this.fxaaForced = null;

        if (this.direct) {
            renderer.toneMapping = TONE_MAP === 'agx' ? THREE.AgXToneMapping
                : TONE_MAP === 'neutral' ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
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
        for (let i = 0; i < MAX_RECTS; i++) { rects.push(new THREE.Vector4()); rectParams.push(new THREE.Vector3()); }
        const defines = {};
        if (TONE_MAP === 'agx') defines.TONEMAP_AGX = 1;
        else if (TONE_MAP === 'neutral') defines.TONEMAP_NEUTRAL = 1;
        this.final = new ShaderPass({
            defines,
            uniforms: {
                tDiffuse: { value: null },
                tGlass: { value: null },
                uRes: { value: new THREE.Vector2(1, 1) },
                uTime: { value: 0 },
                uExposure: { value: 1 },
                uVignette: { value: 0.35 },
                uGrain: { value: 0.018 },
                uWarp: { value: 0 },
                uCA: { value: tier.ca ? 0.0015 : 0 },
                uFXAA: { value: fxaaFor(tier) ? 1 : 0 },
                uGlass: { value: 0 },
                uShadowTint: { value: new THREE.Vector3(0.92, 0.97, 1.08) },
                uBg: { value: new THREE.Vector3(7 / 255, 7 / 255, 26 / 255) },
                uRects: { value: rects },
                // Per rect: mode (RECT_*), weight, corner radius in CSS px (shade strength for soft rects)
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
        // Soft knee centred on the 1.0 threshold (the high-pass blends in over threshold..threshold+width)
        if (KNEE > 0) {
            bloom.threshold = 1 - KNEE / 2;
            bloom.highPassUniforms.smoothWidth.value = KNEE;
        }
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
        this.uniforms.uCA.value = tier.ca ? 0.0015 : 0;
        this.applyFXAA();
    }

    /* true/false forces FXAA on or off; null hands it back to the tier. Returns the applied state. */
    setFXAA(on) {
        this.fxaaForced = on === null || on === undefined ? null : !!on;
        return this.applyFXAA();
    }

    applyFXAA() {
        if (this.direct) return false;
        const on = this.fxaaForced !== null ? this.fxaaForced : fxaaFor(this.tier);
        this.uniforms.uFXAA.value = on ? 1 : 0;
        return on;
    }

    /* Frosted-glass panel on or off (app.js decides, alongside html[data-glass], which readability
       also reads). Never on the direct path, which has no shader mask. Returns the applied state.
       The blur pass is created on first use, so visitors who never get glass never allocate it. */
    setGlass(on) {
        on = !!on && !this.direct;
        if (on && !this.glass) {
            this.glass = this.glassPass || new GlassBlurPass();
            this.glassPass = null;
            this.composer.insertPass(this.glass, this.composer.passes.indexOf(this.final));
            this.glass.spread = glassSpread(this.uniforms.uDpr.value);
            this.uniforms.tGlass.value = this.glass.texture;
        }
        this.glassOn = on;
        return on;
    }

    /* Compile the pass programs before the first frame (off the main thread where the browser
       can), each against the kind of target it draws into: bloom and the glass blur into
       half-float targets, the FinalPass to the screen. Where glass can show (the composer path
       above low), its blur pass is created now too, so its first frame at Contact links nothing. */
    precompile() {
        if (this.direct) return Promise.resolve();
        const r = this.renderer;
        const offscreen = [];
        if (this.bloom) {
            const b = this.bloom;
            offscreen.push(b.materialHighPassFilter, ...b.separableBlurMaterials, b.compositeMaterial, b.blendMaterial);
        }
        if (this.tier.name !== 'low' && !this.glass) {
            this.glassPass = this.glassPass || new GlassBlurPass();
            offscreen.push(this.glassPass.downMaterial, this.glassPass.upMaterial);
        }
        const geo = new THREE.PlaneGeometry(2, 2);
        const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const sceneOf = (materials) => {
            const scene = new THREE.Scene();
            for (const m of materials) scene.add(new THREE.Mesh(geo, m));
            return scene;
        };
        const prev = r.getRenderTarget();
        r.setRenderTarget(this.composer.readBuffer);
        const jobs = [r.compileAsync(sceneOf(offscreen), cam)];
        r.setRenderTarget(null);
        jobs.push(r.compileAsync(sceneOf([this.final.material]), cam));
        r.setRenderTarget(prev);
        return Promise.all(jobs).then(() => geo.dispose());
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
        if (this.glass) this.glass.spread = glassSpread(this.uniforms.uDpr.value);
    }

    // Is a glass rect among this frame's readability rects (written by readability.update)?
    hasGlassRect() {
        const u = this.uniforms;
        const params = u.uRectParams.value;
        for (let i = 0; i < u.uRectCount.value; i++) if (params[i].x === RECT_GLASS) return true;
        return false;
    }

    render(frame) {
        // The hero's ignite ramp (frame.ignite 0 → 1) multiplies into the section grade
        const ignite = frame.ignite === undefined ? 1 : frame.ignite;
        if (this.direct) {
            this.renderer.toneMappingExposure = frame.grade.exposure * ignite;
            this.renderer.render(this.scene, this.camera);
            return;
        }
        const u = this.uniforms;
        u.uTime.value = frame.t;
        u.uExposure.value = frame.grade.exposure * ignite * (1 + WARP_LIFT * frame.warp);
        u.uVignette.value = frame.grade.vignette;
        u.uWarp.value = frame.warp;
        u.uFlare.value.copy(frame.flare);
        u.uTidal.value = frame.plunge.tidal;
        u.uBlackout.value = frame.plunge.blackout;
        // Only the plunge and free look hide the page (fade → 1); the mask follows the page
        u.uMaskStrength.value = 1 - frame.fade;
        if (this.bloom) this.bloom.strength = frame.grade.bloom * (1 - 0.45 * frame.plunge.beta);
        if (this.glass) {
            // Glass shows only at rest: it fades out while scrolling (the panel goes opaque then,
            // and rects lag the compositor by a frame), during a warp and when the page is hidden
            const rest = this.glassOn && frame.fade < 0.02 && frame.warp < 0.01
                && !document.documentElement.classList.contains('is-moving');
            this.glassMix = damp(this.glassMix, rest ? 1 : 0, rest ? 5 : 16, frame.dt);
            if (this.glassMix < 0.003) this.glassMix = 0;
            this.glass.enabled = this.glassMix > 0 && this.hasGlassRect();
            u.uGlass.value = this.glass.enabled ? this.glassMix : 0;
        }
        this.composer.render(frame.dt);
    }

    dispose() {
        if (this.composer) {
            this.composer.passes.forEach((p) => p.dispose && p.dispose());
            this.composer.dispose();
        }
        if (this.glassPass) this.glassPass.dispose();
    }
}
