/* ==========================================================================
   Arhant Jain: UI controller (ES module)

   Owns everything in the DOM: scroll state, HUD, nav, reveal, counters,
   typewriter, warp, clipboard and motion mode. The 3D scene never measures the
   page; it reads window.Journey each frame and listens for space:* events.

   UI → scene:  space:section {id, index, scene, prevId, direction}
                space:warp    {active, reason: 'velocity' | 'nav' | 'return'}
                space:motion  {mode: 'full' | 'lite', source: 'system' | 'user'}
                space:focus   {id}        (Mission Log card hover/focus, id null on leave)
   Scene → UI:  space:ready {tier}   space:tier {tier}   space:fallback {reason}
   ========================================================================== */

const SCENE_SRC = './space/boot.js';

const root = document.documentElement;
const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
const mqFinePointer = matchMedia('(hover: hover) and (pointer: fine)');

const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------- 1. Shared state ---------- */

const sections = [...document.querySelectorAll('main > section[data-scene]')];

const Journey = (window.Journey = {
    version: 1,
    sections: sections.map((s) => ({ id: s.id, scene: s.dataset.scene })),
    index: 0,
    id: null,      // set by the first frame
    progress: 0,   // 0..1 through the active section
    page: 0,       // 0..1 through the document
    velocity: 0,   // px/s, signed, smoothed
    warp: false,
    motion: root.dataset.motion,
});

const isFull = () => root.dataset.motion === 'full';

/* ---------- 2. Motion mode ---------- */

const motionBtn = document.getElementById('motion-toggle');
let typewriter = null;

function storedMotion() {
    try { return localStorage.getItem('motion'); } catch (e) { return null; }
}

function setMotion(mode, source) {
    if (mode === root.dataset.motion) return;
    root.dataset.motion = mode;
    Journey.motion = mode;
    if (source === 'user') {
        try { localStorage.setItem('motion', mode); } catch (e) { /* private mode */ }
    }
    syncMotionButton();
    emit('space:motion', { mode, source });

    if (mode === 'lite') {
        if (typewriter) typewriter.stop();
        setWarp(false, 'velocity');
    } else {
        loadScene();
    }
}

function syncMotionButton() {
    if (motionBtn) motionBtn.setAttribute('aria-pressed', String(!isFull()));
}

if (motionBtn) {
    motionBtn.hidden = false;
    syncMotionButton();
    motionBtn.addEventListener('click', () => setMotion(isFull() ? 'lite' : 'full', 'user'));
}

mqReduce.addEventListener('change', () => {
    const choice = storedMotion();
    if (choice !== 'full' && choice !== 'lite') setMotion(mqReduce.matches ? 'lite' : 'full', 'system');
});

/* ---------- 3. Measurement (cached; never read during scroll) ---------- */

const hud = document.querySelector('.hud');
const track = document.querySelector('.flight-track');
const fill = document.querySelector('.flight-fill');
const ship = document.querySelector('.flight-ship');
const ticksList = document.querySelector('.flight-ticks');
const backBtn = document.getElementById('back-to-top');
const navLinks = [...document.querySelectorAll('.nav-links a, .mobile-menu a')];

const metrics = { vh: innerHeight, maxScroll: 1, starts: [], ends: [], trackW: 0 };
let ticks = [];

function measure() {
    const y = scrollY;
    const vh = innerHeight;
    const maxScroll = Math.max(1, root.scrollHeight - vh);
    const tops = sections.map((s) => s.getBoundingClientRect().top + y);

    // The probe line sits at mid-viewport. The first section starts where the probe is at
    // scrollY = 0 and the last one ends where it is at maxScroll, so the path spans the page.
    const probe0 = vh * 0.5;
    metrics.starts = tops.map((t, i) => (i === 0 ? probe0 : t));
    metrics.ends = tops.map((t, i) => (i < tops.length - 1 ? tops[i + 1] : maxScroll + probe0));
    for (let i = 0; i < metrics.ends.length; i++) {
        metrics.ends[i] = Math.max(metrics.ends[i], metrics.starts[i] + 1);
    }
    metrics.vh = vh;
    metrics.maxScroll = maxScroll;
    metrics.trackW = track ? track.clientWidth : 0;

    if (ticksList) {
        if (ticks.length !== sections.length) {
            ticksList.textContent = '';
            ticks = sections.map(() => ticksList.appendChild(document.createElement('li')));
        }
        ticks.forEach((li, i) => {
            const at = i === 0 ? 0 : clamp((metrics.starts[i] - probe0) / maxScroll, 0, 1);
            li.style.left = `${(at * 100).toFixed(3)}%`;
        });
        ticks.forEach((li, i) => li.classList.toggle('is-active', i === Journey.index));
    }
    requestFrame();
}

