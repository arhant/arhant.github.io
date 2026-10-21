/* HERO: an orbital sunrise. Earth's limb arcs through the lower right with the
   sun just behind it; scrolling lifts the camera and the sun breaks the horizon.
   Surface, clouds and city lights are baked into cube maps once; the
   atmosphere is an analytic single-scattering shell (Rayleigh + Mie). */
import * as THREE from 'three';
import { bakeCube } from '../lib/bake.js';
import { SIMPLEX, RAY } from '../shaders/common.glsl.js';
import { ORIGINS, SUNS } from '../path-data.js';

const R = 100;
const CENTER = new THREE.Vector3(95, -100, -170);

const EARTH_HEIGHT = /* glsl */ `
float earthHeight(vec3 d) {
    vec3 w = vec3(fbm3(d * 1.3 + 11.0, 4), fbm3(d * 1.3 + 23.0, 4), fbm3(d * 1.3 + 37.0, 4));
    return fbm3(d * 1.15 + w * 0.6, 7) - 0.06;
}
`;

const ALBEDO_FRAG = /* glsl */ `
varying vec3 vDir;
${SIMPLEX}
${EARTH_HEIGHT}
void main() {
    vec3 d = normalize(vDir);
    float coast = earthHeight(d);
    float land = smoothstep(0.0, 0.012, coast);
    float lat = abs(d.y);

    float arid = smoothstep(0.05, 0.45, fbm3(d * 2.2 + 51.0, 4) + 0.4 * (1.0 - abs(lat - 0.28) * 4.0));
    vec3 forest = vec3(0.030, 0.062, 0.022);
    vec3 grass = vec3(0.090, 0.110, 0.045);
    vec3 desert = vec3(0.360, 0.270, 0.150);
    vec3 rock = vec3(0.170, 0.140, 0.115);
    vec3 landCol = mix(mix(forest, grass, smoothstep(-0.2, 0.3, fbm3(d * 6.0, 3))), desert, arid);
    landCol = mix(landCol, rock, smoothstep(0.12, 0.3, coast));
    landCol *= 0.85 + 0.3 * fbm3(d * 24.0, 3);

    float ice = smoothstep(0.04, 0.10, (lat - 0.80) + fbm3(d * 5.0, 3) * 0.08);
    vec3 ocean = mix(vec3(0.004, 0.016, 0.045), vec3(0.010, 0.050, 0.085), smoothstep(-0.10, 0.0, coast));
    vec3 col = mix(ocean, landCol, land);
    col = mix(col, vec3(0.80, 0.84, 0.90), ice);
    gl_FragColor = vec4(col, (1.0 - land) * (1.0 - ice));
}
`;

const AUX_FRAG = /* glsl */ `
varying vec3 vDir;
${SIMPLEX}
${EARTH_HEIGHT}
void main() {
    vec3 d = normalize(vDir);
    vec3 w = vec3(fbm3(d * 2.0 + 3.0, 3), fbm3(d * 2.0 + 13.0, 3), fbm3(d * 2.0 + 29.0, 3));
    float c = fbm3(d * 2.6 + w * 0.9, 6);
    float lat = d.y;
    float belts = 0.15 * exp(-pow(lat / 0.12, 2.0)) + 0.18 * exp(-pow((abs(lat) - 0.6) / 0.15, 2.0));
    float cloud = smoothstep(0.02, 0.5, c + belts - 0.04);
    cloud *= 0.7 + 0.3 * (fbm3(d * 18.0, 3) * 0.5 + 0.5);

    float coast = earthHeight(d);
    float land = smoothstep(0.0, 0.012, coast);
    float near = 1.0 - smoothstep(0.0, 0.14, coast);
    float pop = smoothstep(0.15, 0.7, fbm3(d * 7.0 + 77.0, 4) + 0.3) * smoothstep(0.78, 0.25, abs(lat));
    float points = smoothstep(0.55, 0.95, snoise(d * 240.0)) + 0.35 * smoothstep(0.45, 0.9, snoise(d * 90.0 + 4.0));
    float city = land * pop * (0.35 + 0.65 * near) * points;
    gl_FragColor = vec4(clamp(city * 1.4, 0.0, 1.0), clamp(cloud, 0.0, 1.0), 0.0, 1.0);
}
`;

