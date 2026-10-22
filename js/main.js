/* ==========================================================================
   Arhant Jain: UI controller (ES module)

   Owns everything in the DOM: scroll state, HUD, nav, reveal, typewriter,
   warp, wayfinding, clipboard, motion mode, the event-horizon plunge, free
   look and analytics. The 3D scene never measures the page; it reads
   window.Journey each frame and listens for space:* events.

   UI → scene:  space:section {id, index, scene, prevId, direction}
                space:warp    {active, reason: 'velocity' | 'nav' | 'return'}
                space:motion  {mode: 'full' | 'lite', source: 'system' | 'user', still}
                space:focus   {id}        (Mission Log card dwell; id null once the pointer leaves the list)
                space:plunge  {active, reason}
                space:look    {active}    (palette-only free look)
   Scene → UI:  space:ready {tier, post, probeMs, revival}   space:tier {tier, scale, kind, post}
                space:fallback {reason}   space:plunge-state / -end / -done
   ========================================================================== */

// Only the entry point is preloaded from here: boot.js preloads the rest of the scene once its GPU
// check passes, so a device that falls back to the static backdrop never downloads it
const SCENE_SRC = './space/boot.js';

const root = document.documentElement;
const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
const mqFinePointer = matchMedia('(hover: hover) and (pointer: fine)');

const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const whenIdle = window.requestIdleCallback
    ? (fn, timeout) => requestIdleCallback(fn, { timeout })
    : (fn) => setTimeout(fn, 1);

function readSession(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
}
function writeSession(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) { /* storage blocked */ }
}

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
// A motion-sensitive visitor who still chose the 3D: the scene holds the camera still
const isStill = () => isFull() && mqReduce.matches;
// Jumps fly (warp, smooth scroll) only in full motion without a reduced-motion preference
const flies = () => isFull() && !mqReduce.matches;

/* ---------- 2. Motion mode ---------- */

const motionBtn = document.getElementById('motion-toggle');

function storedMotion() {
    try { return localStorage.getItem('motion'); } catch (e) { return null; }
}

function emitMotion(source) {
    emit('space:motion', { mode: root.dataset.motion, source, still: isStill() });
}

function setMotion(mode, source) {
    if (mode === root.dataset.motion) return;
    root.dataset.motion = mode;
    Journey.motion = mode;
    if (source === 'user') {
        try { localStorage.setItem('motion', mode); } catch (e) { /* private mode */ }
    }
    syncMotionButton();
    emitMotion(source);

    if (mode === 'lite') {
        if (typewriter) typewriter.stop();
        if (warpReason) setWarp(false, warpReason);
        stopPlunge('lite');
        exitLook('lite');
        releaseSceneFocus(true);
    } else {
        // Whatever already made its entrance stays put instead of replaying it
        document.querySelectorAll('[data-reveal].is-revealed').forEach((el) => el.classList.add('no-anim'));
        if (typewriter) typewriter.resume();
        loadScene();
    }
    syncPlungeHint();
    updateCaption();
}

function syncMotionButton() {
    if (!motionBtn) return;
    const full = isFull();
    motionBtn.setAttribute('aria-pressed', String(!full));
    // The name stays put; the tooltip says which mode is on now
    motionBtn.title = full ? '3D scene on. Switch to lite mode' : 'Lite mode on. Switch to the 3D scene';
}

if (motionBtn) {
    motionBtn.hidden = false;
    syncMotionButton();
    motionBtn.addEventListener('click', () => setMotion(isFull() ? 'lite' : 'full', 'user'));
}

mqReduce.addEventListener('change', () => {
    const before = root.dataset.motion;
    const choice = storedMotion();
    if (choice !== 'full' && choice !== 'lite') setMotion(mqReduce.matches ? 'lite' : 'full', 'system');
    if (root.dataset.motion !== before) return;
    // Same mode (the visitor chose it): only the camera calms down or wakes up
    emitMotion('system');
    if (isStill()) {
        if (warpReason === 'velocity') setWarp(false, 'velocity');
        exitLook('lite');
        releaseSceneFocus(true);
    }
});

// Back/forward cache: the choice may have changed on a case-study page meanwhile. 'system' doesn't
// write it again, and this runs before the scene's own pageshow restarts its loop.
addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    const choice = storedMotion();
    if ((choice === 'full' || choice === 'lite') && choice !== root.dataset.motion) setMotion(choice, 'system');
});

/* ---------- 3. Measurement (cached; never read during scroll) ---------- */

const hud = document.querySelector('.hud');
const track = document.querySelector('.flight-track');
const fill = document.querySelector('.flight-fill');
const ship = document.querySelector('.flight-ship');
const ticksList = document.querySelector('.flight-ticks');
const backBtn = document.getElementById('back-to-top');
const navLinks = [...document.querySelectorAll('.nav-links a, .mobile-menu a')];

const metrics = { vh: innerHeight, vw: innerWidth, maxScroll: 1, starts: [], ends: [], trackW: 0 };
const loc = { idx: 0, p: 0 };
let ticks = [];

// Layout that changes with no scroll (a timeline group opening, fonts arriving) would move the camera
// on its own. pOffset absorbs that jump in the active section's progress and drains as the visitor
// scrolls on, fully after half a viewport.
let pOffset = 0;
let pDrain = 0; // offset drained per scrolled px

function setOffset(v) {
    pOffset = Math.abs(v) < 1e-3 ? 0 : clamp(v, -0.25, 0.25);
    pDrain = Math.abs(pOffset) / (metrics.vh * 0.5);
}

// Section index + true progress at scroll position y, from the cached offsets (written into loc)
function locate(y) {
    const probe = y + metrics.vh * 0.5;
    let idx = 0;
    for (let i = 0; i < metrics.starts.length; i++) if (probe >= metrics.starts[i]) idx = i;
    const span = metrics.ends[idx] - metrics.starts[idx];
    loc.idx = idx;
    loc.p = clamp((probe - metrics.starts[idx]) / span, 0, 1);
}

