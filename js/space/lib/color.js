/* Blackbody colour by temperature (Kelvin), ported from the original space.js
   tempToColor(). Returns linear RGB in [0, 1]. */
export function tempToColor(T, out = [0, 0, 0]) {
    T = Math.min(40000, Math.max(1000, T)) / 100;
    let r, g, b;
    if (T <= 66) r = 255;
    else r = 329.698727446 * Math.pow(T - 60, -0.1332047592);
    if (T <= 66) g = 99.4708025861 * Math.log(T) - 161.1195681661;
    else g = 288.1221695283 * Math.pow(T - 60, -0.0755148492);
    if (T >= 66) b = 255;
    else if (T <= 19) b = 0;
    else b = 138.5177312231 * Math.log(T - 10) - 305.0447927307;
    out[0] = Math.pow(Math.min(255, Math.max(0, r)) / 255, 2.2);
    out[1] = Math.pow(Math.min(255, Math.max(0, g)) / 255, 2.2);
    out[2] = Math.pow(Math.min(255, Math.max(0, b)) / 255, 2.2);
    return out;
}

/* Star temperature drawn from a cool-heavy distribution (most stars are K/M dwarfs) */
export function sampleStarTemp(rand) {
    const u = rand();
    if (u < 0.55) return 3200 + rand() * 1800;
    if (u < 0.85) return 5000 + rand() * 2000;
    if (u < 0.97) return 7000 + rand() * 4000;
    return 11000 + rand() * 14000;
}