const SURFACE_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
    vObj = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SURFACE_FRAG = /* glsl */ `
uniform samplerCube uAlbedo;
uniform samplerCube uAux;
uniform vec3 uSunDir;
uniform vec3 uSunObj;
uniform vec3 uSunColor;
uniform float uCloudRot;
uniform float uCity;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;

vec3 rotY(vec3 v, float a) {
    float c = cos(a), s = sin(a);
    return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    vec3 L = uSunDir;
    vec4 alb = textureCube(uAlbedo, vObj);
    float ocean = alb.a;
    float NdL = dot(N, L);
    float NdV = max(dot(N, V), 0.0);
    float day = smoothstep(-0.1, 0.25, NdL);
    float diff = max((NdL + 0.06) / 1.06, 0.0);
    vec3 tint = mix(vec3(1.0, 0.5, 0.3), vec3(1.0), smoothstep(0.0, 0.3, NdL));

    float city = textureCube(uAux, vObj).r;
    float cloud = textureCube(uAux, rotY(vObj, uCloudRot)).g;
    float shadow = textureCube(uAux, rotY(normalize(vObj + uSunObj * 0.012), uCloudRot)).g;

    vec3 surf = alb.rgb * diff * tint * (1.0 - 0.55 * shadow * day);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 220.0) * ocean * (1.0 - cloud);
    float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    surf += vec3(1.0, 0.9, 0.75) * spec * 8.0 * day + vec3(0.02, 0.05, 0.09) * fres * ocean * day * 0.6;

    vec3 col = mix(surf, vec3(0.95) * diff * tint, cloud * 0.92) * uSunColor;
    float night = 1.0 - smoothstep(-0.18, 0.04, NdL);
    col += vec3(1.0, 0.62, 0.32) * city * night * (1.0 - cloud * 0.85) * uCity;
    col += vec3(0.18, 0.35, 0.8) * pow(1.0 - NdV, 3.0) * smoothstep(-0.25, 0.3, NdL) * 0.5;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const ATMO_VERT = /* glsl */ `
