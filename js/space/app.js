/* Scene runtime: renderer + lifecycle, quality probe and governor, set-piece
   manager, and the frame loop. The camera follows window.Journey (written by
   main.js); nothing here measures the page except the readability rects.
   With ?poster=<s> it renders one still instead (see renderPoster). */
import * as THREE from 'three';
import { EV, emit, on } from './events.js';
import { TIERS, TIER_ORDER, guessTier, bufferLimits, loadSavedTier, saveTier, clearSavedTier, Governor } from './quality.js';
import { CameraRig } from './camera-rig.js';
import { Plunge } from './plunge.js';
import { Post } from './post.js';
import { Readability } from './readability.js';
import { bakeNoise3D } from './lib/bake.js';
import { nextFrame, damp, clamp, smoothstep } from './lib/math.js';
import { createSkyAsync } from './setpieces/sky.js';
import { createStars } from './setpieces/stars.js';
import { REGISTRY } from './setpieces/registry.js';

const LOAD_AHEAD = 1.0;
const EDGE = 0.12;         // set pieces fade over this much section space at each end of their range
const READY_FADE = 0.5;    // s: a piece that finishes loading once the loop runs fades in over this
const IDLE_AFTER = 8000;   // ms without input before frames drop to ~30 fps (and touch screens rest)
const IGNITE_FROM = 0.3;   // first reveal: exposure eases from here to 1 ...
const IGNITE_TIME = 1.0;   // ... over this many seconds; any input finishes it within ~0.2 s
const LOOK_STEP = 0.15;    // free look: arrow-key nudge of the look target
const LOOK_KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// Let the browser paint and handle input between long synchronous steps (bakes, shader compiles)
const yieldTask = () => (window.scheduler && scheduler.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));

