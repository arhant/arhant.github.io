/* Quality tiers, the first-guess heuristic, saved decisions, and the runtime frame-time governor */

export const TIERS = {
    high: {
        name: 'high', dpr: 1.75, bloom: true, bloomScale: 1, msaa: 2, ca: true, fxaa: false,
        skyCube: 512, earthCube: 1024, noise: 128, bands: 2048, sphereSeg: 128,
        nearStars: 6000, farStars: 12000, nebulaSteps: 48, nebulaScale: 0.5,
        bhSteps: 120, asteroids: 3000, galaxyPoints: 60000, prominences: 6,
    },
    medium: {
        name: 'medium', dpr: 1.0, bloom: true, bloomScale: 0.5, msaa: 0, ca: false, fxaa: true,
        skyCube: 384, earthCube: 512, noise: 64, bands: 1024, sphereSeg: 96,
        nearStars: 4000, farStars: 8000, nebulaSteps: 28, nebulaScale: 0.5,
        bhSteps: 64, asteroids: 1200, galaxyPoints: 25000, prominences: 3,
    },
    low: {
        name: 'low', dpr: 1.0, bloom: false, bloomScale: 0.5, msaa: 0, ca: false, fxaa: false,
        skyCube: 256, earthCube: 256, noise: 64, bands: 1024, sphereSeg: 64,
        nearStars: 2000, farStars: 4000, nebulaSteps: 14, nebulaScale: 0.25,
        bhSteps: 40, asteroids: 300, galaxyPoints: 8000, prominences: 0,
    },
};

export const TIER_ORDER = ['low', 'medium', 'high'];
export const SOFTWARE_GPU = /SwiftShader|llvmpipe|Software|Basic Render|softpipe/i;
// Safari masks every Apple GPU as "Apple GPU"; Chromium and Firefox name the chip ("Apple M1")
const APPLE_GPU = /Apple (GPU|M\d)/i;

/* First guess from the GPU name. Most visitors have integrated graphics, so only discrete
   GPUs and higher-end Apple Silicon start on high; the frame probe then corrects the guess. */
export function guessTier(rendererString, hints = {}) {
    const r = rendererString || '';
    const coarse = matchMedia('(pointer: coarse)').matches;
    if (hints.saveData) return 'low';
    // Phones and tablets: large Apple tablets (iPad) and recent Adreno get medium; iPhones stay
    // on low, where long sessions throttle
    if (coarse) return (APPLE_GPU.test(r) || /Adreno.*\b[7-9]\d\d\b/i.test(r)) && innerWidth >= 1024 ? 'medium' : 'low';
    // Mac Safari: the chip is hidden, so medium (with a Retina-friendly buffer, see bufferLimits)
    if (/Apple GPU/i.test(r)) return 'medium';
    if (/Mali|Adreno|PowerVR/i.test(r)) return 'low';
    if (/Intel.*\b(U?HD|HD) Graphics\b/i.test(r) && !/Iris|Arc/i.test(r)) return 'low';
    if (hints.deviceMemory && hints.deviceMemory <= 4) return 'low';
    // Discrete GPUs and higher-end Apple Silicon
    if (/RTX|GTX 1[06-9]|GTX [2-9]\d|Radeon RX|Radeon Pro|Arc A\d|Apple M\d (Pro|Max|Ultra)|Apple M[3-9]/i.test(r)) return 'high';
    // Iris Xe, Radeon integrated (APUs), Apple M1/M2 and everything else
    return 'medium';
}

/* Drawing-buffer ceiling for a tier: a device-pixel-ratio cap and, below high, a pixel budget
   (very large canvases render fewer pixels; the UI stays sharp because it isn't in the canvas).
   Apple GPUs with a fine pointer (Macs) drive Retina panels well at medium, so they get more. */
export function bufferLimits(tier, rendererString) {
    if (tier.name === 'high') return { dpr: tier.dpr, pixels: Infinity };
    if (tier.name === 'medium' && APPLE_GPU.test(rendererString || '') && matchMedia('(pointer: fine)').matches) {
        return { dpr: 1.5, pixels: 3.5e6 };
    }
    return { dpr: tier.dpr, pixels: 2.4e6 };
}

/* Saved tiers. Only deliberate decisions persist across visits: the boot probe's result ('probe')
   and the visitor's own choice ('user'). A mid-session governor downgrade ('governor') lasts for
   the session only, so one thermal blip can't lock a device to low quality for a week. */
const SAVE_KEY = 'space.tier.v2';
const OLD_KEY = 'space.tier.v1';
const DAY = 24 * 3600 * 1000;
const SAVE_TTL = { probe: 7 * DAY, user: 30 * DAY };