varying vec3 vPosW;
void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uCenter;
uniform float uRp;
uniform float uRa;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uIntensity;
varying vec3 vPosW;
${RAY}
void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vPosW - ro);
    vec2 tA = raySphere(ro, rd, uCenter, uRa);
    vec2 tP = raySphere(ro, rd, uCenter, uRp);
    float t0 = max(tA.x, 0.0);
    float t1 = tP.x > 0.0 ? tP.x : tA.y;
    float thick = uRa - uRp;
    float chord = max(t1 - t0, 0.0) / thick;
    vec3 mid = ro + rd * (0.5 * (t0 + t1)) - uCenter;
    float hgt = clamp((length(mid) - uRp) / thick, 0.0, 1.0);
    float sunH = dot(normalize(mid), uSunDir);
    float mu = dot(rd, uSunDir);
    float dens = chord * exp(-hgt * 2.0);
    vec3 beta = vec3(0.075, 0.18, 0.45);
    vec3 scat = 1.0 - exp(-beta * dens);
    vec3 sunT = exp(-beta * 7.0 * (1.0 - smoothstep(-0.2, 0.5, sunH)));
    float lit = smoothstep(-0.3, 0.12, sunH);
    float rayleigh = 0.75 * (1.0 + mu * mu);
    float mie = hgPhase(mu, 0.76) * (1.0 - exp(-dens * 0.08)) * 9.0;
    vec3 col = (scat * rayleigh + mie * vec3(1.0, 0.82, 0.62)) * sunT * lit * uSunColor * uIntensity;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const MOON_FRAG = /* glsl */ `
uniform sampler3D uNoise;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
    vec3 n = normalize(vObj);
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float maria = smoothstep(0.42, 0.62, texture(uNoise, n * 0.35 + 0.2).r);
    float f1 = texture(uNoise, n * 1.1 + 0.3).b;
    float f2 = texture(uNoise, n * 2.7 + 0.5).b;
    float rims = smoothstep(0.30, 0.38, f1) * (1.0 - smoothstep(0.38, 0.5, f1)) + 0.6 * smoothstep(0.32, 0.4, f2) * (1.0 - smoothstep(0.4, 0.5, f2));
    float albedo = 0.17 - 0.07 * maria + 0.05 * rims + 0.03 * (texture(uNoise, n * 6.0).g - 0.5);
    float NdL = max(dot(N, uSunDir), 0.0);
    float NdV = max(dot(N, V), 0.0);
    float ls = NdL / max(NdL + NdV, 1e-3);
    vec3 earthshine = vec3(0.010, 0.013, 0.020) * (0.6 + 0.4 * dot(N, V));
    gl_FragColor = vec4(vec3(albedo) * ls * 2.0 * uSunColor + albedo * earthshine * 6.0, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const SUN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SUN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uCore;
uniform float uScale;
varying vec2 vUv;
void main() {
    float rr = length(vUv * 2.0 - 1.0) * uScale;
    float disc = smoothstep(1.03, 0.97, rr);
    float glow = 0.5 * exp(-rr * 0.9) + 0.18 * exp(-rr * 0.22);
    gl_FragColor = vec4(uColor * (disc * uCore + glow * 3.0) * smoothstep(uScale, uScale * 0.6, rr), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export async function create(ctx) {
    const { renderer, T, noise } = ctx;
    const origin = new THREE.Vector3(...ORIGINS.earth);
    const group = new THREE.Group();
    group.position.copy(origin);

    const sunDir = new THREE.Vector3(...SUNS.earth).normalize();
    const sunColor = new THREE.Vector3(2.1, 2.0, 1.85);

    const albedo = bakeCube(renderer, { size: T.earthCube, fragment: ALBEDO_FRAG });
    const aux = bakeCube(renderer, { size: T.earthCube, fragment: AUX_FRAG });

    // Planet: tilted axis, slow spin
    const tilt = new THREE.Group();
    tilt.position.copy(CENTER);
    tilt.rotation.set(0.35, 0, THREE.MathUtils.degToRad(-23.4));
    group.add(tilt);
    const spin = new THREE.Group();
    tilt.add(spin);

    const seg = T.sphereSeg;
    const surfUniforms = {
        uAlbedo: { value: albedo.texture },
        uAux: { value: aux.texture },
        uSunDir: { value: sunDir },
        uSunObj: { value: new THREE.Vector3() },
        uSunColor: { value: sunColor },
        uCloudRot: { value: 0 },
        uCity: { value: 1.6 },
    };
    const surface = new THREE.Mesh(
        new THREE.SphereGeometry(R, seg, seg / 2),
        new THREE.ShaderMaterial({ uniforms: surfUniforms, vertexShader: SURFACE_VERT, fragmentShader: SURFACE_FRAG }),
    );
    surface.renderOrder = 10;
    spin.add(surface);

    const atmoUniforms = {
        uCenter: { value: new THREE.Vector3() },
        uRp: { value: R },
        uRa: { value: R * 1.035 },
        uSunDir: { value: sunDir },
        uSunColor: { value: sunColor },
        uIntensity: { value: 0.8 },
    };
    const atmo = new THREE.Mesh(
        new THREE.SphereGeometry(R * 1.035, seg, seg / 2),
        new THREE.ShaderMaterial({
            uniforms: atmoUniforms,
            vertexShader: ATMO_VERT,
            fragmentShader: ATMO_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }),
    );
    atmo.position.copy(CENTER);
    atmo.renderOrder = 20;
    group.add(atmo);

    // Moon: craters and maria from the shared noise texture, Lommel-Seeliger shading
    const moon = new THREE.Mesh(
        new THREE.SphereGeometry(20, 64, 32),
        new THREE.ShaderMaterial({
            uniforms: { uNoise: { value: noise }, uSunDir: { value: sunDir }, uSunColor: { value: sunColor } },
            vertexShader: SURFACE_VERT,
            fragmentShader: MOON_FRAG,
        }),
    );
    moon.position.set(250, 135, -820);
    moon.renderOrder = 10;
    group.add(moon);

    // Sun: an HDR billboard placed "at infinity" along sunDir from the camera
    const SUN_SCALE = 14;
    const sunUniforms = { uColor: { value: new THREE.Vector3(1.0, 0.93, 0.82) }, uCore: { value: 30 }, uScale: { value: SUN_SCALE } };
    const sun = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
            uniforms: sunUniforms,
            vertexShader: SUN_VERT,
            fragmentShader: SUN_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }),
    );
    sun.renderOrder = 1;
    sun.frustumCulled = false;
    const SUN_DIST = 20000;
    const sunRadius = Math.tan(THREE.MathUtils.degToRad(0.55)) * SUN_DIST;
    sun.scale.setScalar(sunRadius * SUN_SCALE * 2);
    ctx.scene.add(sun);

    const inv = new THREE.Matrix4();
    const tmp = new THREE.Vector3();

    return {
        group,
        update(f) {
            spin.rotation.y = f.t * 0.01;
            surfUniforms.uCloudRot.value = f.t * 0.004;
            atmoUniforms.uCenter.value.copy(tilt.getWorldPosition(tmp));
            // Sun direction in the spinning surface's object space (for cloud shadows)
            surface.updateMatrixWorld();
            inv.copy(surface.matrixWorld).invert();
            surfUniforms.uSunObj.value.copy(sunDir).transformDirection(inv);
            sun.position.copy(f.camera.position).addScaledVector(sunDir, SUN_DIST);
            sun.quaternion.copy(f.camera.quaternion);
        },
        setVisible(v) { sun.visible = v; },
        setTier() {},
        dispose() {
            ctx.scene.remove(sun);
            albedo.dispose();
            aux.dispose();
            group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
            sun.geometry.dispose();
            sun.material.dispose();
        },
    };
}
