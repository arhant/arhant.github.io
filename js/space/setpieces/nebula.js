/* ABOUT: a volumetric emission nebula you fly into. Ray-marched at reduced
   resolution into an off-screen target and composited (premultiplied) into
   the main scene. Ridged noise gives pillars, a dust term absorbs light, the
   palette is the site's accents (Hα pink, OIII cyan, violet), and a tunnel is
   carved along the camera path so text never sits in front of dense gas. */
import * as THREE from 'three';
import { HASH, FULLSCREEN_VERT } from '../shaders/common.glsl.js';
import { ORIGINS, KEYS } from '../path-data.js';
import { makeCompositeMesh } from '../lib/bake.js';
import { createGlow, fadeGlow } from '../lib/glow.js';

const HALF = new THREE.Vector3(950, 560, 1150);

const MARCH_FRAG = /* glsl */ `
uniform sampler3D uNoise;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uCenter;
uniform vec3 uHalf;
uniform float uTime;
uniform int uSteps;
uniform float uFrame;
uniform vec3 uHa;
uniform vec3 uO3;
uniform vec3 uViolet;
uniform float uEmis;
uniform float uExt;
uniform float uDust;
uniform vec3 uStarPos[3];
uniform vec3 uStarCol[3];
uniform float uStarR[3];
uniform vec3 uPathA;
uniform vec3 uPathB;
uniform float uTunnel;
varying vec2 vUv;
${HASH}
float segDist(vec3 p, vec3 a, vec3 b) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}
void main() {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 v = uInvProj * vec4(ndc, 1.0, 1.0);
    v /= v.w;
    vec3 rd = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
    vec3 ro = uCamPos;
    vec3 inv = 1.0 / rd;
    vec3 t0 = (uCenter - uHalf - ro) * inv;
    vec3 t1 = (uCenter + uHalf - ro) * inv;
    vec3 tsm = min(t0, t1);
    vec3 tbg = max(t0, t1);
    float tN = max(max(max(tsm.x, tsm.y), tsm.z), 2.0);
    float tF = min(min(tbg.x, tbg.y), tbg.z);
    if (tF <= tN) { gl_FragColor = vec4(0.0); return; }

    float dt = (tF - tN) / float(uSteps);
    float t = tN + dt * ign(gl_FragCoord.xy + uFrame * 5.588238);
    vec3 acc = vec3(0.0);
    float T = 1.0;
    for (int i = 0; i < 64; i++) {
        if (i >= uSteps) break;
        vec3 p = ro + rd * t;
        vec3 lp = (p - uCenter) / uHalf;
        float env = 1.0 - smoothstep(0.45, 1.0, length(lp * vec3(0.95, 1.2, 0.9)));
        if (env > 0.0) {
            vec4 n = texture(uNoise, lp * 0.5 + vec3(0.0, 0.0, uTime * 0.003));
            vec4 n2 = texture(uNoise, lp * 1.45 + vec3(0.31, uTime * 0.002, 0.0));
            float tunnel = mix(0.3, 1.0, smoothstep(uTunnel * 0.3, uTunnel, segDist(p, uPathA, uPathB)));
            float n3 = texture(uNoise, lp * 3.7 + vec3(0.7, 0.2, uTime * 0.004)).a;
            float dens = max(n.r * 0.5 + n2.a * 0.62 + n3 * 0.22 - 0.66, 0.0) * 1.25 * env * tunnel;
            float dust = smoothstep(0.55, 0.85, n2.g) * env * tunnel;
            if (dens + dust > 0.001) {
                vec3 em = mix(uHa, uO3, smoothstep(0.35, 0.65, n.g)) * (0.55 + 0.9 * n3);
                em = mix(em, uViolet, smoothstep(0.55, 0.85, n2.r) * 0.6);
                vec3 sl = vec3(0.0);
                for (int k = 0; k < 3; k++) {
                    vec3 d = p - uStarPos[k];
                    sl += uStarCol[k] / (1.0 + dot(d, d) / (uStarR[k] * uStarR[k]));
                }
                acc += T * (em * uEmis + sl) * dens * dt;
                T *= exp(-(dens * uExt + dust * uDust) * dt);
                if (T < 0.03) break;
            }
        }
        t += dt;
    }
    gl_FragColor = vec4(acc, 1.0 - T);
}
`;

/* The march jitters each pixel's start with a fixed interleaved-gradient pattern. Four
   bilinear taps half a low-res texel apart form a 3x3 tent over the target, which averages
   that pattern into smooth gas. Presence scales the premultiplied result (rgb and alpha),
   so the nebula fades to the sky behind it rather than to black. */