function measure() {
    const vh = innerHeight;
    const vw = innerWidth;
    const first = !metrics.starts.length;
    const resized = vh !== metrics.vh || vw !== metrics.vw;
    const maxScroll = Math.max(1, root.scrollHeight - vh);
    // A resize or rotation mid-plunge reflows the hidden page: keep it pinned to the bottom, where
    // the fall began, so the camera flies back to the black hole and not to another section
    if (plunging && scrollY < maxScroll - 4) {
        root.style.scrollBehavior = 'auto';
        scrollTo(0, maxScroll);
        root.style.scrollBehavior = '';
        lastY = scrollY;
    }
    const y = scrollY;
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
    metrics.vw = vw;
    metrics.maxScroll = maxScroll;
    metrics.trackW = track ? track.clientWidth : 0;

    // Content re-measure: keep publishing the progress the camera already has. A viewport resize,
    // a jump in flight or the plunge starts from the true value instead.
    if (first || resized || programmatic || plunging || Journey.id === null) setOffset(0);
    else {
        locate(y);
        setOffset(loc.idx === Journey.index ? Journey.progress - loc.p : 0);
    }

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
let lastInput = 'none';
let programmatic = false;
let moving = false;
let fastSince = 0;
let warpReason = null;
let warpExitTimer = 0;
let scrollIdleTimer = 0;
const idleWaiters = [];

function requestFrame() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(frame);
}

function frame(now) {
    frameQueued = false;
    const y = scrollY;
    const dt = Math.max(1, now - lastT);
    const dy = y - lastY;
    lastY = y;
    lastT = now;
    // Time-based smoothing (~80 ms), so 60 Hz and 120 Hz screens read the same velocity
    Journey.velocity += ((dy / dt) * 1000 - Journey.velocity) * (1 - Math.exp(-dt / 80));

    locate(y);
    if (loc.idx !== Journey.index) setOffset(0);
    else if (pOffset && dy) {
        const left = Math.abs(pOffset) - Math.abs(dy) * pDrain;
        pOffset = left < 1e-3 ? 0 : Math.sign(pOffset) * left;
    }
    Journey.progress = clamp(loc.p + pOffset, 0, 1);
    Journey.page = clamp(y / metrics.maxScroll, 0, 1);
    if (loc.idx !== Journey.index || Journey.id === null) setActive(loc.idx);

    // HUD
    if (fill) fill.style.transform = `scaleX(${Journey.page.toFixed(4)})`;
    if (ship) ship.style.transform = `translateX(${(Journey.page * metrics.trackW - 5).toFixed(1)}px)`;
    if (hud) hud.classList.toggle('is-scrolled', y > 16);
    root.classList.toggle('is-scrolled', y > 16); // the hero's scroll cue steps aside
    if (backBtn) backBtn.classList.toggle('is-visible', y > metrics.vh * 0.8);
    syncPlungeHint();

    detectWarp(now);
}

function onScroll() {
    requestFrame();
    if (!moving) {
        moving = true;
        root.classList.add('is-moving');
    }
    if (targetCard) clearTarget();
    if (looking && Math.abs(scrollY - lookY) > 2) exitLook('scroll');
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(onScrollIdle, 150);
}

function onScrollIdle() {
    Journey.velocity = 0;
    fastSince = 0;
    if (moving) {
        moving = false;
        root.classList.remove('is-moving');
    }
    if (programmatic && !returning) {
        programmatic = false;
        setWarp(false, 'nav');
    }
    if (landing) land();
    idleWaiters.splice(0).forEach((fn) => fn());
}

// Resolves once scrolling has stopped (or after `ms`), even if nothing ends up scrolling at all
function scrollSettled(ms) {
    return new Promise((resolve) => {
        idleWaiters.push(resolve);
        setTimeout(resolve, ms);
        if (!moving) {
            clearTimeout(scrollIdleTimer);
            scrollIdleTimer = setTimeout(onScrollIdle, 400);
        }
    });
}

addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', queueMeasure, { passive: true });
addEventListener('load', queueMeasure);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueMeasure);
if ('ResizeObserver' in window && document.querySelector('main')) new ResizeObserver(queueMeasure).observe(document.querySelector('main'));

addEventListener('wheel', () => { lastInput = 'wheel'; }, { passive: true });
addEventListener('touchmove', () => { lastInput = 'touch'; }, { passive: true });
addEventListener('keydown', () => { lastInput = 'key'; });
addEventListener('pointerdown', () => { lastInput = 'pointer'; });

/* ---------- 5. Active section ---------- */

const sectionLabel = document.getElementById('section-label');
function sectionName(s) {
    const h = s.querySelector('h2');
    return (s.dataset.label || (h ? h.textContent : s.id)).trim();
}
let maxIndex = 0;

function setActive(idx) {
    const prev = Journey.index;
    const prevId = Journey.id;
    const sec = sections[idx];
    if (!sec) return;
    Journey.index = idx;
    Journey.id = sec.id;
    root.dataset.section = sec.id;
    maxIndex = Math.max(maxIndex, idx);

    navLinks.forEach((a) => {
        if (a.getAttribute('href') === `#${sec.id}`) a.setAttribute('aria-current', 'location');
        else a.removeAttribute('aria-current');
    });
    ticks.forEach((li, i) => {
        li.classList.toggle('is-active', i === idx);
        li.classList.toggle('is-passed', i < idx);
    });
    // Phones: "02 · Experience" next to the logo (CSS shows it below 860 px)
    if (sectionLabel) {
        const num = sec.querySelector('.sec-num');
        sectionLabel.textContent = idx === 0 ? ''
            : `${num ? num.textContent.trim() : String(idx).padStart(2, '0')} · ${sectionName(sec)}`;
    }
    if (sec.id !== 'projects') {
        hideBackChip();
        releaseSceneFocus(true);
    }
    updateCaption();

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
    if (active ? Journey.warp && warpReason === reason : !Journey.warp) return;
    clearTimeout(warpExitTimer);
    Journey.warp = active;
    warpReason = active ? reason : null;
    // Text dims slightly only for wheel and trackpad flicks; a touch fling streaks the stars alone
    root.classList.toggle('is-warping', active && reason === 'velocity' && lastInput === 'wheel');
    emit('space:warp', { active, reason });
    updateCaption();
}

const endVelocityWarp = () => { if (warpReason === 'velocity') setWarp(false, 'velocity'); };

