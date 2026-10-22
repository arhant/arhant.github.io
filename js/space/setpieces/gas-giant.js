/* EXPERIENCE: a ringed gas giant. Banded atmosphere baked once (with
   differential rotation applied at runtime), analytic shadows in both
   directions (rings on the planet, planet on the rings), rings that glow by
   forward scattering when backlit, and a belt of instanced moonlets whose
   Keplerian orbits are computed in the vertex shader. Two moons: a hazy,
   Titan-like world and a bright icy one with "tiger stripe" fractures. */
import * as THREE from 'three';
import { bake2D } from '../lib/bake.js';
import { SIMPLEX, RAY } from '../shaders/common.glsl.js';
import { ORIGINS, FRAMES, SUNS, viewPoint } from '../path-data.js';
import { mulberry32, gaussian } from '../lib/math.js';

const R = 220;
const RIN = 1.25;
const ROUT = 2.3;
const TIERS_MAX_ROCKS = 3000;

const BANDS_FRAG = /* glsl */ `
varying vec2 vUv;
${SIMPLEX}
void main() {
    float lat = (vUv.y - 0.5) * 3.14159265;
    float lon = vUv.x * 6.2831853;
    vec3 d = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
    float turb = fbm3(d * vec3(3.0, 12.0, 3.0) + 2.0, 5);
    float turb2 = fbm3(d * vec3(9.0, 30.0, 9.0) + 7.0, 4);
    float y = lat + turb * 0.035 + turb2 * 0.012;
    float bands = sin(y * 21.0) * 0.5 + 0.5;
    float bands2 = sin(y * 47.0 + 1.3) * 0.5 + 0.5;
    vec3 cream = vec3(0.78, 0.70, 0.56);
    vec3 ochre = vec3(0.60, 0.42, 0.25);
    vec3 rust = vec3(0.44, 0.25, 0.15);
    vec3 slate = vec3(0.40, 0.38, 0.48);
    vec3 col = mix(ochre, cream, smoothstep(0.35, 0.75, bands));
    col = mix(col, rust, smoothstep(0.6, 0.95, bands2) * 0.5);
    col = mix(col, slate, smoothstep(0.55, 0.9, abs(lat) / 1.5708));
    col *= 0.88 + 0.24 * (turb2 * 0.5 + 0.5);

    vec2 so = vec2((lon - 2.2) * cos(lat), lat + 0.38);
    float sr = length(so / vec2(0.17, 0.065));
    float swirl = fbm3(vec3(so * 22.0, 1.0), 3);
    col = mix(col, vec3(0.70, 0.36, 0.22) * (0.85 + 0.3 * swirl), smoothstep(1.0, 0.55, sr) * 0.85);
    gl_FragColor = vec4(col, 1.0);
}
`;