const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tNebula;
uniform vec2 uTexel;
uniform float uPresence;
varying vec2 vUv;
void main() {
    vec2 o = 0.5 * uTexel;
    vec4 c = texture2D(tNebula, vUv + vec2(-o.x, -o.y)) + texture2D(tNebula, vUv + vec2(o.x, -o.y))
           + texture2D(tNebula, vUv + vec2(-o.x, o.y)) + texture2D(tNebula, vUv + vec2(o.x, o.y));
    gl_FragColor = c * 0.25;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor *= uPresence;
}
`;

export async function create(ctx) {
    const { renderer, T, noise, halfFloat } = ctx;
    const center = new THREE.Vector3(...ORIGINS.nebula);
    const group = new THREE.Group();

    // Tunnel follows the About keyframes
    const keys = KEYS.filter((k) => k.rel === 'nebula');
    const pathA = new THREE.Vector3(...keys[0].pos).add(center);
    const pathB = new THREE.Vector3(...keys[keys.length - 1].look).add(center).add(new THREE.Vector3(0, 0, -700));

    const stars = [
        { p: [-320, 160, -320], c: [0.65, 0.78, 1.0], r: 170 },
        { p: [420, -210, 80], c: [1.0, 0.82, 0.7], r: 140 },
        { p: [-120, -260, -820], c: [0.75, 0.9, 1.0], r: 200 },
    ];

    const target = new THREE.WebGLRenderTarget(1, 1, {
        type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        depthBuffer: false,
    });
    const marchUniforms = {
        uNoise: { value: noise },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uCenter: { value: center },
        uHalf: { value: HALF },
        uTime: { value: 0 },
        uSteps: { value: T.nebulaSteps },
        uFrame: { value: 0 },
        uHa: { value: new THREE.Color('#ff7bab') },
        uO3: { value: new THREE.Color('#38d9ff') },
        uViolet: { value: new THREE.Color('#7b73ff') },
        uEmis: { value: 0.0028 },
        uExt: { value: 0.006 },
        uDust: { value: 0.0045 },
        uStarPos: { value: stars.map((s) => new THREE.Vector3(...s.p).add(center)) },
        uStarCol: { value: stars.map((s) => new THREE.Vector3(...s.c).multiplyScalar(0.005)) },
        uStarR: { value: stars.map((s) => s.r) },
        uPathA: { value: pathA },
        uPathB: { value: pathB },
        uTunnel: { value: 260 },
    };
    const marchMat = new THREE.ShaderMaterial({
        uniforms: marchUniforms,
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: MARCH_FRAG,
        depthTest: false,
        depthWrite: false,
    });
    const marchScene = new THREE.Scene();
    const marchQuad = makeCompositeMesh(marchMat);
    marchScene.add(marchQuad);
    const marchCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // The march draws in its own scene, which the manager's compile of the group never sees: compile
    // it here, against the target it renders into, or its long loop links inside the first frame
    // the nebula shows (a visible freeze on the first scroll out of the hero)
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const marchCompiled = renderer.compileAsync(marchScene, marchCam);
    renderer.setRenderTarget(prevTarget);
    await marchCompiled;

    const compositeUniforms = {
        tNebula: { value: target.texture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uPresence: { value: 1 },
    };
    const composite = makeCompositeMesh(new THREE.ShaderMaterial({
        uniforms: compositeUniforms,
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: COMPOSITE_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    composite.renderOrder = 25;
    group.add(composite);

    const glows = stars.map((s) => {
        const g = createGlow({ color: s.c, core: 3, halo: 0.35, size: 40 });
        g.position.set(...s.p).add(center);
        group.add(g);
        return g;
    });

    let scale = T.nebulaScale;
    let presence = 1;
    return {
        group,
        update(f, k = 1) {
            presence = k;
            marchUniforms.uTime.value = f.t;
            compositeUniforms.uPresence.value = k;
            for (const g of glows) fadeGlow(g, k);
        },
        beforeRender(renderer, camera, f) {
            // Faded out completely: skip the march (the composite multiplies the stale target by ~0)
            if (presence < 0.002) return;
            const w = Math.max(1, Math.round(f.res.x * scale));
            const h = Math.max(1, Math.round(f.res.y * scale));
            if (target.width !== w || target.height !== h) {
                target.setSize(w, h);
                compositeUniforms.uTexel.value.set(1 / w, 1 / h);
            }
            marchUniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
            marchUniforms.uCamWorld.value.copy(camera.matrixWorld);
            marchUniforms.uCamPos.value.copy(camera.position);
            const prev = renderer.getRenderTarget();
            renderer.setRenderTarget(target);
            renderer.setClearColor(0x000000, 0);
            renderer.clear(true, false, false);
            renderer.render(marchScene, marchCam);
            renderer.setClearColor(0x07071a, 1);
            renderer.setRenderTarget(prev);
        },
        setTier(tier) {
            scale = tier.nebulaScale;
            marchUniforms.uSteps.value = tier.nebulaSteps;
        },
        dispose() {
            target.dispose();
            marchMat.dispose();
            marchQuad.geometry.dispose();
            group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        },
    };
}