function detectWarp(now) {
    if (!isFull() || isStill() || programmatic || paletteOpen || plunging || looking
        || (lastInput !== 'wheel' && lastInput !== 'touch')) {
        fastSince = 0;
        return;
    }
    const speed = Math.abs(Journey.velocity);
    if (warpReason === 'velocity') {
        // Held only while the flick is really fast: it ends 250 ms after the last fast frame,
        // so a long momentum tail no longer keeps it on
        if (speed > metrics.vh * 3) {
            clearTimeout(warpExitTimer);
            warpExitTimer = setTimeout(endVelocityWarp, 250);
        }
        return;
    }
    if (Journey.warp) return; // a nav jump or the return flight owns it
    if (speed <= metrics.vh * 7) {
        fastSince = 0;
        return;
    }
    if (!fastSince) fastSince = now;
    else if (now - fastSince >= 150) {
        setWarp(true, 'velocity');
        warpExitTimer = setTimeout(endVelocityWarp, 250);
    }
}

// A long in-page jump flies the scene (the content stays visible); the scroll itself stays native
function startNavWarp() {
    programmatic = true;
    setOffset(0);
    setWarp(true, 'nav');
    // A jump that never scrolls (already there, or interrupted) still ends its warp
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(onScrollIdle, 400);
}

const isFar = (el) => Math.abs(el.getBoundingClientRect().top) >= metrics.vh * 1.5;
const plainClick = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

// A block that hasn't made its entrance still sits 24 px low (the reveal offset): put it where it
// comes to rest before scrolling to it, or it lands that much high, under the nav
function settleReveal(el) {
    if (el.matches('[data-reveal]:not(.is-revealed)')) el.classList.add('no-anim', 'is-revealed');
}

document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a === backBtn || e.defaultPrevented || !plainClick(e)) return;
    const target = document.getElementById(a.getAttribute('href').slice(1));
    if (!target) return;
    settleReveal(target);
    if (a.classList.contains('cs-link') && target.matches('.case')) expectLanding(target, { from: a, focus: true });
    if (flies() && isFar(target)) startNavWarp();
});

/* ---------- 7. Wayfinding: jumps, landing highlight, back chip ---------- */

function focusHeading(el) {
    const h = el.matches('h1, h2, h3') ? el : el.querySelector('h1, h2, h3');
    if (!h) return;
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
}

// Shared by the palette: the same warp rule as a link, the heading gets focus, and Back works
function jumpTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    settleReveal(el);
    if (el.matches('.case')) expectLanding(el, { focus: false });
    if (flies() && isFar(el)) startNavWarp();
    el.scrollIntoView({ behavior: flies() ? 'smooth' : 'auto', block: 'start' });
    if (location.hash !== `#${id}`) history.pushState(null, '', `#${id}`);
    focusHeading(el);
}

const backChip = document.getElementById('back-chip');
let landing = null;     // {card, from, focus}: a case card we're on the way to
let targetCard = null;  // the card marked .is-target until the next scroll
let landTimer = 0;

function expectLanding(card, { from = null, focus = false } = {}) {
    clearTarget();
    hideBackChip();
    landing = { card, from, focus };
    // Nothing to scroll (already in place, or the browser already did it): land once it's at least half in view
    clearTimeout(landTimer);
    landTimer = setTimeout(() => {
        if (!landing || landing.card !== card || moving) return;
        const r = card.getBoundingClientRect();
        const shown = Math.min(r.bottom, metrics.vh) - Math.max(r.top, 0);
        if (shown >= Math.min(r.height, metrics.vh) * 0.5) land();
    }, 400);
}

function land() {
    const l = landing;
    landing = null;
    clearTimeout(landTimer);
    if (!l || !l.card.isConnected) return;
    // Interrupted on the way (the visitor scrolled somewhere else): no highlight, no chip
    const r = l.card.getBoundingClientRect();
    if (r.bottom < metrics.vh * 0.2 || r.top > metrics.vh * 0.8) return;
    targetCard = l.card;
    targetCard.classList.add('is-target');
    if (l.focus) focusHeading(targetCard);
    if (l.from && backChip) {
        // Right after the card in the tab order (it stays fixed on screen: the card's list item has
        // no transform), so the way back is a Tab or two from the heading that just got focus
        if (backChip.previousElementSibling !== l.card) l.card.after(backChip);
        backChip.hidden = false;
        backFrom = l.from;
    }
}

function clearTarget() {
    if (!targetCard) return;
    targetCard.classList.remove('is-target');
    targetCard = null;
}

let backFrom = null;

function hideBackChip() {
    backFrom = null;
    if (!backChip || backChip.hidden) return;
    const hadFocus = backChip.contains(document.activeElement);
    backChip.hidden = true;
    if (hadFocus && targetCard) focusHeading(targetCard);
}

if (backChip) {
    backChip.addEventListener('click', () => {
        const link = backFrom;
        clearTarget();
        hideBackChip();
        if (!link || !link.isConnected) return;
        const group = link.closest('details');
        if (group && !group.open) group.open = true;
        if (flies() && isFar(link)) startNavWarp();
        link.scrollIntoView({ behavior: flies() ? 'smooth' : 'auto', block: 'center' });
        link.focus({ preventScroll: true });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !backChip.hidden && !paletteOpen && !plunging && !looking) hideBackChip();
    });
}

/* ---------- 8. Back to top: "Return to launch" ---------- */

function focusHeroTitle() {
    const h1 = document.getElementById('hero-title');
    if (h1) h1.focus({ preventScroll: true });
}