const PLANET_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
    vObj = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const PLANET_FRAG = /* glsl */ `
uniform sampler2D uBands;
uniform sampler2D uRing;
uniform vec3 uSunL;
uniform vec3 uSunW;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uR;
uniform float uRin;
uniform float uRout;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
${RAY}
void main() {
    vec3 n = normalize(vObj);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(n.z, n.x);
    // Differential rotation by latitude, held at one rate across the storm's band so the oval
    // drifts as a whole instead of shearing into a smear over time
    float rl = mix(lat, -0.38, 1.0 - smoothstep(0.07, 0.12, abs(lat + 0.38)));
    float u = lon / 6.2831853 + 0.5 + uTime * (0.0016 + 0.0009 * cos(rl * 7.0));
    vec3 alb = texture2D(uBands, vec2(u, lat / 3.14159265 + 0.5)).rgb;

    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float NdL = dot(n, uSunL);
    float NdV = max(dot(N, V), 0.0);
    float diff = max(NdL, 0.0);

    // Ring shadow: follow the sun ray from this surface point to the ring plane
    float occ = 0.0;
    if (abs(uSunL.y) > 1e-3) {
        vec3 p = n * uR;
        float tr = -p.y / uSunL.y;
        if (tr > 0.0) {
            float rr = length((p + uSunL * tr).xz) / uR;
            // Explicit LOD: this lookup sits in a branch, where implicit mip derivatives are undefined
            if (rr > uRin && rr < uRout) occ = textureLod(uRing, vec2((rr - uRin) / (uRout - uRin), 0.5), 0.0).a;
        }
    }

    vec3 col = alb * diff * (1.0 - 0.85 * occ) * mix(0.68, 1.0, NdV) * uSunColor;
    col *= mix(vec3(1.0, 0.72, 0.5), vec3(1.0), smoothstep(0.0, 0.25, NdL));
    float rim = pow(1.0 - NdV, 4.0);
    float mu = dot(-V, uSunW);
    col += vec3(1.0, 0.82, 0.62) * rim * (smoothstep(-0.2, 0.3, NdL) * 0.3 + hgPhase(mu, 0.7) * smoothstep(-0.45, 0.05, NdL) * 0.9) * uSunColor.x;
    col += alb * 0.004;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const RING_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vPosW;
void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RING_FRAG = /* glsl */ `
uniform sampler2D uRing;
uniform vec3 uSunL;
uniform vec3 uSunW;
uniform vec3 uNormalW;
uniform vec3 uSunColor;
uniform float uPresence;
uniform float uR;
uniform float uRin;
uniform float uRout;
varying vec3 vLocal;
varying vec3 vPosW;
${RAY}
void main() {
    float rr = length(vLocal.xz) / uR;
    vec4 prof = texture2D(uRing, vec2((rr - uRin) / (uRout - uRin), 0.5));
    float dens = prof.a;
    if (dens < 0.004) discard;

    // Planet shadow on the rings (soft edge from the closest approach of the sun ray)
    vec3 oc = vLocal;
    float b = dot(oc, uSunL);
    float d2 = dot(oc, oc) - b * b;
    float shadow = b < 0.0 ? 1.0 - smoothstep(uR * uR * 0.94, uR * uR * 1.02, d2) : 0.0;

    vec3 V = normalize(cameraPosition - vPosW);
    float sideV = dot(V, uNormalW);
    float sideL = dot(uSunW, uNormalW);
    float lit = abs(sideL);
    float mu = dot(-V, uSunW);
    vec3 col;
    float alpha;
    if (sideV * sideL < 0.0) {
        // Seen from the unlit side: light diffuses through, strongest looking toward the sun
        float through = (1.0 - dens) * dens * 2.2 * (0.12 + hgPhase(mu, 0.55) * 2.6);
        col = prof.rgb * vec3(1.0, 0.86, 0.7) * (through + lit * 0.1);
        alpha = dens * 0.85;
    } else {
        col = prof.rgb * (lit * 1.05 + hgPhase(mu, 0.3) * 0.6);
        alpha = dens;
    }
    col *= (1.0 - 0.96 * shadow) * uSunColor;
    alpha *= uPresence;
    gl_FragColor = vec4(col * alpha, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const ROCK_VERT = /* glsl */ `
varying vec3 vObj;
attribute vec4 aOrbit;
attribute vec4 aSpin;
attribute float aScale;
attribute float aTint;
uniform float uTime;
varying vec3 vNormalW;
varying vec3 vPosW;
varying float vTint;
${RAY}
void main() {
    float ang = aOrbit.y + uTime * aOrbit.z;
    vec3 center = vec3(cos(ang) * aOrbit.x, aOrbit.w, sin(ang) * aOrbit.x);
    float sa = uTime * aSpin.w;
    vec3 p = rotateAxis(position * aScale, aSpin.xyz, sa);
    vec3 n = rotateAxis(normal, aSpin.xyz, sa);
    vObj = position * 0.35 + aTint * 7.0;
    vec4 wp = modelMatrix * vec4(center + p, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * n);
    vTint = aTint;
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ROCK_FRAG = /* glsl */ `
uniform vec3 uSunW;
uniform vec3 uSunColor;
uniform vec3 uPlanetW;
uniform sampler3D uNoise;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
varying float vTint;
void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    vec4 nz = texture(uNoise, vObj);
    float pits = smoothstep(0.08, 0.28, nz.b);
    vec3 albedo = mix(vec3(0.10, 0.095, 0.09), vec3(0.17, 0.145, 0.12), vTint) * (0.65 + 0.55 * nz.r) * (0.6 + 0.4 * pits);
    float diff = max(dot(N, uSunW), 0.0);
    float shine = max(dot(N, normalize(uPlanetW - vPosW)), 0.0) * 0.06;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * diff * 0.4;
    vec3 col = albedo * (diff * uSunColor + shine * vec3(0.9, 0.7, 0.5)) + rim * uSunColor * 0.2;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const MOON_VERT = /* glsl */ `
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

const MOON_FRAG = /* glsl */ `
uniform sampler3D uNoise;
uniform vec3 uSunW;
uniform vec3 uSunColor;
uniform vec3 uAlbedo;
uniform vec3 uHaze;
uniform float uHazeAmt;
uniform float uIce;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
${RAY}
void main() {
    vec3 n = vObj;
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float NdL = dot(N, uSunW);
    vec3 alb = uAlbedo;
    if (uIce > 0.5) {
        float craters = smoothstep(0.18, 0.42, texture(uNoise, n * 1.7).b);
        float stripes = smoothstep(0.78, 0.92, texture(uNoise, vec3(n.x * 3.0, n.y * 0.7, n.z * 3.0)).a)
                      * smoothstep(-0.15, -0.6, n.y);
        alb *= 0.82 + 0.22 * craters;
        alb = mix(alb, vec3(0.42, 0.58, 0.74), stripes * 0.75);
    } else {
        float bands = texture(uNoise, vec3(n.y * 2.2, 0.31, 0.6)).r;
        alb *= 0.85 + 0.25 * bands;
    }
    vec3 col = alb * max(NdL, 0.0) * uSunColor;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    float mu = dot(-V, uSunW);
    col += uHaze * uHazeAmt * rim * (smoothstep(-0.3, 0.4, NdL) + hgPhase(mu, 0.6) * 2.0) * uSunColor;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

function ringProfile(rand) {
    const N = 1024;
    const data = new Uint8Array(N * 4);
    const ringlet = [];
    for (let i = 0; i < 64; i++) ringlet.push(rand());
    const smooth = (x) => {
        const i = Math.floor(x);
        const f = x - i;
        const a = ringlet[i % 64];
        const b = ringlet[(i + 1) % 64];
        return a + (b - a) * f * f * (3 - 2 * f);
    };
    const s = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    for (let i = 0; i < N; i++) {
        const r = RIN + (i / (N - 1)) * (ROUT - RIN);
        let d = 0.14 * s(1.25, 1.32, r);                       // C ring
        d += 0.66 * s(1.47, 1.53, r) * (1 - s(1.93, 1.95, r)); // B ring
        d += 0.5 * s(2.02, 2.05, r) * (1 - s(2.24, 2.28, r));  // A ring
        d *= 1 - 0.92 * Math.exp(-Math.pow((r - 2.195) / 0.006, 2)); // Encke-like gap
        d *= 0.72 + 0.28 * smooth(r * 90) * (0.6 + 0.4 * smooth(r * 410 + 7));
        const grey = r < 1.5 ? 0.62 : 0.78;
        data[i * 4] = Math.round(255 * grey * 0.98);
        data[i * 4 + 1] = Math.round(255 * grey * 0.9);
        data[i * 4 + 2] = Math.round(255 * grey * 0.78);
        data[i * 4 + 3] = Math.round(255 * Math.min(1, d));
    }
    const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
    // Mipmapped: where the rings are foreshortened, the ringlets and gaps are finer than a pixel
    // and a single-level lookup shimmers as the camera moves
    tex.generateMipmaps = true;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
}

/* Average the flat per-face normals of a non-indexed mesh across shared positions */
function smoothNormals(g) {
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const sums = new Map();
    const key = (i) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    for (let i = 0; i < pos.count; i++) {
        const k = key(i);
        const s = sums.get(k) || [0, 0, 0];
        s[0] += nor.getX(i); s[1] += nor.getY(i); s[2] += nor.getZ(i);
        sums.set(k, s);
    }
    for (let i = 0; i < pos.count; i++) {
        const s = sums.get(key(i));
        const l = Math.hypot(s[0], s[1], s[2]) || 1;
        nor.setXYZ(i, s[0] / l, s[1] / l, s[2] / l);
    }
    nor.needsUpdate = true;
}

function rockGeometry(rand) {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const pos = g.getAttribute('position');
    const freqs = [];
    for (let k = 0; k < 4; k++) {
        freqs.push([gaussian(rand) * 2.5, gaussian(rand) * 2.5, gaussian(rand) * 2.5, rand() * 6.28, 0.12 / (k + 1)]);
    }
    const stretch = [1 + rand() * 0.6, 0.7 + rand() * 0.3, 0.8 + rand() * 0.4];
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        let r = 1;
        for (const f of freqs) r += f[4] * Math.sin(v.x * f[0] + v.y * f[1] + v.z * f[2] + f[3]);
        v.multiplyScalar(r);
        pos.setXYZ(i, v.x * stretch[0], v.y * stretch[1], v.z * stretch[2]);
    }
    g.computeVertexNormals();
    smoothNormals(g);
    return g;
}

export async function create(ctx) {
    const { renderer, T } = ctx;
    const rand = mulberry32(777);
    const origin = new THREE.Vector3(...ORIGINS.gasGiant);
    const group = new THREE.Group();
    group.position.copy(origin);
    group.rotation.set(...FRAMES.gasGiant);
    group.updateMatrixWorld();

    const sunL = new THREE.Vector3(...SUNS.gasGiant).normalize();
    const sunW = sunL.clone().applyEuler(group.rotation);
    const normalW = new THREE.Vector3(0, 1, 0).applyEuler(group.rotation);
    // Shared by every lit surface; update() scales it by presence (rings fade their alpha instead)
    const SUN = new THREE.Vector3(1.25, 1.2, 1.12);
    const sunColor = SUN.clone();

    const bands = await bake2D(renderer, { width: T.bands, height: T.bands / 2, fragment: BANDS_FRAG, label: 'gas-giant-bands' });
    const ring = ringProfile(rand);
    const common = {
        uSunL: { value: sunL }, uSunW: { value: sunW }, uSunColor: { value: sunColor },
        uR: { value: R }, uRin: { value: RIN }, uRout: { value: ROUT }, uRing: { value: ring },
    };

    const planetUniforms = { ...common, uBands: { value: bands.texture }, uTime: { value: 0 } };
    const planet = new THREE.Mesh(
        new THREE.SphereGeometry(R, T.sphereSeg, T.sphereSeg / 2),
        new THREE.ShaderMaterial({ uniforms: planetUniforms, vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG }),
    );
    planet.renderOrder = 10;
    group.add(planet);

    const ringGeo = new THREE.RingGeometry(RIN * R, ROUT * R, 256, 1);
    ringGeo.rotateX(-Math.PI / 2);
    const ringUniforms = { ...common, uNormalW: { value: normalW }, uSunColor: { value: SUN }, uPresence: { value: 1 } };
    const rings = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({
        uniforms: ringUniforms,
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    rings.renderOrder = 20;
    group.add(rings);

    // Moonlet belt just outside the rings, concentrated around where the camera crosses the ring plane
    const rockUniforms = {
        uNoise: { value: ctx.noise },
        uTime: { value: 0 },
        uSunW: { value: sunW },
        uSunColor: { value: sunColor },
        uPlanetW: { value: origin.clone() },
    };
    const rockMat = new THREE.ShaderMaterial({ uniforms: rockUniforms, vertexShader: ROCK_VERT, fragmentShader: ROCK_FRAG });
    const SHAPES = 4;
    const perShape = Math.ceil(TIERS_MAX_ROCKS / SHAPES);
    const rocks = [];
    const crossing = Math.atan2(340, -620);
    for (let k = 0; k < SHAPES; k++) {
        const base = rockGeometry(rand);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = base.index;
        geo.setAttribute('position', base.getAttribute('position'));
        geo.setAttribute('normal', base.getAttribute('normal'));
        const orbit = new Float32Array(perShape * 4);
        const spin = new Float32Array(perShape * 4);
        const scale = new Float32Array(perShape);
        const tint = new Float32Array(perShape);
        const axis = new THREE.Vector3();
        for (let i = 0; i < perShape; i++) {
            const r = R * (2.42 + Math.pow(rand(), 0.8) * 0.48);
            orbit[i * 4] = r;
            orbit[i * 4 + 1] = crossing + gaussian(rand) * 0.45;
            orbit[i * 4 + 2] = -0.05 * Math.pow(r / R, -1.5);
            orbit[i * 4 + 3] = gaussian(rand) * 4;
            axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
            spin[i * 4] = axis.x; spin[i * 4 + 1] = axis.y; spin[i * 4 + 2] = axis.z;
            spin[i * 4 + 3] = (rand() - 0.5) * 0.8;
            scale[i] = 0.3 + 1.9 * Math.pow(rand(), 4);
            tint[i] = rand();
        }
        geo.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
        geo.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4));
        geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scale, 1));
        geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
        geo.instanceCount = Math.ceil(T.asteroids / SHAPES);
        const mesh = new THREE.Mesh(geo, rockMat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 10;
        group.add(mesh);
        rocks.push({ mesh, base });
    }

    // Moons, framed right of the Experience heading in the approach shot
    const moonDefs = [
        { at: [16, 9, 1250], r: 34, albedo: [0.56, 0.37, 0.17], haze: [1.0, 0.62, 0.28], hazeAmt: 0.85, ice: 0 },
        { at: [27, -8, 1500], r: 15, albedo: [0.82, 0.85, 0.9], haze: [0.6, 0.8, 1.0], hazeAmt: 0.12, ice: 1 },
    ];
    const moonGeo = new THREE.SphereGeometry(1, 64, 32);
    for (const m of moonDefs) {
        const mesh = new THREE.Mesh(moonGeo, new THREE.ShaderMaterial({
            uniforms: {
                uNoise: { value: ctx.noise },
                uSunW: { value: sunW },
                uSunColor: { value: sunColor },
                uAlbedo: { value: new THREE.Vector3(...m.albedo) },
                uHaze: { value: new THREE.Vector3(...m.haze) },
                uHazeAmt: { value: m.hazeAmt },
                uIce: { value: m.ice },
            },
            vertexShader: MOON_VERT,
            fragmentShader: MOON_FRAG,
        }));
        mesh.scale.setScalar(m.r);
        mesh.position.copy(group.worldToLocal(new THREE.Vector3(...viewPoint(2.0, ...m.at))));
        mesh.renderOrder = 10;
        group.add(mesh);
    }

    return {
        group,
        update(f, presence = 1) {
            sunColor.copy(SUN).multiplyScalar(presence);
            ringUniforms.uPresence.value = presence;
            planetUniforms.uTime.value = f.t;
            rockUniforms.uTime.value = f.t;
        },
        setTier(tier) {
            rocks.forEach((r) => { r.mesh.geometry.instanceCount = Math.min(perShape, Math.ceil(tier.asteroids / SHAPES)); });
        },
        dispose() {
            bands.dispose();
            ring.dispose();
            planet.geometry.dispose();
            planet.material.dispose();
            ringGeo.dispose();
            rings.material.dispose();
            rockMat.dispose();
            moonGeo.dispose();
            rocks.forEach((r) => { r.mesh.geometry.dispose(); r.base.dispose(); });
        },
    };
}
