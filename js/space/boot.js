/* Scene entry point. No static imports, so a missing import map, a blocked
   file or a weak GPU all end in the same place: space:fallback, and the page
   keeps its static CSS backdrop.

   ?quality=high|medium|low forces a tier (and skips the software-GPU check).
   ?poster=<s>[&t=<seconds>] renders one still of section-space position s on
   the high tier and hands it over as window.__poster (see app.js). */

const SOFTWARE_GPU = /SwiftShader|llvmpipe|Software|Basic Render|softpipe/i;
const TIERS = ['low', 'medium', 'high'];

// The scene's modules up to its first frame, preloaded in parallel at low priority once the GPU
// check has passed, so a device that ends on the static backdrop never downloads them.
// Must track the import graph of app.js: a stale entry wastes a fetch, a missing one costs a round trip.
const SCENE_PRELOAD = [
    './app.js',
    './events.js',
    './quality.js',
    './camera-rig.js',
    './plunge.js',
    './post.js',
    './glass.js',
    './readability.js',
    './path-data.js',
    './lib/bake.js',
    './lib/math.js',
    './lib/color.js',
    './lib/glow.js',
    './shaders/final.glsl.js',
    './shaders/common.glsl.js',
    './setpieces/sky.js',
    './setpieces/stars.js',
    './setpieces/registry.js',
    './setpieces/earth.js',
    '../vendor/three/three.module.min.js',
    '../vendor/three/addons/postprocessing/EffectComposer.js',
    '../vendor/three/addons/postprocessing/RenderPass.js',
    '../vendor/three/addons/postprocessing/ShaderPass.js',
    '../vendor/three/addons/postprocessing/MaskPass.js',
    '../vendor/three/addons/postprocessing/Pass.js',
    '../vendor/three/addons/postprocessing/UnrealBloomPass.js',
    '../vendor/three/addons/shaders/CopyShader.js',
    '../vendor/three/addons/shaders/LuminosityHighPassShader.js',
];

// Not on Save-Data, 2G or low-memory devices: there the modules arrive one import level at a time
function preloadScene() {
    const conn = navigator.connection;
    if (conn && (conn.saveData || /2g$/.test(conn.effectiveType || ''))) return;
    if (navigator.deviceMemory && navigator.deviceMemory < 4) return;
    for (const src of SCENE_PRELOAD) {
        const link = document.createElement('link');
        link.rel = 'modulepreload';
        link.href = new URL(src, import.meta.url).href;
        link.setAttribute('fetchpriority', 'low');
        document.head.appendChild(link);
    }
}

function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

class Fallback extends Error {
    constructor(reason) {
        super(reason);
        this.reason = reason;
    }
}

function probeGPU(forced) {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: !forced });
    if (!gl) throw new Fallback(forced ? 'no-webgl2' : 'no-webgl2-or-slow');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const halfFloat = !!(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'));
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return { renderer, halfFloat };
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Fallback('load-timeout')), ms)),
    ]);
}

export async function start({ canvas }) {
    let done = false;
    try {
        const params = new URLSearchParams(location.search);
        const posterS = params.has('poster') ? parseFloat(params.get('poster')) : NaN;
        const poster = Number.isFinite(posterS) ? { s: posterS, t: parseFloat(params.get('t')) || 0 } : null;
        const forced = poster ? 'high' : TIERS.includes(params.get('quality')) ? params.get('quality') : null;
        if (!canvas) throw new Fallback('no-canvas');
        if (!(HTMLScriptElement.supports && HTMLScriptElement.supports('importmap'))) throw new Fallback('no-importmap');

        const gpu = probeGPU(!!forced);
        if (!forced && SOFTWARE_GPU.test(gpu.renderer)) throw new Fallback('software-gpu');

        preloadScene();
        const app = await withTimeout(import('./app.js'), 10000);
        done = true;
        await app.run({ canvas, forced, poster, ...gpu });
    } catch (err) {
        if (!done || err instanceof Fallback) {
            console.info('[space] static backdrop:', err && (err.reason || err.message));
            emit('space:fallback', { reason: (err && err.reason) || 'load-failed' });
        } else {
            console.warn('[space] scene error', err);
            emit('space:fallback', { reason: 'load-failed' });
        }
    }
}
