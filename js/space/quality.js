/* Quality tiers, the first-guess heuristic, and the runtime frame-time governor */

export const TIERS = {
    high: {
        name: 'high', dpr: 1.75, bloom: true, bloomScale: 1, msaa: 2, ca: true,
        skyCube: 512, earthCube: 1024, noise: 128, bands: 2048, sphereSeg: 128,
        nearStars: 6000, farStars: 12000, nebulaSteps: 48, nebulaScale: 0.5,
        bhSteps: 120, asteroids: 3000, galaxyPoints: 60000, prominences: 6,
    },
    medium: {
        name: 'medium', dpr: 1.25, bloom: true, bloomScale: 0.5, msaa: 0, ca: false,
        skyCube: 384, earthCube: 512, noise: 64, bands: 1024, sphereSeg: 96,
        nearStars: 4000, farStars: 8000, nebulaSteps: 28, nebulaScale: 0.5,
        bhSteps: 64, asteroids: 1200, galaxyPoints: 25000, prominences: 3,
    },
    low: {
        name: 'low', dpr: 1.0, bloom: false, bloomScale: 0.5, msaa: 0, ca: false,
        skyCube: 256, earthCube: 256, noise: 64, bands: 1024, sphereSeg: 64,
        nearStars: 2000, farStars: 4000, nebulaSteps: 14, nebulaScale: 0.25,
        bhSteps: 40, asteroids: 300, galaxyPoints: 8000, prominences: 0,
    },
};

export const TIER_ORDER = ['low', 'medium', 'high'];
export const SOFTWARE_GPU = /SwiftShader|llvmpipe|Software|Basic Render|softpipe/i;

export function guessTier(rendererString, hints = {}) {
    const r = rendererString || '';
    const coarse = matchMedia('(pointer: coarse)').matches;
    if (hints.saveData) return 'low';
    if (/Mali-[GT]?[4-7]\d|Adreno.*\b[3-5]\d\d\b|PowerVR|HD Graphics [2-5]\d\d\b/i.test(r)) return 'low';
    if (coarse && innerWidth < 768) return 'low';
    let tier = 'medium';
    if (/RTX|GTX 1[06-9]|GTX [2-9]\d|Radeon RX|Radeon Pro|Arc A|Apple M[2-9]/i.test(r)) tier = 'high';
    if (hints.deviceMemory && hints.deviceMemory <= 4 && tier === 'high') tier = 'medium';
    if (coarse && tier === 'high') tier = 'medium';
    return tier;
}

const SAVE_KEY = 'space.tier.v1';
const SAVE_TTL = 7 * 24 * 3600 * 1000;

export function loadSavedTier(rendererString) {
    try {
        const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
        if (saved && saved.renderer === rendererString && Date.now() - saved.t < SAVE_TTL && TIERS[saved.tier]) return saved.tier;
    } catch (e) { /* storage unavailable */ }
    return null;
}

export function saveTier(tier, rendererString) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ tier, renderer: rendererString, t: Date.now() })); } catch (e) { /* ignore */ }
}

/* Watches frame intervals and steps quality down when frames keep dropping:
   resolution scale 1 → 0.85 → 0.7, then a lower tier, then give up (static backdrop).
   It only ever raises the resolution scale, never the tier, so it can't oscillate. */
export class Governor {
    constructor({ budgetMs = 1000 / 60, onScale, onTier, onGiveUp }) {
        this.budget = budgetMs;
        this.onScale = onScale;
        this.onTier = onTier;
        this.onGiveUp = onGiveUp;
        this.scale = 1;
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

    /* `expected` is the interval the loop is aiming for on this display (idle frames are
       deliberately 30fps, and a 75Hz screen can't hit exactly 60fps); only slower counts as dropped */
    sample(intervalMs, now, expected = this.budget) {
        if (now < this.quietUntil) return;
        const samples = this.samples;
        samples.push(now, intervalMs > expected * 1.5 ? 1 : 0);
        while (samples.length && samples[0] < now - 2000) samples.splice(0, 2);
        if (samples.length < 40 || now - samples[0] < 1800) return;

        let dropped = 0;
        for (let i = 1; i < samples.length; i += 2) dropped += samples[i];
        const ratio = dropped / (samples.length / 2);

        if (ratio > 0.25) {
            this.goodSince = 0;
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
