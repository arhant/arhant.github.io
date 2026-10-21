/* Sky: a Milky Way band baked once into an HDR cube map (used as the scene
   background and as the light the black hole bends), with distant galaxies,
   globular clusters and two Magellanic-style dwarf galaxies baked in; far
   stars drawn as sharp points at infinity with blackbody colours; and the
   occasional meteor. Always loaded. */
import * as THREE from 'three';
import { bakeCube } from '../lib/bake.js';
import { SIMPLEX } from '../shaders/common.glsl.js';
import { tempToColor, sampleStarTemp } from '../lib/color.js';
import { mulberry32, gaussian } from '../lib/math.js';
import { viewDir } from '../path-data.js';

const MAX_OBJ = 48;

const SKY_FRAG = /* glsl */ `
uniform vec3 uNorth;
uniform vec3 uCenter;
uniform vec4 uObj[${MAX_OBJ}];   // xyz direction, w angular size (radians)
uniform vec4 uObjB[${MAX_OBJ}];  // x axis ratio, y angle, z type (0 galaxy, 1 globular, 2 dwarf), w brightness
uniform int uObjCount;
varying vec3 vDir;
${SIMPLEX}
void main() {
    vec3 d = normalize(vDir);
    float b = asin(clamp(dot(d, uNorth), -1.0, 1.0));
    vec3 w = vec3(fbm3(d * 2.0 + 1.0, 3), fbm3(d * 2.0 + 7.0, 3), fbm3(d * 2.0 + 13.0, 3)) * 0.25;

    float width = 0.11 + 0.035 * fbm3(d * 1.5 + 3.3, 3);
    float band = exp(-abs(b + 0.03 * fbm3(d * 3.0, 3)) / width);
    float clouds = 0.55 + 0.45 * fbm3(d * 4.0 + w, 5);
    float grain = 0.65 + 0.35 * smoothstep(-0.3, 0.6, fbm3(d * 22.0, 3));

    float cg = acos(clamp(dot(d, uCenter), -1.0, 1.0));
    float bulge = exp(-pow(cg / 0.34, 2.0)) * exp(-abs(b) / 0.15);

    float lanes = ridged3(d * 5.0 + w * 2.0, 4);
    float dust = smoothstep(0.32, 0.75, lanes) * exp(-abs(b) / 0.05);

    vec3 disk = vec3(0.60, 0.65, 0.82);
    vec3 core = vec3(0.98, 0.74, 0.50);
    vec3 col = disk * band * clouds * grain * 0.065 + core * bulge * 0.15;
    col *= 1.0 - 0.82 * dust;

    float ha = smoothstep(0.55, 0.85, fbm3(d * 5.0 + 40.0, 4)) * band;
    float o3 = smoothstep(0.6, 0.9, fbm3(d * 4.0 + 90.0, 4)) * exp(-abs(b) / 0.3);
    col += vec3(1.0, 0.36, 0.55) * ha * 0.025 + vec3(0.2, 0.75, 0.95) * o3 * 0.014;
    col += vec3(0.010, 0.010, 0.020) * (0.6 + 0.4 * fbm3(d * 1.2, 2));

    // Deep-sky objects
    for (int i = 0; i < ${MAX_OBJ}; i++) {
        if (i >= uObjCount) break;
        vec4 a = uObj[i];
        if (dot(d, a.xyz) < cos(a.w * 5.0)) continue;
        vec3 t1 = normalize(cross(a.xyz, abs(a.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec3 t2 = cross(a.xyz, t1);
        vec2 q = vec2(dot(d, t1), dot(d, t2)) / a.w;
        vec4 o = uObjB[i];
        float cs = cos(o.y), sn = sin(o.y);
        q = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
        q.y /= o.x;
        float r = length(q);
        if (o.z < 0.5) {
            float th = atan(q.y, q.x);
            float arms = 0.55 + 0.45 * cos(2.0 * (th - log(max(r, 0.05)) * 2.2));
            col += vec3(1.0, 0.87, 0.72) * (exp(-r * 11.0) * 1.3 + exp(-r * 3.4) * 0.32 * arms) * o.w;
        } else if (o.z < 1.5) {
            float grainy = 0.7 + 0.3 * snoise(d * 900.0);
            col += vec3(1.0, 0.9, 0.78) * exp(-r * r * 5.0) * grainy * o.w;
        } else {
            float clump = smoothstep(-0.1, 0.6, fbm3(d * 55.0 + a.xyz * 9.0, 4));
            float knots = smoothstep(0.5, 0.8, fbm3(d * 130.0 + 3.0, 3));
            col += (vec3(0.78, 0.82, 1.0) * clump + vec3(1.0, 0.45, 0.6) * knots * 0.7) * exp(-r * r * 1.7) * o.w;
        }
    }
    gl_FragColor = vec4(col, 1.0);
}
`;