if (backBtn) {
    backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        // Lite, and a reduced-motion visitor in 3D: straight to the top, no return flight
        if (!flies()) {
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
        setOffset(0);
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

/* ---------- 9. Mobile menu ---------- */

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

/* ---------- 10. Arrival + reveal on scroll ---------- */

// A fresh visit on a #hash goes straight there. With smooth scrolling on, the browser would fly the
// whole page from the top instead, and the reveal pass below would measure the wrong screen.
// Reloads and Back/Forward keep the browser's own scroll restoration.
(function arriveOnHash() {
    const entry = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    if (!location.hash || scrollY > 0 || (entry && entry.type !== 'navigate')) return;
    let el = null;
    try { el = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) { /* malformed hash */ }
    if (!el) return;
    root.style.scrollBehavior = 'auto';
    el.scrollIntoView({ block: 'start' });
    root.style.scrollBehavior = '';
    lastY = scrollY; // not a scroll the visitor made: no velocity spike
})();

if ('IntersectionObserver' in window) {
    const revealIO = new IntersectionObserver((entries) => {
        let n = 0;
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target;
            // Lite mode shows it as it is, so switching to 3D later doesn't play the entrance
            if (!isFull()) el.classList.add('no-anim');
            else el.style.setProperty('--reveal-delay', `${Math.min(n++, 5) * 80}ms`);
            el.classList.add('is-revealed');
            revealIO.unobserve(el);
        }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });

    // Already on screen at boot (a reload mid-page, a #hash): shown as is, never hidden for a frame
    const vh = innerHeight;
    document.querySelectorAll('[data-reveal]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.bottom > 0 && r.top < vh * 0.94) el.classList.add('is-revealed', 'no-anim');
        else revealIO.observe(el);
    });
    root.classList.add('reveal-ready');
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

const typewriter = (() => {
    const el = document.getElementById('typewriter');
    const hero = document.getElementById('hero');
    if (!el || !hero || !('IntersectionObserver' in window)) return null;
    const caret = hero.querySelector('.typer-caret');

    let heroVisible = true;
    let pending = false; // asked to start while the hero was off screen
    let gen = 0;         // bumped by every start/stop; an older loop sees it and quits
    let timer = 0;

    // Solid caret while typing, blinking while idle
    const typing = (on) => { if (caret) caret.classList.toggle('is-typing', on); };

    async function run(token) {
        const live = () => token === gen;
        const wait = (ms) => new Promise((resolve) => { timer = setTimeout(resolve, ms); });
        // Hold (keeping the current text) while the hero is off screen or the tab is hidden
        const ready = async () => {
            if (heroVisible && !document.hidden) return;
            typing(false);
            while (live() && (!heroVisible || document.hidden)) await wait(300);
        };

        await wait(2000);
        for (const line of [...TYPE_LINES.slice(1), TYPE_LINES[0]]) {
            while (live() && el.textContent.length) {
                await ready();
                if (!live()) return;
                typing(true);
                el.textContent = el.textContent.slice(0, -1);
                await wait(26);
            }
            for (let i = 1; live() && i <= line.length; i++) {
                await ready();
                if (!live()) return;
                typing(true);
                el.textContent = line.slice(0, i);
                await wait(40 + Math.random() * 30);
            }
            if (!live()) return;
            typing(false);
            if (line !== TYPE_LINES[0]) await wait(1900);
        }
    }

    function stop() {
        gen++;
        pending = false;
        clearTimeout(timer);
        el.textContent = TYPE_LINES[0];
        typing(false);
    }

    function start() {
        if (!isFull()) return;
        stop();
        run(gen);
    }

    new IntersectionObserver(([e]) => {
        heroVisible = e.isIntersecting;
        if (heroVisible && pending) start();
    }).observe(hero);

    return {
        start,
        stop,
        // Back to full motion: restart now if the hero is on screen, otherwise when it next is
        resume() {
            if (heroVisible) start();
            else pending = true;
        },
    };
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

function announce(text) {
    if (!liveEl) return;
    liveEl.textContent = '';
    requestAnimationFrame(() => { liveEl.textContent = text; });
}

// The toast is visual only (aria-hidden); screen readers hear the same words in the live region
function toast(message, detail = '', { ms = 2800, say = '' } = {}) {
    announce(say || (detail ? `${message}: ${detail}` : message));
    if (!toastEl) return;
    toastEl.querySelector('.toast-msg').textContent = message;
    toastEl.querySelector('.toast-detail').textContent = detail;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), ms);
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

let sceneFocus = null;
let releaseTimer = 0;

function sendSceneFocus(id) {
    clearTimeout(releaseTimer);
    if (id === sceneFocus) return;
    sceneFocus = id;
    emit('space:focus', { id });
}

// Let go only once nothing in the list has been hovered or focused for a moment,
// so moving from card to card never swings the camera back to centre in between
function releaseSceneFocus(now) {
    clearTimeout(releaseTimer);
    if (sceneFocus === null) return;
    if (now) sendSceneFocus(null);
    else releaseTimer = setTimeout(() => sendSceneFocus(null), 400);
}

const focusVisible = (el) => {
    try { return el.matches(':focus-visible'); } catch (e) { return true; }
};
const sceneCanTurn = () => isFull() && !isStill() && sceneState === 'ready';
const atRest = () => !moving && !Journey.warp && Math.abs(Journey.velocity) < 40;

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

    // The camera turns toward the card only after a short dwell, with the page at rest
    let hovered = false;
    let focused = false;
    let dwell = 0;
    const engaged = () => hovered || focused;
    const check = () => {
        if (!engaged() || !sceneCanTurn()) return;
        if (atRest()) sendSceneFocus(card.id);
        else dwell = setTimeout(check, 250); // still scrolling: try again once it settles
    };
    const arm = () => {
        clearTimeout(dwell);
        clearTimeout(releaseTimer);
        if (sceneCanTurn()) dwell = setTimeout(check, 280);
    };
    const leave = () => {
        if (engaged()) return;
        clearTimeout(dwell);
        releaseSceneFocus();
    };
    card.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse' || !mqFinePointer.matches) return; // never on touch
        hovered = true;
        arm();
    });
    card.addEventListener('pointerleave', () => { hovered = false; leave(); });
    card.addEventListener('focusin', (e) => {
        if (!focusVisible(e.target)) return; // keyboard focus only, not a tap or click
        focused = true;
        arm();
    });
    card.addEventListener('focusout', (e) => {
        if (card.contains(e.relatedTarget)) return;
        focused = false;
        leave();
    });
});

/* ---------- 15. Analytics: one quiet helper, no personal data ---------- */

const hasGtag = () => typeof window.gtag === 'function';

// A no-op without GA (local and CI runs send nothing); sent in idle time unless the page is going away
function sendEvent(name, params = {}, now = false) {
    if (!hasGtag()) return;
    const send = () => window.gtag('event', name, params);
    if (now) send();
    else whenIdle(send, 2000);
}