let measureQueued = false;
function queueMeasure() {
    if (measureQueued) return;
    measureQueued = true;
    requestAnimationFrame(() => { measureQueued = false; measure(); });
}

/* ---------- 4. Scroll loop: one passive listener, one rAF ---------- */

let frameQueued = false;
let lastY = scrollY;
let lastT = performance.now();
let fastFrames = 0;
let lastInput = 'none';
let programmatic = false;
let warpExitTimer = 0;
let scrollIdleTimer = 0;

function requestFrame() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(frame);
}

function frame(now) {
    frameQueued = false;
    const y = scrollY;
    const dt = Math.max(1, now - lastT);
    const instant = ((y - lastY) / dt) * 1000;
    lastY = y;
    lastT = now;
    Journey.velocity = Journey.velocity * 0.5 + instant * 0.5;

    // Section index + progress from the cached offsets
    const probe = y + metrics.vh * 0.5;
    let idx = 0;
    for (let i = 0; i < metrics.starts.length; i++) if (probe >= metrics.starts[i]) idx = i;
    const span = metrics.ends[idx] - metrics.starts[idx];
    Journey.progress = clamp((probe - metrics.starts[idx]) / span, 0, 1);
    Journey.page = clamp(y / metrics.maxScroll, 0, 1);
    if (idx !== Journey.index || Journey.id === null) setActive(idx);

    // HUD
    if (fill) fill.style.transform = `scaleX(${Journey.page.toFixed(4)})`;
    if (ship) ship.style.transform = `translateX(${(Journey.page * metrics.trackW - 5).toFixed(1)}px)`;
    hud.classList.toggle('is-scrolled', y > 16);
    if (backBtn) backBtn.classList.toggle('is-visible', y > metrics.vh * 0.8);

    detectWarp();
}

function onScroll() {
    requestFrame();
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(onScrollIdle, 160);
}

function onScrollIdle() {
    Journey.velocity = 0;
    fastFrames = 0;
    if (programmatic && !returning) {
        programmatic = false;
        setWarp(false, 'nav');
    }
}

addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', queueMeasure, { passive: true });
addEventListener('load', queueMeasure);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueMeasure);
if ('ResizeObserver' in window) new ResizeObserver(queueMeasure).observe(document.querySelector('main'));

addEventListener('wheel', () => { lastInput = 'wheel'; }, { passive: true });
addEventListener('touchmove', () => { lastInput = 'touch'; }, { passive: true });
addEventListener('keydown', () => { lastInput = 'key'; });
addEventListener('pointerdown', () => { lastInput = 'pointer'; });

/* ---------- 5. Active section ---------- */

function setActive(idx) {
    const prev = Journey.index;
    const prevId = Journey.id;
    const sec = sections[idx];
    if (!sec) return;
    Journey.index = idx;
    Journey.id = sec.id;
    root.dataset.section = sec.id;

    navLinks.forEach((a) => {
        if (a.getAttribute('href') === `#${sec.id}`) a.setAttribute('aria-current', 'location');
        else a.removeAttribute('aria-current');
    });
    ticks.forEach((li, i) => {
        li.classList.toggle('is-active', i === idx);
        li.classList.toggle('is-passed', i < idx);
    });

    emit('space:section', {
        id: sec.id,
        index: idx,
        scene: sec.dataset.scene,
        prevId: prevId === sec.id ? null : prevId,
        direction: idx >= prev ? 1 : -1,
    });
}

/* ---------- 6. Warp ---------- */

let returning = false;
let paletteOpen = false;

