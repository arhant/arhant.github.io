/* Scene runtime: renderer + lifecycle, quality probe and governor, set-piece
   manager, and the frame loop. The camera follows window.Journey (written by
   main.js); nothing here measures the page except the readability rects. */
import * as THREE from 'three';
import { EV, emit, on } from './events.js';
import { TIERS, TIER_ORDER, guessTier, loadSavedTier, saveTier, Governor } from './quality.js';
import { CameraRig } from './camera-rig.js';
import { Plunge } from './plunge.js';
import { Post } from './post.js';
import { Readability } from './readability.js';
import { bakeNoise3D } from './lib/bake.js';
import { nextFrame, damp } from './lib/math.js';
import { createSky } from './setpieces/sky.js';
import { createStars } from './setpieces/stars.js';
import { REGISTRY } from './setpieces/registry.js';

const LOAD_AHEAD = 1.0;

export async function run({ canvas, forced, renderer: rendererString, halfFloat }) {
    const J = window.Journey || { index: 0, progress: 0 };
    let tierName = forced || loadSavedTier(rendererString) || guessTier(rendererString, {
        deviceMemory: navigator.deviceMemory,
        saveData: navigator.connection && navigator.connection.saveData,
    });
    if (!halfFloat) tierName = 'low';
    let tier = TIERS[tierName];

    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        stencil: false,
        powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x07071a, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 70000);
    const rig = new CameraRig(camera);
    const plunge = new Plunge(camera, (type, detail) => {
        if (type === 'tick') emit(EV.PLUNGE_STATE, detail);
        else if (type === 'end') emit(EV.PLUNGE_END, {});
        else if (type === 'done') emit(EV.PLUNGE_DONE, {});
    });
    const post = new Post(renderer, scene, camera, tier, halfFloat);
    const readability = new Readability();

    const frame = {
        dt: 0, t: 0, s: 0, camera, fade: 0, flare: new THREE.Vector3(), plunge: plunge.params,
        velocity: rig.velocity, speed: 0, warp: 0,
        dpr: 1, res: new THREE.Vector2(1, 1), grade: rig.grade,
    };

    let scale = 1;
    function resize() {
        const w = innerWidth;
        const h = innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        let dpr = Math.min(window.devicePixelRatio || 1, tier.dpr);
        if (tier.name === 'medium' && w * h * dpr * dpr > 2.5e6) dpr = Math.min(dpr, 1);
        post.setSize(w, h, dpr * scale);
        renderer.getDrawingBufferSize(frame.res);
        frame.dpr = frame.res.x / w;
    }
    resize();
    let resizeTimer = 0;
    addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { resize(); governor.quiet(1500); }, 150);
    }, { passive: true });

    // Shared resources
    const noise = await bakeNoise3D(renderer, tier.noise);
    const ctx = { renderer, scene, camera, T: tier, noise: noise.texture, halfFloat };
    ctx.sky = createSky(ctx);
    const stars = createStars(ctx);

    /* ---------- Set-piece manager ---------- */
    const pieces = REGISTRY.map((r) => ({ ...r, state: 'idle', obj: null, promise: null, visible: false }));
    const distance = (p, s) => (s < p.range[0] ? p.range[0] - s : s > p.range[1] ? s - p.range[1] : 0);

    function ensure(piece) {
        if (piece.promise) return piece.promise;
        piece.state = 'loading';
        piece.promise = (async () => {
            try {
                const mod = await piece.load();
                const obj = await mod.create(ctx);
                if (obj.group) {
                    scene.add(obj.group);
                    obj.group.visible = true;
                    await renderer.compileAsync(obj.group, camera, scene);
                    obj.group.visible = false;
                }
                piece.obj = obj;
                piece.state = 'ready';
            } catch (err) {
                console.warn(`[space] set-piece ${piece.id} failed`, err);
                piece.state = 'failed';
            }
        })();
        return piece.promise;
    }

    function setVisible(piece, v) {
        if (piece.visible === v || !piece.obj) return;
        piece.visible = v;
        if (piece.obj.group) piece.obj.group.visible = v;
        if (piece.obj.setVisible) piece.obj.setVisible(v);
        if (v) governor.quiet(1000);
    }

    function applyTier(name) {
        tierName = name;
        tier = TIERS[name];
        ctx.T = tier;
        post.setTier(tier);
        stars.setTier(tier);
        pieces.forEach((p) => p.obj && p.obj.setTier && p.obj.setTier(tier));
        scale = 1;
        resize();
        document.documentElement.dataset.spaceTier = name;
        emit(EV.TIER, { tier: name, scale });
        saveTier(name, rendererString);
    }

    /* ---------- Frame ---------- */
    function renderFrame(dt) {
        frame.dt = dt;
        frame.t += dt;
        // The plunge owns the camera while active; otherwise the section-anchored rig does
        if (plunge.active) plunge.update(dt, frame, rig, J, frame.t);
        else {
            rig.update(dt, frame.t, J);
            frame.speed = rig.speed;
        }
        const s = rig.s;
        frame.s = s;
        frame.warp = rig.warp;
        const fadeTo = plunge.active ? 1 : fadeTarget;
        frame.fade = damp(frame.fade, fadeTo, fadeTo > frame.fade ? 12 : 4, dt);
        frame.flare.z = 0;

        for (const p of pieces) {
            const d = distance(p, s);
            if (d <= LOAD_AHEAD && p.state === 'idle') ensure(p);
            setVisible(p, d === 0 && p.state === 'ready');
            if (p.visible) p.obj.update(frame);
        }
        ctx.sky.update(frame);
        stars.update(frame);
        for (const p of pieces) if (p.visible && p.obj.beforeRender) p.obj.beforeRender(renderer, camera, frame);
        readability.update(post.uniforms, frame.dpr, frame.dt);
        post.render(frame);
    }

    const governor = new Governor({
        onScale: (k) => {
            scale = k;
            resize();
            emit(EV.TIER, { tier: tierName, scale });
        },
        onTier: (name) => applyTier(name),
        onGiveUp: () => fail('perf'),
    });
    governor.tier = tierName;

    let raf = 0;
    let running = false;
    let last = performance.now();
    let lastInput = performance.now();
    let probe = null;
    let mode = document.documentElement.dataset.motion === 'lite' ? 'lite' : 'full';

    let lastRaf = performance.now();
    let rafInterval = 1000 / 60;
    // The interval we can actually hit: the first display refresh at or after the target
    const expectedInterval = (target) => Math.max(target, Math.ceil((target - 2) / rafInterval) * rafInterval);

    function tick(now) {
        raf = requestAnimationFrame(tick);
        const raw = now - lastRaf;
        lastRaf = now;
        if (raw > 0 && raw < 100) rafInterval += (raw - rafInterval) * 0.1;
        const idle = now - lastInput > 8000 && rig.warp < 0.01 && !probe && !plunge.active;
        const interval = idle ? 1000 / 30 : 1000 / 60;
        const elapsed = now - last;
        if (elapsed < interval - 2) return;
        last = now;
        renderFrame(Math.min(elapsed / 1000, 0.05));
        if (probe) probe(elapsed);
        else if (!plunge.active) governor.sample(elapsed, now, expectedInterval(interval));
    }

    function startLoop() {
        if (running || failed || document.hidden || mode === 'lite') return;
        running = true;
        last = lastRaf = performance.now();
        raf = requestAnimationFrame(tick);
        governor.quiet(1000);
    }
    function stopLoop() {
        running = false;
        cancelAnimationFrame(raf);
    }

    const markInput = () => { lastInput = performance.now(); };
    addEventListener('scroll', markInput, { passive: true });
    addEventListener('pointermove', markInput, { passive: true });
    addEventListener('keydown', markInput);
    addEventListener('touchstart', markInput, { passive: true });

    document.addEventListener('visibilitychange', () => (document.hidden ? stopLoop() : startLoop()));
    addEventListener('pagehide', stopLoop);
    addEventListener('pageshow', startLoop);

    let fadeTarget = 0;
    // Every pixel runs the full geodesic trace during the plunge: below the high tier, render it at 75%
    let plungeScaled = false;
    function setPlungeScale(on) {
        if (on === plungeScaled || (on && tierName === 'high')) return;
        plungeScaled = on;
        scale = on ? Math.min(scale, 0.75) : governor.scale;
        resize();
    }
    on(EV.PLUNGE, (e) => {
        if (e.detail && e.detail.active) {
            plunge.start();
            setPlungeScale(true);
        } else {
            plunge.abort();
        }
    });
    on(EV.PLUNGE_DONE, () => setPlungeScale(false));
    on(EV.WARP, (e) => {
        const active = !!(e.detail && e.detail.active);
        rig.setWarp(active);
        // Only velocity warps fade the page content (nav jumps and back-to-top keep it visible)
        fadeTarget = active && e.detail.reason === 'velocity' ? 1 : 0;
    });
    on(EV.FOCUS, (e) => rig.setFocus(e.detail && e.detail.id));
    on(EV.MOTION, (e) => {
        mode = e.detail && e.detail.mode === 'lite' ? 'lite' : 'full';
        if (mode === 'lite') {
            stopLoop();
            if (plunge.active) plunge.reset();
            return;
        }
        // Coming back after the governor gave up: retry at the lowest tier instead of staying dead
        if (failed && failReason === 'perf') {
            failed = false;
            failReason = null;
            applyTier('low');
            governor.tier = 'low';
            governor.quiet(4000);
            emit(EV.READY, { tier: 'low' });
        }
        startLoop();
    });

    let failed = false;
    let failReason = null;
    function fail(reason) {
        if (failed) return;
        failed = true;
        failReason = reason;
        stopLoop();
        emit(EV.FALLBACK, { reason });
    }
    canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        fail('context-lost');
    });

    /* ---------- Boot: load what's in view, probe frame times, then reveal ---------- */
    rig.snap(J);
    const s0 = rig.s;
    const nearFirst = [...pieces].sort((a, b) => distance(a, s0) - distance(b, s0));
    await Promise.all(nearFirst.filter((p) => distance(p, s0) <= 0.35).map(ensure));

    async function runProbe() {
        const samples = [];
        await new Promise((resolve) => {
            probe = (ms) => {
                samples.push(ms);
                if (samples.length >= 30) resolve();
            };
            startLoop();
        });
        probe = null;
        samples.sort((a, b) => a - b);
        return samples[Math.floor(samples.length / 2)];
    }

    if (mode === 'full' && !document.hidden) {
        await nextFrame();
        for (let attempt = 0; attempt < 2; attempt++) {
            const median = await runProbe();
            if (forced || median <= expectedInterval(1000 / 60) * 1.25) break;
            const idx = TIER_ORDER.indexOf(tierName);
            if (idx === 0) break;
            applyTier(TIER_ORDER[idx - 1]);
            governor.tier = tierName;
        }
    }
    if (failed) return;

    document.documentElement.dataset.spaceTier = tierName;
    if (!forced) saveTier(tierName, rendererString);
    window.SpaceScene = {
        get tier() { return tierName; },
        get mode() { return mode; },
        setQuality(name) { if (TIERS[name]) applyTier(name); },
        pause: stopLoop,
        resume: startLoop,
        warp: (active) => rig.setWarp(active),
        setTime: (t) => { frame.t = t; },
        getState: () => ({
            running, tier: tierName, scale, s: rig.s,
            pieces: pieces.map((p) => `${p.id}:${p.state}${p.visible ? '*' : ''}`),
            calls: renderer.info.render.calls,
            programs: renderer.info.programs ? renderer.info.programs.length : 0,
        }),
    };

    emit(EV.READY, { tier: tierName });
    startLoop();

    // Everything else loads in idle time, nearest first
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 300));
    for (const p of nearFirst) {
        if (p.state !== 'idle') continue;
        await new Promise((resolve) => idle(resolve, { timeout: 3000 }));
        await ensure(p);
    }
}