document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-track]');
    if (el) sendEvent('contact_click', { method: el.dataset.track });
});

// Core Web Vitals, each once, tagged with the motion mode and tier the visitor actually got
function reportVitals() {
    if (!hasGtag()) return;
    import('./vendor/web-vitals/web-vitals.js').then(({ onLCP, onINP, onCLS }) => {
        const sent = new Set();
        const send = (m) => {
            if (sent.has(m.name)) return;
            sent.add(m.name);
            sendEvent(m.name, {
                value: Math.round(m.name === 'CLS' ? m.value * 1000 : m.value),
                metric_id: m.id,
                metric_rating: m.rating,
                motion: root.dataset.motion,
                tier: root.dataset.spaceTier || 'none',
            }, true);
        };
        onLCP(send);
        onINP(send);
        onCLS(send);
    }).catch(() => { /* analytics are optional */ });
}
if (document.readyState === 'complete') reportVitals();
else addEventListener('load', reportVitals, { once: true });

let maxSent = -1;
addEventListener('pagehide', () => {
    if (maxIndex <= maxSent || !sections[maxIndex]) return;
    maxSent = maxIndex;
    sendEvent('max_section_reached', { section: sections[maxIndex].id, index: maxIndex }, true);
});

/* ---------- 16. Command palette (lazy) ---------- */

const paletteBtn = document.getElementById('palette-btn');
const QUALITY_CYCLE = ['high', 'medium', 'low', 'auto'];
const TIER_RANK = { low: 0, medium: 1, high: 2 };
let paletteOpener = null;
let scenePaused = false;

// The Graphics quality row: null hides it (lite mode, fallback, or a scene without the API)
function qualityInfo() {
    const scene = window.SpaceScene;
    if (!isFull() || sceneState !== 'ready' || !scene || !scene.setQuality || !scene.getState) return null;
    const st = scene.getState();
    const current = readSession('space.quality.ui') || st.tier;
    const next = QUALITY_CYCLE[(QUALITY_CYCLE.indexOf(current) + 1) % QUALITY_CYCLE.length];
    const reloads = next === 'auto' || !(st.tier in TIER_RANK) || TIER_RANK[next] > TIER_RANK[st.tier];
    return { tier: st.tier, fps: st.fps, scale: st.scale, next, reloads };
}

function applyQuality(name) {
    const scene = window.SpaceScene;
    if (!scene || !scene.setQuality) return;
    const result = scene.setQuality(name);
    // null: the choice couldn't be stored (site storage blocked), so a reload would come back unchanged
    if (!result) {
        toast('Graphics quality unchanged', 'This browser blocks site storage');
        return;
    }
    writeSession('space.quality.ui', name);
    // A higher tier (or auto) needs the boot-time assets again, so the scene asks for a reload
    if (result === 'reload') {
        location.reload();
        return;
    }
    toast('Graphics quality', name[0].toUpperCase() + name.slice(1));
}

async function openPalette() {
    if (paletteOpen || plunging || looking) return;
    try {
        const mod = await import('./palette.js');
        if (paletteOpen || plunging || looking) return;
        paletteOpener = document.activeElement;
        paletteOpen = true;
        hideBackChip();
        syncPlungeHint();
        mod.openPalette({
            sections,
            copyEmail,
            jumpTo,
            toggleMotion: () => motionBtn && motionBtn.click(),
            isLite: () => !isFull(),
            backToTop: () => backBtn && backBtn.click(),
            canPlunge: () => plungeReady(),
            plunge: () => plungeFromCommand('palette'),
            canLook: () => sceneCanTurn() && mqFinePointer.matches && !plunging,
            look: () => setTimeout(() => enterLook(paletteOpener), 0),
            quality: qualityInfo,
            setQuality: applyQuality,
            onClose: () => {
                paletteOpen = false;
                if (scenePaused) {
                    scenePaused = false;
                    if (window.SpaceScene) window.SpaceScene.resume();
                }
                syncPlungeHint();
            },
        });
        // The ::backdrop already dims the page: stop rendering the scene behind it until it closes
        if (paletteOpen && sceneState === 'ready' && isFull() && window.SpaceScene) {
            window.SpaceScene.pause();
            scenePaused = true;
        }
    } catch (err) {
        paletteOpen = false;
        console.warn('Command palette failed to load', err);
    }
}

const typingIn = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const somethingModal = () => paletteOpen || plunging || looking || !!document.querySelector('dialog[open]');

if (paletteBtn) {
    paletteBtn.hidden = false;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const hint = paletteBtn.querySelector('.kbd-hint');
    if (hint && mac) hint.textContent = '⌘K';
    paletteBtn.addEventListener('click', openPalette);
    document.addEventListener('keydown', (e) => {
        const key = e.key || '';
        if ((e.ctrlKey || e.metaKey) && !e.altKey && key.toLowerCase() === 'k') {
            e.preventDefault();
            openPalette();
            return;
        }
        // "/" too, unless a modifier is held, the visitor is typing, or something modal is up
        if (key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || typingIn(e.target) || somethingModal()) return;
        e.preventDefault();
        openPalette();
    });
}

/* ---------- 17. Event horizon: a deliberate dive at the very bottom ---------- */

const plungeHint = document.getElementById('plunge-hint');
const plungeEnd = document.getElementById('plunge-end');
const plungeExit = plungeEnd && plungeEnd.querySelector('[data-plunge-exit]');
const plungeR = document.getElementById('plunge-r');
const plungeV = document.getElementById('plunge-v');
const plungePhase = document.getElementById('plunge-phase');
const contactTitle = document.getElementById('contact-title');
const contactSec = document.getElementById('contact');
let plunging = false;
let plungeArm = 0;
let plungeArmTimer = 0;
let plungeStartedAt = 0;
let hintShown = false;
let hintVisibleSince = 0;
let lastWheelAt = 0;
let wheelGesture = false; // the current wheel gesture may arm
let touchY = null;
let returnTimer = 0;
let endHideTimer = 0;
let endShowRaf = 0;

