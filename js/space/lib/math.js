/* Small math helpers shared by the scene modules */

// Frame-rate independent exponential smoothing
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;

// Seeded PRNG so every layout is deterministic across visits
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Standard normal sample (Box-Muller)
export function gaussian(rand) {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