function setWarp(active, reason) {
    if (Journey.warp === active) return;
    Journey.warp = active;
    root.classList.toggle('is-warping', active && reason === 'velocity');
    if (!active) root.classList.remove('is-warping');
    emit('space:warp', { active, reason });
}

function detectWarp() {
    if (!isFull() || programmatic || paletteOpen || (lastInput !== 'wheel' && lastInput !== 'touch')) {
        fastFrames = 0;
        return;
    }
    const threshold = metrics.vh * 4.5;
    fastFrames = Math.abs(Journey.velocity) > threshold ? fastFrames + 1 : 0;
    if (fastFrames >= 2) setWarp(true, 'velocity');
    if (Journey.warp) {
        clearTimeout(warpExitTimer);
        warpExitTimer = setTimeout(() => setWarp(false, 'velocity'), 700);
    }
}

// In-page jumps fly the scene (no content fade); native anchors still do the scrolling.
document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a === backBtn || e.defaultPrevented) return;
    const target = document.getElementById(a.getAttribute('href').slice(1));
    if (!target || !isFull()) return;
    if (Math.abs(target.getBoundingClientRect().top) < metrics.vh * 1.5) return;
    programmatic = true;
    setWarp(true, 'nav');
});

/* ---------- 7. Back to top: "Return to launch" ---------- */

function focusHeroTitle() {
    const h1 = document.getElementById('hero-title');
    if (h1) h1.focus({ preventScroll: true });
}

if (backBtn) {
    backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!isFull()) {
            root.style.scrollBehavior = 'auto';
            scrollTo(0, 0);
            root.style.scrollBehavior = '';
            focusHeroTitle();
            return;
        }

        const start = scrollY;
        const duration = clamp(start * 0.3, 1200, 2400);
        const t0 = performance.now();
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        let cancelled = false;
        const cancel = () => { cancelled = true; };
        const opts = { once: true, passive: true };

        returning = true;
        programmatic = true;
        root.style.scrollBehavior = 'auto';
        setWarp(true, 'return');
        addEventListener('wheel', cancel, opts);
        addEventListener('touchstart', cancel, opts);
        addEventListener('keydown', cancel, { once: true });

        const finish = () => {
            removeEventListener('wheel', cancel);
            removeEventListener('touchstart', cancel);
            removeEventListener('keydown', cancel);
            root.style.scrollBehavior = '';
            returning = false;
            programmatic = false;
            setWarp(false, 'return');
            if (!cancelled) focusHeroTitle();
        };

        const step = (now) => {
            if (cancelled) return finish();
            const t = Math.min(1, (now - t0) / duration);
            scrollTo(0, Math.round(start * (1 - ease(t))));
            if (t < 1) requestAnimationFrame(step);
            else finish();
        };
        requestAnimationFrame(step);
    });
}

/* ---------- 8. Mobile menu ---------- */

const nav = document.querySelector('.nav');
const menuBtn = document.querySelector('.nav-toggle');
const menu = document.getElementById('mobile-menu');

if (nav && menuBtn && menu) {
    menuBtn.hidden = false;
    menu.inert = true;
    const isOpen = () => nav.classList.contains('menu-open');
    const setMenu = (open, returnFocus) => {
        nav.classList.toggle('menu-open', open);
        menuBtn.setAttribute('aria-expanded', String(open));
        menu.inert = !open;
        if (!open && returnFocus) menuBtn.focus();
    };
    menuBtn.addEventListener('click', () => setMenu(!isOpen()));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) setMenu(false, true); });
    document.addEventListener('click', (e) => { if (isOpen() && !nav.contains(e.target)) setMenu(false); });
    matchMedia('(min-width: 861px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });
}

/* ---------- 9. Reveal on scroll ---------- */