const atBottom = () => scrollY >= metrics.maxScroll - 4;
const plungeReady = () => isFull() && sceneState === 'ready' && !plunging;
// Keyboard focus inside Contact counts as being at the bottom, so tabbing forward reaches the
// button (focusing it then finishes the scroll). Only the very bottom arms a wheel or swipe.
const keyboardInContact = () => {
    const el = document.activeElement;
    return !!contactSec && !!el && contactSec.contains(el) && focusVisible(el);
};
const canPlunge = () => plungeReady() && !paletteOpen && !looking && (atBottom() || keyboardInContact());
const endCardShown = () => !!plungeEnd && !plungeEnd.hidden;

function syncPlungeHint() {
    const on = canPlunge();
    if (on === hintShown) return;
    hintShown = on;
    hintVisibleSince = on ? performance.now() : 0;
    if (plungeHint) plungeHint.classList.toggle('is-visible', on);
}
document.addEventListener('focusin', syncPlungeHint);
document.addEventListener('focusout', () => requestAnimationFrame(syncPlungeHint));

// Everything behind the plunge or the free look: out of reach for focus, clicks and screen readers
function setPageInert(on) {
    const page = [document.getElementById('main'), document.querySelector('.footer'), hud, backBtn, document.querySelector('.skip-link')];
    for (const el of page) {
        if (el) el.inert = on;
    }
}

function armPlunge(amount) {
    if (!canPlunge() || !atBottom()) { plungeArm = 0; return; }
    plungeArm += amount;
    clearTimeout(plungeArmTimer);
    plungeArmTimer = setTimeout(() => { plungeArm = 0; }, 900);
    if (plungeArm > 650) startPlunge({ source: 'scroll' });
}

addEventListener('wheel', (e) => {
    const now = performance.now();
    const fresh = now - lastWheelAt >= 250;
    lastWheelAt = now;
    if (plunging) return;
    if (e.deltaY < 0) {
        plungeArm = 0;
        wheelGesture = false;
        return;
    }
    // Only a new gesture that starts well after the hint appeared counts, never the momentum that got here
    if (fresh) wheelGesture = hintShown && now - hintVisibleSince >= 800;
    if (wheelGesture && e.deltaY > 0) armPlunge(e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? metrics.vh : 1));
}, { passive: true });

// Touch: only a fresh touch that starts at the very bottom, with the hint already up
addEventListener('touchstart', (e) => {
    touchY = !plunging && hintShown && atBottom() && e.touches.length === 1 ? e.touches[0].clientY : null;
}, { passive: true });
addEventListener('touchmove', (e) => {
    if (plunging || touchY === null) return;
    const y = e.touches[0].clientY;
    const dy = touchY - y;
    touchY = y;
    if (scrollY > metrics.maxScroll) return; // rubber-band overscroll is the page bouncing, not a request
    if (dy < 0) plungeArm = 0;
    else armPlunge(dy * 2);
}, { passive: true });
const endTouch = () => { touchY = null; };
addEventListener('touchend', endTouch, { passive: true });
addEventListener('touchcancel', endTouch, { passive: true });

