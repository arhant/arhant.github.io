/* Blackbody colour (Tanner Helland's fit), the same curve as the original
   space.js tempToColor(), returned in linear RGB. */
export const BLACKBODY = /* glsl */ `
vec3 blackbody(float T) {
    T = clamp(T, 1000.0, 40000.0) / 100.0;
    float r = T <= 66.0 ? 1.0 : clamp(1.29293618606 * pow(T - 60.0, -0.1332047592), 0.0, 1.0);
    float g = T <= 66.0
        ? clamp(0.39008157876 * log(T) - 0.63184144378, 0.0, 1.0)
        : clamp(1.12989086089 * pow(T - 60.0, -0.0755148492), 0.0, 1.0);
    float b = T >= 66.0 ? 1.0
        : (T <= 19.0 ? 0.0 : clamp(0.54320678911 * log(T - 10.0) - 1.19625408914, 0.0, 1.0));
    return pow(vec3(r, g, b), vec3(2.2));
}
`;