function read(storage) {
    try { return JSON.parse(storage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; }
}

/* → {tier, reason} or null. A session entry wins over the stored decision: a governor downgrade,
   or the visitor's own choice where localStorage is blocked (it stays pinned for the session). */
export function loadSavedTier(rendererString) {
    try { localStorage.removeItem(OLD_KEY); } catch (e) { /* storage unavailable */ }
    const ok = (saved) => saved && saved.renderer === rendererString && TIERS[saved.tier];
    let session = null;
    let local = null;
    try { session = read(sessionStorage); } catch (e) { /* storage unavailable */ }
    try { local = read(localStorage); } catch (e) { /* storage unavailable */ }
    if (ok(session)) return { tier: session.tier, reason: session.reason === 'user' ? 'user' : 'governor' };
    if (ok(local) && Date.now() - local.t < (SAVE_TTL[local.reason] || 0)) return { tier: local.tier, reason: local.reason };
    return null;
}

/* reason: 'probe' | 'user' persist (and replace any session downgrade); 'governor' is per session.
   A 'user' choice falls back to sessionStorage when localStorage is blocked. Returns whether the
   entry was stored where loadSavedTier will find it. */
export function saveTier(tier, rendererString, reason) {
    const entry = JSON.stringify({ tier, renderer: rendererString, reason, t: Date.now() });
    // Even reading window.localStorage can throw where storage is blocked, so the lookup is inside the try
    const put = (store) => {
        try { store().setItem(SAVE_KEY, entry); return true; } catch (e) { return false; }
    };
    const session = () => sessionStorage;
    if (reason === 'governor') return put(session);
    if (put(() => localStorage)) {
        try { sessionStorage.removeItem(SAVE_KEY); } catch (e) { /* storage unavailable */ }
        return true;
    }
    return reason === 'user' && put(session);
}

export function clearSavedTier() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    try { sessionStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

/* Watches frame intervals and steps quality down when frames keep dropping, cheapest lever first:
   a high-refresh cadence (72-100 fps) falls back to 60 fps or lower, then resolution scale
   1 → 0.85 → 0.7, then a lower tier, then give up (static backdrop). It only ever raises the
   resolution scale back, never the cadence or the tier, so it can't oscillate.
   verify(now), when given, is asked before each step down: true holds the step (the loop is
   checking whether the display itself slowed down, which no step could fix). */
export class Governor {
    constructor({ budgetMs = 1000 / 60, onCadence, onScale, onTier, onGiveUp, verify = null }) {
        this.budget = budgetMs;
        this.onCadence = onCadence;
        this.onScale = onScale;
        this.onTier = onTier;
        this.onGiveUp = onGiveUp;
        this.verify = verify;
        this.scale = 1;
        this.fast = false; // set by the loop while it renders above 60 fps
        this.samples = [];
        this.quietUntil = 0;
        this.goodSince = 0;
        this.badLowSince = 0;
        this.tier = 'high';
    }

    quiet(ms) {
        this.quietUntil = performance.now() + ms;
        this.samples.length = 0;
        this.goodSince = 0;
    }

    /* A new starting point (boot-probe step, the visitor's choice, the perf revival) */
    reset(tier) {
        this.tier = tier;
        this.scale = 1;
        this.badLowSince = 0;
        this.goodSince = 0;
        this.samples.length = 0;
    }

    /* `expected` is the interval the loop is aiming for on this display (every Nth refresh, and
       slower when idle); only slower than that counts as dropped */
    sample(intervalMs, now, expected = this.budget) {
        if (now < this.quietUntil) return;
        const samples = this.samples;
        samples.push(now, intervalMs > expected * 1.5 ? 1 : 0);
        while (samples.length && samples[0] < now - 2000) samples.splice(0, 2);
        // Judge ~2 s windows; a few frames are enough, so even a loop crawling at 5 fps gets judged
        if (samples.length < 16 || now - samples[0] < 1800) return;

        let dropped = 0;
        for (let i = 1; i < samples.length; i += 2) dropped += samples[i];
        const ratio = dropped / (samples.length / 2);

        if (ratio > 0.25) {
            this.goodSince = 0;
            if (this.verify && this.verify(now)) return;
            this.downgrade(now, ratio);
        } else if (ratio < 0.02) {
            this.badLowSince = 0;
            if (!this.goodSince) this.goodSince = now;
            if (this.scale < 1 && now - this.goodSince > 10000) {
                this.scale = this.scale < 0.8 ? 0.85 : 1;
                this.onScale(this.scale);
                this.quiet(3000);
            }
        }
    }

    downgrade(now, ratio) {
        // A faster-than-60 cadence goes first, so it can never cost pixels or a tier
        if (this.fast) {
            this.fast = false;
            this.onCadence();
            this.quiet(3000);
            return;
        }
        if (this.scale > 0.75) {
            this.scale = this.scale > 0.9 ? 0.85 : 0.7;
            this.onScale(this.scale);
            this.quiet(3000);
            return;
        }
        const idx = TIER_ORDER.indexOf(this.tier);
        if (idx > 0) {
            this.tier = TIER_ORDER[idx - 1];
            this.scale = 1;
            this.onTier(this.tier);
            this.quiet(3000);
            return;
        }
        if (ratio > 0.3) {
            if (!this.badLowSince) this.badLowSince = now;
            if (now - this.badLowSince > 5000) this.onGiveUp();
        }
    }
}