// While falling the page can't scroll, and any deliberate input brings you back
const sinceStart = () => performance.now() - plungeStartedAt;
function blockTouch(e) {
    // A swipe already scrolling when the plunge began can't be cancelled; the overflow lock covers it
    if (e.cancelable && (!plungeEnd || !plungeEnd.contains(e.target))) e.preventDefault();
}
function onPlungeWheel(e) {
    e.preventDefault();
    if (e.deltaY < 0 && sinceStart() > 600) stopPlunge('abort');
}
function onPlungePointer(e) {
    if ((plungeEnd && plungeEnd.contains(e.target)) || sinceStart() < 600) return;
    stopPlunge('abort');
}
function onPlungeKey(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        stopPlunge('abort');
        return;
    }
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    if (endCardShown() && ['Tab', 'Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    // The key that started it (or a held one) never ends it straight away
    if (e.repeat || sinceStart() < 600) return;
    stopPlunge('abort');
}

function startPlunge({ source = 'scroll' } = {}) {
    if (!plungeReady() || paletteOpen) return false;
    exitLook('plunge');
    hidePlungeEnd(true);
    plunging = true;
    plungeArm = 0;
    touchY = null;
    setOffset(0);
    plungeStartedAt = performance.now();
    if (warpReason) setWarp(false, warpReason);
    clearTimeout(returnTimer);
    root.classList.remove('is-plunge-returning');
    root.classList.add('is-plunging');
    hideBackChip();
    clearTarget();
    releaseSceneFocus(true);
    syncPlungeHint();
    updateCaption();
    setPageInert(true);
    if (plungeEnd) plungeEnd.setAttribute('aria-modal', 'true');
    addEventListener('wheel', onPlungeWheel, { passive: false });
    addEventListener('touchmove', blockTouch, { passive: false });
    addEventListener('pointerdown', onPlungePointer);
    addEventListener('keydown', onPlungeKey);
    announce('Falling into the black hole, about 25 seconds. Press Escape to return.');
    emit('space:plunge', { active: true, reason: source });
    sendEvent('event_horizon', { action: 'start', method: source });
    return true;
}

function stopPlunge(reason) {
    if (!plunging) return;
    plunging = false;
    plungeArm = 0;
    root.classList.remove('is-plunging');
    removeEventListener('wheel', onPlungeWheel);
    removeEventListener('touchmove', blockTouch);
    removeEventListener('pointerdown', onPlungePointer);
    removeEventListener('keydown', onPlungeKey);
    // Hand the page back at once, so Escape returns control immediately
    setPageInert(false);
    if (plungeEnd) plungeEnd.removeAttribute('aria-modal');
    const instant = reason === 'lite' || reason === 'fallback';
    hidePlungeEnd(instant);
    if (!instant) {
        // The content fades back in step with the camera flying out (until space:plunge-done)
        root.classList.add('is-plunge-returning');
        clearTimeout(returnTimer);
        returnTimer = setTimeout(endPlungeReturn, 1600);
    }
    if (contactTitle) {
        // Not yet seen (the page went straight to the bottom): shown at rest, not rising in under the nav
        const head = contactTitle.closest('[data-reveal]');
        if (head) settleReveal(head);
        focusHeading(contactTitle);
        // At the very bottom the heading can sit under the fixed nav (or above the viewport):
        // bring it clear, below the nav (scroll-padding-top), so the focus can be seen
        const r = contactTitle.getBoundingClientRect();
        if (r.top < (hud ? hud.getBoundingClientRect().bottom : 0) || r.bottom > innerHeight) {
            root.style.scrollBehavior = 'auto';
            contactTitle.scrollIntoView({ block: 'start' });
            root.style.scrollBehavior = '';
        }
    }
    emit('space:plunge', { active: false, reason });
    syncPlungeHint();
    updateCaption();
}

function endPlungeReturn() {
    clearTimeout(returnTimer);
    root.classList.remove('is-plunge-returning');
}

// The end card fades out and is hidden when its fade ends (at once for lite mode and fallbacks)
function hidePlungeEnd(instant) {
    cancelAnimationFrame(endShowRaf);
    if (!plungeEnd || plungeEnd.hidden) return;
    clearTimeout(endHideTimer);
    const done = () => {
        clearTimeout(endHideTimer);
        plungeEnd.removeEventListener('transitionend', onFaded);
        // Hidden whenever the fall is over, even if a late fade-in slipped in meanwhile
        if (!plunging || !plungeEnd.classList.contains('is-visible')) {
            plungeEnd.classList.remove('is-visible');
            plungeEnd.hidden = true;
        }
    };
    function onFaded(e) { if (e.target === plungeEnd && e.propertyName === 'opacity') done(); }
    plungeEnd.inert = true;
    plungeEnd.classList.remove('is-visible');
    if (instant) return done();
    plungeEnd.addEventListener('transitionend', onFaded);
    endHideTimer = setTimeout(done, 1600);
}

// The palette command: scroll down to the black hole, let the camera settle, then fall in
function plungeFromCommand(source) {
    // Never inside the keydown that chose it: the plunge's own key handler would see that key
    setTimeout(async () => {
        if (!plungeReady()) return;
        if (!atBottom()) {
            const t0 = performance.now();
            if (flies() && isFar(contactTitle || root)) startNavWarp();
            scrollTo({ top: root.scrollHeight, behavior: flies() ? 'smooth' : 'auto' });
            await scrollSettled(3000);
            await new Promise((r) => setTimeout(r, Math.max(400, 1200 - (performance.now() - t0))));
            if (!atBottom() || paletteOpen) return; // the visitor went somewhere else meanwhile
        }
        startPlunge({ source });
    }, 0);
}

if (plungeHint) {
    plungeHint.addEventListener('click', () => startPlunge({ source: 'button' }));
    // Reached with Tab before the page is at the bottom: finish the scroll, so the fall starts from there
    plungeHint.addEventListener('focus', () => {
        if (atBottom()) return;
        root.style.scrollBehavior = 'auto';
        scrollTo(0, metrics.maxScroll);
        root.style.scrollBehavior = '';
    });
}

function phaseFor(r) {
    if (r <= 0.12) return 'Tidal forces';
    if (r <= 1) return 'Inside the event horizon';
    if (r <= 1.5) return 'Inside the photon sphere';
    if (r <= 3) return 'Past the last stable orbit';
    return 'Free fall';
}

addEventListener('space:plunge-state', (e) => {
    const { r, beta } = e.detail;
    if (plungeR) plungeR.innerHTML = `r = ${r < 10 ? r.toFixed(2) : r.toFixed(1)} r<sub>s</sub>`;
    if (plungeV) plungeV.textContent = r > 1 ? `v = ${beta.toFixed(2)} c` : 'no way back out';
    if (plungePhase) plungePhase.textContent = phaseFor(r);
});

addEventListener('space:plunge-end', () => {
    if (!plunging || !plungeEnd) return;
    clearTimeout(endHideTimer);
    plungeEnd.inert = false;
    plungeEnd.hidden = false;
    // Next frame, so it fades in; an exit in the same frame cancels it (hidePlungeEnd)
    cancelAnimationFrame(endShowRaf);
    endShowRaf = requestAnimationFrame(() => {
        if (plunging && !plungeEnd.hidden) plungeEnd.classList.add('is-visible');
    });
    if (plungeExit) plungeExit.focus({ preventScroll: true });
    sendEvent('event_horizon', { action: 'singularity' });
});
addEventListener('space:plunge-done', endPlungeReturn);
if (plungeExit) plungeExit.addEventListener('click', () => stopPlunge('exit'));

/* ---------- 18. Scene caption + free look (palette only) ---------- */

const sceneCaption = document.getElementById('scene-caption');
const CAPTIONS = {
    planet: 'Earth and the Moon',
    nebula: 'Emission nebula',
    'gas-giant': 'Ringed gas giant',
    star: 'Blue-white star',
    galaxy: 'Spiral galaxy',
    'black-hole': 'Black hole',
};

function updateCaption() {
    if (!sceneCaption) return;
    const sec = sections[Journey.index];
    const name = sec && CAPTIONS[sec.dataset.scene];
    const show = !!name && isFull() && sceneState === 'ready' && !Journey.warp && !plunging;
    if (show && sceneCaption.textContent !== `Now passing · ${name}`) sceneCaption.textContent = `Now passing · ${name}`;
    if (sceneCaption.hidden === show) sceneCaption.hidden = !show;
}

const lookExit = document.getElementById('look-exit');
let looking = false;
let lookY = 0;
let lookReturn = null;

function onLookKey(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        exitLook('escape');
    } else if ((e.key || '').startsWith('Arrow')) {
        // The scene turns the camera on the arrow keys; the page mustn't scroll underneath
        e.preventDefault();
    }
}
const onLookWheel = () => exitLook('scroll');

function enterLook(returnTo) {
    if (looking || !sceneCanTurn() || plunging || paletteOpen) return;
    looking = true;
    lookY = scrollY;
    lookReturn = returnTo && returnTo !== document.body && returnTo !== lookExit ? returnTo : null;
    if (warpReason) setWarp(false, warpReason);
    hideBackChip();
    clearTarget();
    releaseSceneFocus(true);
    root.classList.add('is-viewing');
    setPageInert(true);
    syncPlungeHint();
    addEventListener('keydown', onLookKey);
    addEventListener('wheel', onLookWheel, { passive: true });
    if (lookExit) {
        lookExit.hidden = false;
        lookExit.focus({ preventScroll: true });
    }
    emit('space:look', { active: true });
}