export async function run({ canvas, forced, poster = null, renderer: rendererString, halfFloat }) {
    const root = document.documentElement;
    const J = window.Journey || { index: 0, progress: 0 };
    const saved = forced ? null : loadSavedTier(rendererString);
    let tierName = forced || (saved && saved.tier) || guessTier(rendererString, {
        deviceMemory: navigator.deviceMemory,
        saveData: navigator.connection && navigator.connection.saveData,
    });
    if (!halfFloat) tierName = 'low';
    let tier = TIERS[tierName];
    // ?quality and the visitor's own choice are kept even if the boot probe runs slow
    const pinned = !!forced || !!(saved && saved.reason === 'user');

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
    const postKind = post.direct ? 'direct' : 'composer';
    const readability = new Readability();

    const frame = {
        dt: 0, t: poster ? poster.t : 0, s: 0, camera, fade: poster ? 1 : 0, flare: new THREE.Vector3(), plunge: plunge.params,
        velocity: rig.velocity, speed: 0, warp: 0,
        dpr: 1, res: new THREE.Vector2(1, 1), grade: rig.grade,
        still: !!poster, ignite: poster ? 1 : IGNITE_FROM, contact: null,
    };

    let scale = 1;
    function resize() {
        const w = innerWidth;
        const h = innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        // A poster renders at exactly the window size; otherwise the tier's dpr cap and pixel budget apply
        const limit = bufferLimits(tier, rendererString);
        let dpr = poster ? 1 : Math.min(window.devicePixelRatio || 1, limit.dpr);
        if (!poster && w * h * dpr * dpr > limit.pixels) dpr = Math.sqrt(limit.pixels / (w * h));
        post.setSize(w, h, dpr * scale);
        renderer.getDrawingBufferSize(frame.res);
        frame.dpr = frame.res.x / w;
    }
    resize();

    /* ---------- Loop state (declared before any listener can touch it) ---------- */
    let raf = 0;
    let running = false;
    let armed = false;       // the loop may run once the boot set is in; pieces ready after this fade in
    let booted = false;      // READY sent (or the poster rendered)
    let paused = false;      // SpaceScene.pause() (the palette); only resume() restarts
    let asleep = false;      // a touch screen resting after IDLE_AFTER; any input wakes it
    let failed = false;
    let failReason = null;
    let probe = null;
    let mode = root.dataset.motion === 'lite' ? 'lite' : 'full';
    let last = performance.now();
    let lastRaf = last;
    let lastInput = last;
    let looking = false;
    let warpActive = false;
    let glass = false;
    let fading = false;      // some set piece's presence is still easing (or loading in view)
    let igniteU = poster ? 1 : -1; // ignite progress 0..1; -1 until the first READY
    let igniteRate = 1 / IGNITE_TIME;
    let fps = 0;
    let fpsFrames = 0;
    let fpsAt = last;
    const lookAt = { x: 0, y: 0 };
    const coarse = matchMedia('(pointer: coarse)');
    const fineHover = matchMedia('(hover: hover) and (pointer: fine)');

    const governor = new Governor({
        onCadence: () => {
            cadenceCapped = true;
            pickCadence();
        },
        onScale: (k) => {
            scale = k;
            resize();
            emit(EV.TIER, { tier: tierName, scale, kind: 'scale', post: postKind });
        },
        onTier: (name) => {
            applyTier(name);
            saveTier(name, rendererString, 'governor');
        },
        onGiveUp: () => fail('perf'),
        verify: (now) => checkRate(now),
    });
    governor.tier = tierName;

    /* ---------- Cadence ----------
       Render on every Nth display refresh, so the scene moves in step with natively scrolled text.
       N = floor(17.5 ms / refresh): 60→60, 75→75, 90→90, 100→100, 120→60, 144→72, 165→82.5, 240→60.
       Touch screens, the low tier, the boot probe and a governor fallback use 60 fps or lower
       (N = ceil(15.5 ms / refresh)); idle frames run near 30 fps.
       The refresh interval is the cluster of rAF gaps at their 10th percentile, measured from the
       start of boot, before any frame of ours could slow rAF down. It locks after 30 samples and
       is re-picked only on a >10% change that isn't a whole multiple of it: rAF follows our own slow
       frames in whole refreshes, and those must stay visible to the probe and governor as slow. */
    const gaps = [];
    let gapCount = 0;
    let estimateAt = 0;
    let refreshMs = 1000 / 60;
    let cadenceCapped = false;
    const cadence = { n: 1, slow: 1, idle: 2 };

    function pickCadence() {
        const r = refreshMs;
        cadence.slow = Math.max(1, Math.ceil(15.5 / r));
        const capped = cadenceCapped || coarse.matches || tierName === 'low';
        cadence.n = capped ? cadence.slow : Math.max(1, Math.floor(17.5 / r));
        cadence.idle = Math.max(cadence.n, Math.round(33.3 / r));
        governor.fast = cadence.n * r < 16;
    }
    pickCadence();
    coarse.addEventListener('change', pickCadence);

    function sampleRefresh(gap, now) {
        if (!(gap > 3 && gap < 100)) return;
        gaps[gapCount++ % 30] = gap;
        const locked = gapCount > 30;
        if (locked ? now - estimateAt < 500 : gapCount % 10 !== 0) return;
        estimateAt = now;
        const sorted = gaps.slice().sort((a, b) => a - b);
        let i = Math.floor(sorted.length * 0.1);
        const lo = sorted[i];
        let sum = 0;
        let n = 0;
        for (; i < sorted.length && sorted[i] <= lo * 1.1; i++, n++) sum += sorted[i];
        const estimate = sum / n;
        if (locked) {
            const ratio = estimate / refreshMs;
            if (Math.abs(ratio - 1) < 0.1 || (ratio > 1.8 && Math.abs(ratio - Math.round(ratio)) < 0.12)) return;
        }
        refreshMs = estimate;
        pickCadence();
    }

    /* A display that lowers its own rate mid-session (iOS Low Power Mode caps rAF at 30 fps) looks
       exactly like slow frames: rAF gaps of a whole multiple of the locked refresh, which the
       estimate above deliberately ignores. So before the governor steps down, the loop skips a few
       ticks and times the bare rAF gaps. Clearly longer than the locked refresh, and even, means the
       display changed, not our frames: adopt the new refresh instead of giving up resolution or the tier. */
    const RATE_RECHECK = 20000; // ms before another check, after one that found nothing
    let rateCheck = null;       // {ticks, gaps} while ticks are being skipped
    let rateCheckedAt = -Infinity;

    function checkRate(now) {
        if (rateCheck) return true;
        if (now - rateCheckedAt < RATE_RECHECK) return false;
        rateCheck = { ticks: 0, gaps: [] };
        return true;
    }

    // One skipped tick of the check (no render). The first gap still carries our last frame.
    function rateCheckTick(gap, now) {
        const c = rateCheck;
        if (c.ticks++ > 0) c.gaps.push(gap);
        if (c.gaps.length < 3) return;
        rateCheck = null;
        rateCheckedAt = now;
        // A display's own cap ticks evenly; a main thread that is merely busy doesn't
        const [lo, bare, hi] = c.gaps.sort((a, b) => a - b);
        if (bare > refreshMs * 1.5 && bare < 100 && hi - lo < bare * 0.1) {
            refreshMs = bare;
            gaps.length = 0;
            gapCount = 0;
            pickCadence();
            governor.quiet(3000);
        }
    }

    // Boot-time sampler: rAF gaps while nothing of ours renders yet (it stops once the loop runs)
    function measureRefresh(now) {
        if (running || booted) return;
        sampleRefresh(now - lastRaf, now);
        lastRaf = now;
        requestAnimationFrame(measureRefresh);
    }
    if (!poster) requestAnimationFrame(measureRefresh);

    // Shared resources
    const noise = await bakeNoise3D(renderer, tier.noise);
    await yieldTask();
    const ctx = { renderer, scene, camera, T: tier, noise: noise.texture, halfFloat };
    // The sky bake runs alongside the boot set's bakes (each compiles off the main thread); only
    // frames and pieces marked `sky` in the registry read ctx.sky, and those wait for it in ensure().
    // A failure surfaces through the Promise.all at boot.
    const skyReady = createSkyAsync(ctx).then((sky) => { ctx.sky = sky; });
    skyReady.catch(() => {});
    const stars = createStars(ctx);

    /* ---------- Set-piece manager ---------- */
    const pieces = REGISTRY.map((r) => ({ ...r, state: 'idle', obj: null, promise: null, visible: false, presence: null, readyFade: 1 }));
    const distance = (p, s) => (s < p.range[0] ? p.range[0] - s : s > p.range[1] ? s - p.range[1] : 0);

    function ensure(piece) {
        if (piece.promise) return piece.promise;
        piece.state = 'loading';
        piece.promise = (async () => {
            try {
                const mod = await piece.load();
                if (piece.sky) await skyReady;
                await yieldTask();
                const obj = await mod.create(ctx);
                if (obj.group) {
                    obj.group.visible = false;
                    scene.add(obj.group);
                    await yieldTask();
                    // compile() collects the programs synchronously (lights only count while visible),
                    // so the group is hidden again before any frame could draw it without its fade.
                    // Programs are keyed on the current target's colour space: compile against the
                    // target frames are drawn into, or the first visible frame compiles a second copy.
                    const prevTarget = renderer.getRenderTarget();
                    renderer.setRenderTarget(post.composer ? post.composer.readBuffer : null);
                    obj.group.visible = true;
                    const compiled = renderer.compileAsync(obj.group, camera, scene);
                    obj.group.visible = false;
                    renderer.setRenderTarget(prevTarget);
                    await compiled;
                }
                piece.obj = obj;
                piece.readyFade = armed ? 0 : 1;
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

    /* Presence fades each piece in and out at the ends of its range (and in over READY_FADE when it
       loads late); a piece is hidden only once its presence has reached 0. Loading looks at both
       the damped camera and where it is heading, so a nav jump starts loading straight away. */
    function updatePieces(s, dt) {
        const aim = poster ? s : CameraRig.targetS(J);
        fading = false;
        for (const p of pieces) {
            if (p.state === 'idle' && Math.min(distance(p, s), distance(p, aim)) <= LOAD_AHEAD) ensure(p);
            if (p.state !== 'ready') {
                if (p.state === 'loading' && distance(p, s) === 0) fading = true; // about to fade in
                continue;
            }
            p.readyFade = Math.min(1, p.readyFade + dt / READY_FADE);
            const [r0, r1] = p.range;
            let target = smoothstep(r0, r0 + EDGE, s) * (1 - smoothstep(r1 - EDGE, r1, s)) * p.readyFade;
            // The black hole is the whole picture during the plunge, wherever s sits
            const pinnedOn = p.id === 'black-hole' && plunge.active;
            if (pinnedOn) target = 1;
            p.presence = p.presence === null || poster || pinnedOn ? target : damp(p.presence, target, 8, dt);
            if (Math.abs(p.presence - target) > 0.002 || p.readyFade < 1) fading = true;
            if (target > 0) setVisible(p, true);
            else if (p.presence < 0.002) {
                p.presence = 0;
                setVisible(p, false);
            }
            if (p.visible) p.obj.update(frame, p.presence);
        }
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
        pickCadence();
        root.dataset.spaceTier = name;
        emit(EV.TIER, { tier: name, scale, kind: 'tier', post: postKind });
    }

    /* ---------- Frame ---------- */
    // Only the plunge (until the camera starts back) and free look hide the page and lift the mask;
    // warps streak the stars and push the camera but leave the text and its mask alone
    const fadeTarget = () => ((plunge.active && plunge.state !== 'returning') || looking ? 1 : 0);

    function stepIgnite(dt) {
        if (igniteU < 0 || igniteU >= 1) return;
        igniteU = Math.min(1, igniteU + dt * igniteRate);
        const k = 1 - igniteU;
        frame.ignite = IGNITE_FROM + (1 - IGNITE_FROM) * (1 - k * k * k);
    }

    function renderFrame(dt) {
        frame.dt = dt;
        frame.t += dt;
        // Rects first, so the rig frames this frame's Contact panel
        readability.update(post.uniforms, frame.dpr, dt, frame);
        // The plunge owns the camera while active; a poster takes an exact, undamped pose;
        // otherwise the section-anchored rig does
        if (poster) {
            frame.contact = null;
            rig.pose(poster.s, frame.t, { still: true });
        } else if (plunge.active) plunge.update(dt, frame, rig, J, frame.t);
        else {
            rig.update(dt, frame.t, J, { still: frame.still, contact: frame.contact });
            frame.speed = rig.speed;
        }
        const s = rig.s;
        frame.s = s;
        frame.warp = rig.warp;
        if (!poster) {
            const fadeTo = fadeTarget();
            frame.fade = damp(frame.fade, fadeTo, fadeTo > frame.fade ? 12 : 10, dt);
            stepIgnite(dt);
        }
        frame.flare.z = 0;

        updatePieces(s, dt);
        ctx.sky.update(frame);
        stars.update(frame);
        for (const p of pieces) if (p.visible && p.obj.beforeRender) p.obj.beforeRender(renderer, camera, frame);
        post.render(frame);
        syncGlass();
    }

    /* Out-of-band frame (after a resize, which clears the canvas, even while paused or resting) */
    function renderNow() {
        const now = performance.now();
        renderFrame(Math.min(Math.max(0, now - last) / 1000, 0.05));
        last = now;
    }

    /* html[data-glass]: the scene draws a frosted Contact panel only with the composer, headroom
       (medium or high), a hovering fine pointer, and a running loop with the page at rest */
    function syncGlass() {
        const on = running && !poster && !failed && mode === 'full' && !post.direct && tierName !== 'low'
            && fineHover.matches && !plunge.active && !looking && !warpActive && rig.warp < 0.01;
        if (on === glass) return;
        glass = on;
        if (on) root.setAttribute('data-glass', '');
        else root.removeAttribute('data-glass');
        if (post.setGlass) post.setGlass(on);
    }

    /* ---------- Loop ---------- */
    function countFrame(now) {
        fpsFrames++;
        if (now - fpsAt < 500) return;
        const current = (fpsFrames * 1000) / (now - fpsAt);
        fps = fps ? fps + (current - fps) * 0.5 : current;
        fpsFrames = 0;
        fpsAt = now;
    }

    // Nothing left to animate: camera, page fade, ignite and set-piece fades have all settled
    const settled = () => !fading && igniteU >= 1 && Math.abs(frame.fade - fadeTarget()) < 0.002
        && Math.abs(rig.s - CameraRig.targetS(J)) < 1e-4;

    function tick(now) {
        raf = requestAnimationFrame(tick);
        const gap = now - lastRaf;
        sampleRefresh(gap, now);
        lastRaf = now;
        if (rateCheck) {
            rateCheckTick(gap, now);
            return;
        }
        const busy = probe || plunge.active || looking || rig.warp >= 0.01 || (igniteU >= 0 && igniteU < 1);
        const idle = !busy && now - lastInput > IDLE_AFTER;
        const n = probe ? cadence.slow : idle ? cadence.idle : cadence.n;
        const elapsed = now - last;
        // Half a refresh of tolerance, so timestamp jitter never costs a whole extra refresh
        if (elapsed < (n - 0.5) * refreshMs) return;
        last = now;
        countFrame(now);
        renderFrame(Math.min(elapsed / 1000, 0.05));
        const expected = n * refreshMs;
        if (probe) probe(elapsed);
        else if (!plunge.active) governor.sample(elapsed, now, expected);
        else if (plungeScaled) plungeFrameTime(elapsed, expected);
        // Phones rest once nothing moves: the frame just drawn stays on screen until the next input.
        // So does every screen once the fall has ended in a fully black frame (the end card is
        // CSS); input or the return wakes the loop.
        if ((idle && coarse.matches && settled()) || (plunge.state === 'ended' && plunge.params.blackout >= 1)) {
            stopLoop();
            asleep = true;
        }
    }

    function startLoop() {
        if (running || !armed || paused || poster || failed || document.hidden || mode === 'lite') return;
        running = true;
        asleep = false;
        rateCheck = null;
        last = lastRaf = fpsAt = performance.now();
        fpsFrames = 0;
        raf = requestAnimationFrame(tick);
        governor.quiet(1000);
    }
    function stopLoop() {
        running = false;
        cancelAnimationFrame(raf);
        syncGlass();
    }
    function wake() {
        if (asleep) startLoop();
    }

    let resizeTimer = 0;
    addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resize();
            governor.quiet(1500);
            if (!booted) return;
            // setSize cleared the canvas: draw it again now (also while paused or resting)
            if (poster) renderFrame(0);
            else if (!failed && mode === 'full' && !document.hidden) {
                renderNow();
                wake();
            }
        }, 150);
    }, { passive: true });

    /* ---------- Input ---------- */
    function hurryIgnite() {
        if (igniteU >= 0 && igniteU < 1) igniteRate = Math.max(igniteRate, (1 - igniteU) / 0.2);
    }
    function onInput() {
        lastInput = performance.now();
        hurryIgnite();
        wake();
    }
    addEventListener('scroll', onInput, { passive: true });
    addEventListener('pointerdown', onInput, { passive: true });
    addEventListener('touchstart', onInput, { passive: true });
    addEventListener('pointermove', (e) => {
        lastInput = performance.now();
        wake();
        // Free look: the pointer position is the look target (+x right, +y down)
        if (!looking || e.pointerType === 'touch' || !fineHover.matches) return;
        lookAt.x = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1);
        lookAt.y = clamp((e.clientY / innerHeight) * 2 - 1, -1, 1);
        rig.setLookTarget(lookAt.x, lookAt.y);
    }, { passive: true });
    addEventListener('keydown', (e) => {
        onInput();
        const step = looking && !e.altKey && !e.ctrlKey && !e.metaKey && LOOK_KEYS[e.key];
        if (!step) return;
        // The page is inert while looking, so arrows would only scroll it away
        e.preventDefault();
        lookAt.x = clamp(lookAt.x + step[0] * LOOK_STEP, -1, 1);
        lookAt.y = clamp(lookAt.y + step[1] * LOOK_STEP, -1, 1);
        rig.setLookTarget(lookAt.x, lookAt.y);
    });

    document.addEventListener('visibilitychange', () => (document.hidden ? stopLoop() : startLoop()));
    addEventListener('pagehide', stopLoop);
    addEventListener('pageshow', startLoop);

    // Every pixel runs the full geodesic trace during the plunge, so resolution is the lever:
    // start lower on weaker tiers, then keep stepping down while frames run slow (never up mid-fall)
    const PLUNGE_SCALE = { high: 1, medium: 0.7, low: 0.55 };
    let plungeScaled = false;
    let plungeSlow = 0;
    function setPlungeScale(on) {
        if (on === plungeScaled) return;
        plungeScaled = on;
        plungeSlow = 0;
        scale = on ? Math.min(governor.scale, PLUNGE_SCALE[tierName] || 0.7) : governor.scale;
        resize();
    }
    function plungeFrameTime(elapsed, expected) {
        plungeSlow = elapsed > expected * 1.35 ? plungeSlow + 1 : Math.max(0, plungeSlow - 0.5);
        if (plungeSlow > 10 && scale > 0.45) {
            scale = Math.max(0.45, scale * 0.82);
            plungeSlow = 0;
            resize();
        }
    }

    /* Palette-only free look: the page hides (fade 1, mask off) and the rig adds a capped look offset */
    function setLook(active) {
        if (active === looking) return;
        looking = active;
        // Each look starts centred (the rig resets its own target too)
        lookAt.x = 0;
        lookAt.y = 0;
        rig.setFreeLook(active);
        governor.quiet(1500);
        wake();
    }

    on(EV.PLUNGE, (e) => {
        if (e.detail && e.detail.active) {
            setLook(false);
            plunge.start();
            setPlungeScale(true);
        } else {
            plunge.abort();
        }
        wake();
    });
    on(EV.PLUNGE_DONE, () => setPlungeScale(false));
    on(EV.WARP, (e) => {
        warpActive = !!(e.detail && e.detail.active);
        rig.setWarp(warpActive);
        wake();
    });
    on(EV.FOCUS, (e) => {
        rig.setFocus(e.detail && e.detail.id);
        wake();
    });
    on(EV.LOOK, (e) => {
        const active = !!(e.detail && e.detail.active);
        if (active && (plunge.active || mode === 'lite' || failed || poster)) return;
        setLook(active);
    });
    on(EV.MOTION, (e) => {
        const d = e.detail || {};
        // A reduced-motion visitor who chose 3D gets a still camera (no sway, no plunge roll)
        if (!poster) frame.still = !!d.still;
        mode = d.mode === 'lite' ? 'lite' : 'full';
        if (mode === 'lite') {
            setLook(false);
            stopLoop();
            // Cut short (no 'done' will come): the plunge's lower resolution goes with it
            if (plunge.active) {
                plunge.reset();
                setPlungeScale(false);
            }
            return;
        }
        // Coming back after the governor gave up: retry at the lowest tier instead of staying dead
        if (failed && failReason === 'perf') {
            failed = false;
            failReason = null;
            applyTier('low');
            governor.reset('low');
            governor.quiet(4000);
            emit(EV.READY, { tier: 'low', post: postKind, probeMs: 0, revival: true });
        }
        startLoop();
    });

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

    /* Palette quality control. A lower (or the same) tier applies live; a higher tier or 'auto'
       needs a fresh boot (bloom, MSAA and the baked assets are fixed at startup), so the choice is
       saved (or cleared) and the caller reloads. */
    function setQuality(name) {
        if (name === 'auto') {
            clearSavedTier();
            return 'reload';
        }
        if (!TIERS[name]) return null;
        const stored = saveTier(name, rendererString, 'user');
        // A reload that couldn't find the choice would come back on the same tier
        if (TIER_ORDER.indexOf(name) > TIER_ORDER.indexOf(tierName)) return stored ? 'reload' : null;
        cadenceCapped = false;
        if (name !== tierName) applyTier(name);
        else {
            pickCadence();
            if (scale !== 1) {
                scale = 1;
                resize();
                emit(EV.TIER, { tier: tierName, scale, kind: 'scale', post: postKind });
            }
        }
        governor.reset(name);
        governor.quiet(3000);
        return 'applied';
    }

    window.SpaceScene = {
        get tier() { return tierName; },
        get mode() { return mode; },
        setQuality,
        pause() {
            paused = true;
            stopLoop();
        },
        resume() {
            paused = false;
            startLoop();
        },
        warp: (active) => rig.setWarp(active),
        setTime: (t) => { frame.t = t; },
        getState: () => ({
            running, tier: tierName, scale, post: postKind,
            fps: Math.round(fps * 10) / 10,
            refresh: Math.round(1000 / refreshMs),
            cadence: Math.round(10000 / (cadence.n * refreshMs)) / 10,
            dpr: Math.round(frame.dpr * 100) / 100,
            asleep, looking, s: rig.s,
            fade: Math.round(frame.fade * 1000) / 1000,
            ignite: Math.round(frame.ignite * 1000) / 1000,
            pieces: pieces.map((p) => `${p.id}:${p.state}${p.visible ? '*' : ''}${p.visible && p.presence < 0.995 ? p.presence.toFixed(2) : ''}`),
            calls: renderer.info.render.calls,
            programs: renderer.info.programs ? renderer.info.programs.length : 0,
        }),
    };

    /* ---------- Poster: one exact still for the static backdrop (capture tooling) ---------- */
    async function renderPoster() {
        // A few warm frames upload textures and size the offscreen targets; the capture is taken
        // in the same task as its render, while the drawing buffer still holds it
        for (let i = 0; i < 5; i++) {
            await nextFrame();
            renderFrame(0);
        }
        renderFrame(0);
        window.__poster = canvas.toDataURL('image/png');
        emit(EV.POSTER, { dataURL: window.__poster });
        booted = true;
        root.dataset.spaceTier = tierName;
        emit(EV.READY, { tier: tierName, post: postKind, probeMs: 0, revival: false });
    }

    /* Programs for everything drawn outside the set pieces (sky, stars, meteors, the hero sun) and
       for the post chain, compiled off the main thread before the first frame instead of linked
       inside it. Scene-level objects only: set pieces compile in ensure(), with their lights. */
    async function precompileFrame() {
        const groups = new Set(pieces.map((p) => p.obj && p.obj.group).filter(Boolean));
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(post.composer ? post.composer.readBuffer : null);
        const jobs = scene.children.filter((o) => !groups.has(o)).map((o) => renderer.compileAsync(o, camera, scene));
        renderer.setRenderTarget(prev);
        jobs.push(post.precompile());
        await Promise.all(jobs);
    }

    /* ---------- Boot: load what's in view, probe frame times, then reveal ---------- */
    if (poster) rig.pose(poster.s, poster.t, { still: true });
    else rig.snap(J);
    const s0 = rig.s;
    const nearFirst = [...pieces].sort((a, b) => distance(a, s0) - distance(b, s0));
    await Promise.all([skyReady, ...nearFirst.filter((p) => distance(p, s0) <= (poster ? 0 : 0.35)).map(ensure)]);
    if (poster) {
        await renderPoster();
        return;
    }
    await precompileFrame();
    armed = true;

    async function runProbe(frames) {
        const samples = [];
        await new Promise((resolve) => {
            probe = (ms) => {
                samples.push(ms);
                if (samples.length >= frames) resolve();
            };
            startLoop();
        });
        probe = null;
        samples.sort((a, b) => a - b);
        return samples[Math.floor(samples.length / 2)];
    }

    let probeMs = 0;
    if (mode === 'full' && !document.hidden) {
        await yieldTask();
        await nextFrame();
        for (let attempt = 0; attempt < 2; attempt++) {
            // A tier this device already proved (or the visitor chose) only needs a short confirmation
            probeMs = await runProbe(attempt === 0 && saved ? 10 : 30);
            if (pinned || probeMs <= Math.max(16.7, cadence.slow * refreshMs) * 1.25) break;
            const idx = TIER_ORDER.indexOf(tierName);
            if (idx === 0) break;
            applyTier(TIER_ORDER[idx - 1]);
            governor.reset(tierName);
        }
    }
    if (failed) return;

    // Persist only the probe's own decisions; a confirmed saved tier keeps its date, so it still expires
    if (!pinned && (!saved || saved.tier !== tierName)) saveTier(tierName, rendererString, 'probe');
    root.dataset.spaceTier = tierName;
    booted = true;
    performance.mark('space:ready');
    igniteU = 0; // the first reveal brightens into place
    emit(EV.READY, { tier: tierName, post: postKind, probeMs: Math.round(probeMs * 10) / 10, revival: false });
    startLoop();

    // Everything else loads in idle time, nearest first
    const whenIdle = window.requestIdleCallback || ((cb) => setTimeout(cb, 300));
    for (const p of nearFirst) {
        if (p.state !== 'idle') continue;
        await new Promise((resolve) => whenIdle(resolve, { timeout: 3000 }));
        await ensure(p);
    }
}