const STAR_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aMag;
attribute float aPhase;
uniform float uDpr;
uniform float uTime;
uniform float uTwinkle;
varying vec3 vCol;
void main() {
    vec4 vp = viewMatrix * vec4(position, 0.0);
    gl_Position = projectionMatrix * vec4(vp.xyz * 1000.0, 1.0);
    gl_Position.z = gl_Position.w * 0.99999;
    float tw = 1.0 + uTwinkle * 0.05 * sin(uTime * (1.3 + aPhase * 2.0) + aPhase * 40.0);
    vCol = aColor * aMag * tw;
    gl_PointSize = (1.3 + 2.4 * sqrt(aMag)) * uDpr;
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c) * 4.0;
    float a = (exp(-r2 * 6.0) + 0.08 * exp(-r2 * 1.2)) * smoothstep(0.5, 0.3, length(c));
    gl_FragColor = vec4(vCol * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

// Meteors: a short arc between two sky directions, drawn at infinity with a fading tail
const METEOR_VERT = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform float uT;
uniform float uTail;
uniform vec2 uRes;
uniform float uWidth;
varying vec2 vUv;
vec3 dirAt(float t) { return normalize(mix(uA, uB, t)); }
vec4 clipOf(vec3 d) { return projectionMatrix * vec4((viewMatrix * vec4(d, 0.0)).xyz * 1000.0, 1.0); }
void main() {
    float t0 = max(uT - uTail, 0.0);
    vec4 c = clipOf(dirAt(mix(t0, uT, position.x + 0.5)));
    vec4 a = clipOf(dirAt(t0));
    vec4 b = clipOf(dirAt(uT));
    vec2 along = normalize((b.xy / b.w - a.xy / a.w) * uRes + 1e-5);
    vec2 perp = vec2(-along.y, along.x);
    c.xy += perp * position.y * uWidth / uRes * 2.0 * c.w;
    c.z = c.w * 0.99998;
    gl_Position = c;
    vUv = position.xy + 0.5;
}
`;

const METEOR_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
    float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
    float a = pow(vUv.x, 2.2) * across * across * uAlpha;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export function galacticFrame() {
    const north = new THREE.Vector3(0.55, 0.8, 0.2).normalize();
    const center = new THREE.Vector3(-0.35, 0.05, -1);
    center.addScaledVector(north, -center.dot(north)).normalize();
    const third = new THREE.Vector3().crossVectors(north, center).normalize();
    return { north, center, third };
}

/* Deep-sky catalogue: a few objects framed in the hero/contact shots, the rest scattered
   away from the galactic plane (galaxies) or around the bulge (globular clusters) */
function deepSky(frame) {
    const rand = mulberry32(31337);
    const obj = [];
    const objB = [];
    const add = (dir, size, ratio, angle, type, bright) => {
        obj.push(new THREE.Vector4(dir.x, dir.y, dir.z, size));
        objB.push(new THREE.Vector4(ratio, angle, type, bright));
    };
    const fromView = (yaw, pitch) => new THREE.Vector3(...viewDir(0.0, yaw, pitch));

    // Magellanic-style dwarfs and a few galaxies in the hero's upper sky
    add(fromView(-24, 23), 0.05, 0.62, 0.5, 2, 0.06);
    add(fromView(-10, 31), 0.03, 0.55, -0.3, 2, 0.05);
    add(fromView(16, 27), 0.014, 0.4, 0.9, 0, 0.13);
    add(fromView(-34, 9), 0.009, 0.75, 0.2, 0, 0.1);
    add(fromView(31, 34), 0.007, 0.3, -0.6, 0, 0.09);

    const v = new THREE.Vector3();
    while (obj.length < 34) {
        const z = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(1 - z * z);
        v.set(r * Math.cos(a), z, r * Math.sin(a));
        if (Math.abs(v.dot(frame.north)) < 0.28) continue; // zone of avoidance
        const big = rand() < 0.15;
        add(v.clone(), big ? 0.011 + rand() * 0.01 : 0.004 + rand() * 0.006, 0.25 + rand() * 0.75, rand() * 6.28, 0, 0.04 + rand() * 0.1);
    }
    while (obj.length < 46) {
        v.copy(frame.center)
            .addScaledVector(frame.north, gaussian(rand) * 0.3)
            .addScaledVector(frame.third, gaussian(rand) * 0.35)
            .normalize();
        add(v.clone(), 0.002 + rand() * 0.003, 1, 0, 1, 0.08 + rand() * 0.12);
    }
    return { obj, objB };
}

export function createSky(ctx) {
    const { renderer, T, scene } = ctx;
    const frame = galacticFrame();
    const { obj, objB } = deepSky(frame);
    const count = obj.length;
    while (obj.length < MAX_OBJ) { obj.push(new THREE.Vector4()); objB.push(new THREE.Vector4()); }

    const cube = bakeCube(renderer, {
        size: T.skyCube,
        fragment: SKY_FRAG,
        type: ctx.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        uniforms: {
            uNorth: { value: frame.north },
            uCenter: { value: frame.center },
            uObj: { value: obj },
            uObjB: { value: objB },
            uObjCount: { value: count },
        },
    });
    scene.background = cube.texture;
    scene.backgroundIntensity = 1;

    // Far stars: 60% concentrated toward the galactic plane, 40% isotropic
    const n = T.farStars;
    const rand = mulberry32(1337);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const mag = new Float32Array(n);
    const phase = new Float32Array(n);
    const v = new THREE.Vector3();
    const c = [0, 0, 0];
    for (let i = 0; i < n; i++) {
        if (rand() < 0.6) {
            const lat = gaussian(rand) * 0.17;
            const lon = rand() * Math.PI * 2;
            v.copy(frame.center).multiplyScalar(Math.cos(lat) * Math.cos(lon))
                .addScaledVector(frame.third, Math.cos(lat) * Math.sin(lon))
                .addScaledVector(frame.north, Math.sin(lat));
        } else {
            const z = rand() * 2 - 1;
            const a = rand() * Math.PI * 2;
            const r = Math.sqrt(1 - z * z);
            v.set(r * Math.cos(a), z, r * Math.sin(a));
        }
        v.normalize();
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        tempToColor(sampleStarTemp(rand), c);
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
        // Kept under the bloom threshold: a bloomed 1-2 px point renders as a square halo
        mag[i] = 0.04 + 0.86 * Math.pow(rand(), 6);
        phase[i] = rand();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const mat = new THREE.ShaderMaterial({
        uniforms: { uDpr: { value: 1 }, uTime: { value: 0 }, uTwinkle: { value: 1 } },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(geo, mat);
    stars.frustumCulled = false;
    stars.renderOrder = -5;
    scene.add(stars);

    // Meteor pool
    const meteorGeo = new THREE.PlaneGeometry(1, 1);
    const meteors = [];
    for (let i = 0; i < 3; i++) {
        const uniforms = {
            uA: { value: new THREE.Vector3() },
            uB: { value: new THREE.Vector3() },
            uT: { value: 0 },
            uTail: { value: 0.35 },
            uRes: { value: new THREE.Vector2(1, 1) },
            uWidth: { value: 1.6 },
            uAlpha: { value: 0 },
            uColor: { value: new THREE.Vector3(0.85, 1.0, 0.9) },
        };
        const mesh = new THREE.Mesh(meteorGeo, new THREE.ShaderMaterial({
            uniforms,
            vertexShader: METEOR_VERT,
            fragmentShader: METEOR_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }));
        mesh.frustumCulled = false;
        mesh.renderOrder = -4;
        mesh.visible = false;
        scene.add(mesh);
        meteors.push({ mesh, uniforms, age: 0, life: 1 });
    }
    const mrand = mulberry32(99);
    let nextMeteor = 3;
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();

    function spawn(m, camera) {
        camera.getWorldDirection(fwd);
        right.crossVectors(fwd, camera.up).normalize();
        up.crossVectors(right, fwd).normalize();
        const sx = (mrand() - 0.5) * 1.1;
        const sy = 0.12 + mrand() * 0.4;
        const dir = mrand() < 0.5 ? -1 : 1;
        m.uniforms.uA.value.copy(fwd).addScaledVector(right, sx).addScaledVector(up, sy).normalize();
        m.uniforms.uB.value.copy(m.uniforms.uA.value)
            .addScaledVector(right, dir * (0.16 + mrand() * 0.16))
            .addScaledVector(up, -(0.06 + mrand() * 0.1))
            .normalize();
        const warm = mrand();
        m.uniforms.uColor.value.set(0.8 + 0.2 * warm, 0.95, 0.85 + 0.1 * (1 - warm));
        m.age = 0;
        m.life = 0.6 + mrand() * 0.5;
        m.mesh.visible = true;
    }

    return {
        cube: cube.texture,
        frame,
        update(f) {
            mat.uniforms.uTime.value = f.t;
            mat.uniforms.uDpr.value = f.dpr;

            nextMeteor -= f.dt;
            if (nextMeteor <= 0) {
                const free = meteors.find((m) => !m.mesh.visible);
                if (free) spawn(free, f.camera);
                nextMeteor = 3.5 + mrand() * 6;
            }
            for (const m of meteors) {
                if (!m.mesh.visible) continue;
                m.age += f.dt;
                const t = m.age / m.life;
                if (t >= 1.25) { m.mesh.visible = false; continue; }
                m.uniforms.uT.value = Math.min(1, t);
                m.uniforms.uAlpha.value = 0.85 * Math.min(1, t * 6) * (t > 1 ? 1 - (t - 1) / 0.25 : 1);
                m.uniforms.uRes.value.copy(f.res);
                m.uniforms.uWidth.value = 1.6 * f.dpr;
            }
        },
        dispose() {
            cube.dispose();
            geo.dispose();
            mat.dispose();
            scene.remove(stars);
            meteors.forEach((m) => { scene.remove(m.mesh); m.mesh.material.dispose(); });
            meteorGeo.dispose();
        },
    };
}