function exitLook(reason) {
    if (!looking) return;
    looking = false;
    root.classList.remove('is-viewing');
    setPageInert(false);
    removeEventListener('keydown', onLookKey);
    removeEventListener('wheel', onLookWheel);
    const back = lookReturn;
    lookReturn = null;
    const hadFocus = lookExit && lookExit.contains(document.activeElement);
    if (lookExit) lookExit.hidden = true;
    emit('space:look', { active: false });
    if (hadFocus && reason !== 'plunge' && back && back.isConnected) back.focus({ preventScroll: true });
    syncPlungeHint();
}

if (lookExit) lookExit.addEventListener('click', () => exitLook('button'));

/* ---------- 19. Case-study pages: the card title morphs into the page header ---------- */

document.addEventListener('click', (e) => {
    const a = e.target.closest('a.case-link');
    if (!a || e.defaultPrevented || !plainClick(e)) return;
    // Exactly one element may carry the name, or the browser drops the transition
    document.querySelectorAll('.case h3').forEach((h) => { h.style.viewTransitionName = ''; });
    const card = a.closest('.case');
    const title = card && card.querySelector('h3');
    if (title) title.style.viewTransitionName = 'case-title';
});

// Lite mode: page changes stay instant (the head script skips the incoming side, pagereveal).
// Skipping rejects the transition's ready promise; it's handled, so it never logs as an error.
addEventListener('pageswap', (e) => {
    if (isFull() || !e.viewTransition) return;
    e.viewTransition.ready.catch(() => {});
    e.viewTransition.skipTransition();
});

/* ---------- 20. 3D scene bridge ---------- */

let sceneState = 'idle'; // idle | loading | ready | failed
let fallbackReason = null;
let preloaded = false;
let readySent = false;
let fallbackSent = false;
let lastTier = null;

// Fetch the scene's entry point while the page settles (boot.js preloads the rest itself)
function preloadScene() {
    if (preloaded) return;
    preloaded = true;
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = new URL(SCENE_SRC, import.meta.url).href;
    link.setAttribute('fetchpriority', 'low');
    document.head.appendChild(link);
}

function loadScene() {
    // After a performance fallback the scene is still there: space:motion 'full' revives it at the lowest tier
    if (sceneState === 'failed' && fallbackReason === 'perf') { sceneState = 'loading'; return; }
    if (sceneState !== 'idle' || !isFull()) return;
    sceneState = 'loading';
    preloadScene();
    const go = () => {
        // Switched to lite while waiting: try again when 3D is turned back on
        if (!isFull()) { sceneState = 'idle'; return; }
        if (performance.mark) performance.mark('space:load-start');
        import(SCENE_SRC)
            .then((mod) => mod.start({ canvas: document.getElementById('space-canvas') }))
            .catch((err) => {
                console.warn('3D scene unavailable, using the static backdrop.', err);
                emit('space:fallback', { reason: 'load-failed' });
            });
    };
    // One frame after first paint, then the fonts (at most 1.5 s), then the first idle moment.
    // Not window 'load', which also waits for analytics and images.
    requestAnimationFrame(() => setTimeout(() => {
        const waits = [new Promise((resolve) => setTimeout(resolve, 1500))];
        if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready);
        Promise.race(waits).then(() => whenIdle(go, 450));
    }, 0));
}

addEventListener('space:ready', (e) => {
    const d = e.detail || {};
    sceneState = 'ready';
    fallbackReason = null;
    root.classList.add('scene-ready');
    root.classList.remove('scene-failed');
    if (d.tier) root.dataset.spaceTier = d.tier;
    if (d.post) root.dataset.spacePost = d.post;
    // Replay current state for a scene that subscribed late
    const sec = sections[Journey.index];
    if (sec) emit('space:section', { id: sec.id, index: Journey.index, scene: sec.dataset.scene, prevId: null, direction: 1 });
    emitMotion('system');
    syncPlungeHint();
    updateCaption();
    if (!d.revival && !readySent) {
        readySent = true;
        const params = { tier: d.tier, motion: root.dataset.motion };
        if (d.post) params.post = d.post;
        if (typeof d.probeMs === 'number') params.probe_ms = Math.round(d.probeMs);
        sendEvent('scene_ready', params);
    }
    if (d.tier) lastTier = d.tier;
});

addEventListener('space:tier', (e) => {
    const d = e.detail || {};
    if (d.tier) root.dataset.spaceTier = d.tier;
    if (d.post) root.dataset.spacePost = d.post;
    // Telemetry: tier names that change after the boot probe (resolution-only steps don't count)
    if (d.kind === 'scale' || !d.tier || sceneState !== 'ready') return;
    if (lastTier && d.tier !== lastTier) sendEvent('tier_change', { from: lastTier, to: d.tier });
    lastTier = d.tier;
});

addEventListener('space:fallback', (e) => {
    const reason = (e.detail && e.detail.reason) || 'unknown';
    sceneState = 'failed';
    fallbackReason = reason;
    stopPlunge('fallback');
    exitLook('fallback');
    releaseSceneFocus(true);
    root.classList.remove('scene-ready');
    root.classList.add('scene-failed');
    syncPlungeHint();
    updateCaption();
    if (!fallbackSent) {
        fallbackSent = true;
        sendEvent('scene_fallback', { reason });
    }
    if (reason !== 'perf') return;
    // A device that can't hold frame rate gets lite mode for this session only (not persisted), and is told once
    setMotion('lite', 'system');
    if (readSession('space.perfNotice')) return;
    writeSession('space.perfNotice', '1');
    toast('Switched to the lighter version to keep scrolling smooth.', 'Turn off Lite mode to bring the 3D back.', {
        ms: 6000,
        say: 'Switched to the lighter version to keep scrolling smooth. Turn off Lite mode to bring the 3D back.',
    });
});

/* ---------- 21. Boot ---------- */

measure();
frame(performance.now());
loadScene();
if (typewriter && isFull()) typewriter.start();

// Arriving on a case-study link (#ml-…): mark the card once it's in place
const hashCard = /^#ml-/.test(location.hash) ? document.getElementById(location.hash.slice(1)) : null;
if (hashCard && hashCard.matches('.case')) expectLanding(hashCard);
