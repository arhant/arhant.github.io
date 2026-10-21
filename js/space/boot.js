/* Scene entry point. No static imports, so a missing import map, a blocked
   file or a weak GPU all end in the same place: space:fallback, and the page
   keeps its static CSS backdrop.

   ?quality=high|medium|low forces a tier (and skips the software-GPU check). */

const SOFTWARE_GPU = /SwiftShader|llvmpipe|Software|Basic Render|softpipe/i;
const TIERS = ['low', 'medium', 'high'];

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
        const forced = TIERS.includes(params.get('quality')) ? params.get('quality') : null;
        if (!canvas) throw new Fallback('no-canvas');
        if (!(HTMLScriptElement.supports && HTMLScriptElement.supports('importmap'))) throw new Fallback('no-importmap');

        const gpu = probeGPU(!!forced);
        if (!forced && SOFTWARE_GPU.test(gpu.renderer)) throw new Fallback('software-gpu');

        const app = await withTimeout(import('./app.js'), 10000);
        done = true;
        await app.run({ canvas, forced, ...gpu });
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