if ('IntersectionObserver' in window) {
    const revealIO = new IntersectionObserver((entries) => {
        let n = 0;
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.style.setProperty('--reveal-delay', `${Math.min(n++, 5) * 80}ms`);
            entry.target.classList.add('is-revealed');
            revealIO.unobserve(entry.target);
        }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    document.querySelectorAll('[data-reveal]').forEach((el) => revealIO.observe(el));
    root.classList.add('reveal-ready');
}

/* ---------- 10. Counters ---------- */

function runCounter(el) {
    if (!isFull()) return;
    const to = Number(el.dataset.to);
    const from = Number(el.dataset.from || 0);
    const decimals = Number(el.dataset.decimals || 0);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const finalText = el.textContent;
    const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    el.style.minWidth = `${el.getBoundingClientRect().width}px`;

    const duration = 1600;
    const t0 = performance.now();
    const step = (now) => {
        const t = Math.min(1, (now - t0) / duration);
        if (t >= 1 || !isFull()) {
            el.textContent = finalText;
            return;
        }
        const k = 1 - Math.pow(1 - t, 4);
        el.textContent = prefix + fmt.format(from + (to - from) * k) + suffix;
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

if ('IntersectionObserver' in window) {
    const countIO = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            countIO.unobserve(entry.target);
            runCounter(entry.target);
        }
    }, { threshold: 0.6 });
    document.querySelectorAll('[data-count]').forEach((el) => countIO.observe(el));
}

/* ---------- 11. Typewriter (decorative, one cycle) ---------- */

const TYPE_LINES = [
    'Python + AWS distributed systems',
    'Claude Code, MCP & AI agents',
    'Spec-driven development',
    'Event-driven serverless architecture',
    'Security & identity: JWE/JWS, RBAC',
    'Leading a team of 6 engineers',
];

(function initTypewriter() {
    const el = document.getElementById('typewriter');
    const hero = document.getElementById('hero');
    if (!el || !hero) return;

    let heroVisible = true;
    let stopped = false;
    let timer = 0;
    new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; }).observe(hero);

    const wait = (ms) => new Promise((resolve) => { timer = setTimeout(resolve, ms); });
    const ready = async () => { while (!stopped && (!heroVisible || document.hidden)) await wait(300); };

    typewriter = {
        stop() {
            stopped = true;
            clearTimeout(timer);
            el.textContent = TYPE_LINES[0];
        },
    };

    async function run() {
        await wait(2000);
        for (const line of [...TYPE_LINES.slice(1), TYPE_LINES[0]]) {
            while (!stopped && el.textContent.length) {
                await ready();
                el.textContent = el.textContent.slice(0, -1);
                await wait(26);
            }
            for (let i = 1; !stopped && i <= line.length; i++) {
                await ready();
                el.textContent = line.slice(0, i);
                await wait(52);
            }
            if (stopped) return;
            if (line !== TYPE_LINES[0]) await wait(1900);
        }
    }

    if (isFull()) run();
})();

/* ---------- 12. Experience: expand all + print ---------- */

const missions = [...document.querySelectorAll('.mission')];
const expandBtn = document.getElementById('expand-all');

if (expandBtn && missions.length) {
    expandBtn.hidden = false;
    const sync = () => { expandBtn.textContent = missions.every((d) => d.open) ? 'Collapse all' : 'Expand all'; };
    expandBtn.addEventListener('click', () => {
        const open = !missions.every((d) => d.open);
        missions.forEach((d) => { d.open = open; });
        sync();
    });
    missions.forEach((d) => d.addEventListener('toggle', sync));
    sync();
}

let printRestore = [];
addEventListener('beforeprint', () => {
    printRestore = missions.filter((d) => !d.open);
    printRestore.forEach((d) => { d.open = true; });
});
addEventListener('afterprint', () => {
    printRestore.forEach((d) => { d.open = false; });
    printRestore = [];
});

/* ---------- 13. Email: clicking it copies the address, with a toast ---------- */

const EMAIL = 'arhant@nyu.edu';
const toastEl = document.getElementById('toast');
const liveEl = document.getElementById('live-status');
let toastTimer = 0;

function toast(message, detail = '') {
    if (liveEl) {
        liveEl.textContent = '';
        requestAnimationFrame(() => { liveEl.textContent = detail ? `${message}: ${detail}` : message; });
    }
    if (!toastEl) return;
    toastEl.querySelector('.toast-msg').textContent = message;
    toastEl.querySelector('.toast-detail').textContent = detail;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2800);
}

export async function copyEmail() {
    try {
        if (!navigator.clipboard || !window.isSecureContext) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(EMAIL);
        toast('Email copied to clipboard', EMAIL);
    } catch (err) {
        // No clipboard access: fall back to the mail app
        toast('Opening your mail app', EMAIL);
        location.href = `mailto:${EMAIL}`;
    }
}

// Without JS these stay plain mailto links
document.querySelectorAll('[data-copy-email]').forEach((link) => {
    link.title = 'Copy email address';
    const hint = document.createElement('span');
    hint.className = 'sr-only';
    hint.textContent = ' (copies to clipboard)';
    link.appendChild(hint);
    link.addEventListener('click', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        copyEmail();
    });
});

/* ---------- 14. Mission Log: spotlight + scene focus ---------- */

document.querySelectorAll('.case').forEach((card) => {
    let raf = 0;
    card.addEventListener('pointermove', (e) => {
        if (!isFull() || !mqFinePointer.matches || raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            const r = card.getBoundingClientRect();
            card.style.setProperty('--mx', `${e.clientX - r.left}px`);
            card.style.setProperty('--my', `${e.clientY - r.top}px`);
        });
    });
    const focus = () => emit('space:focus', { id: card.id });
    const blur = () => emit('space:focus', { id: null });
    card.addEventListener('pointerenter', focus);
    card.addEventListener('pointerleave', blur);
    card.addEventListener('focusin', focus);
    card.addEventListener('focusout', blur);
});

/* ---------- 15. Analytics: contact clicks ---------- */

document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-track]');
    if (el && typeof window.gtag === 'function') window.gtag('event', 'contact_click', { method: el.dataset.track });
});

/* ---------- 16. Command palette (lazy) ---------- */

const paletteBtn = document.getElementById('palette-btn');

async function openPalette() {
    if (paletteOpen) return;
    try {
        const mod = await import('./palette.js');
        paletteOpen = true;
        mod.openPalette({
            sections,
            copyEmail,
            toggleMotion: () => motionBtn && motionBtn.click(),
            isLite: () => !isFull(),
            backToTop: () => backBtn && backBtn.click(),
            onClose: () => { paletteOpen = false; },
        });
    } catch (err) {
        paletteOpen = false;
        console.warn('Command palette failed to load', err);
    }
}

if (paletteBtn) {
    paletteBtn.hidden = false;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const hint = paletteBtn.querySelector('.kbd-hint');
    if (hint && mac) hint.textContent = '⌘K';
    paletteBtn.addEventListener('click', openPalette);
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            openPalette();
        }
    });
}

/* ---------- 17. 3D scene bridge ---------- */

let sceneState = 'idle'; // idle | loading | ready | failed

function loadScene() {
    if (sceneState !== 'idle' || !isFull()) return;
    sceneState = 'loading';
    const go = () => {
        import(SCENE_SRC)
            .then((mod) => mod.start({ canvas: document.getElementById('space-canvas') }))
            .catch((err) => {
                console.warn('3D scene unavailable, using the static backdrop.', err);
                emit('space:fallback', { reason: 'load-failed' });
            });
    };
    const idle = window.requestIdleCallback
        ? () => requestIdleCallback(go, { timeout: 2000 })
        : () => setTimeout(go, 200);
    if (document.readyState === 'complete') idle();
    else addEventListener('load', idle, { once: true });
}

addEventListener('space:ready', (e) => {
    sceneState = 'ready';
    root.classList.add('scene-ready');
    root.classList.remove('scene-failed');
    if (e.detail && e.detail.tier) root.dataset.spaceTier = e.detail.tier;
    // Replay current state for a scene that subscribed late
    const sec = sections[Journey.index];
    if (sec) emit('space:section', { id: sec.id, index: Journey.index, scene: sec.dataset.scene, prevId: null, direction: 1 });
    emit('space:motion', { mode: root.dataset.motion, source: 'system' });
});

addEventListener('space:tier', (e) => {
    if (e.detail && e.detail.tier) root.dataset.spaceTier = e.detail.tier;
});

addEventListener('space:fallback', (e) => {
    sceneState = 'failed';
    root.classList.remove('scene-ready');
    root.classList.add('scene-failed');
    // A device that can't hold frame rate gets lite mode for this session only (not persisted)
    if (e.detail && e.detail.reason === 'perf') setMotion('lite', 'system');
});

/* ---------- 18. Boot ---------- */

measure();
frame(performance.now());
loadScene();
