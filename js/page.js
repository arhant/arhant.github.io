/* ==========================================================================
   Arhant Jain: standalone pages (/work/<slug>/ and /black-hole/)

   A classic script in <head> (not a module, not deferred), so the pagereveal
   listener exists before the first rendering opportunity. It owns three small
   things and nothing heavy:
     1. Cross-document view transitions are skipped in lite mode, on the way
        out (pageswap) and on the way in (pagereveal).
     2. The motion toggle: same localStorage 'motion' key and aria-pressed
        semantics as the homepage. These pages never load the 3D scene, so here
        it only switches page transitions and CSS animations.
     3. Email links copy the address with a toast and a live-region message,
        falling back to the mail app; without JS they stay plain mailto links.
   ========================================================================== */
(function () {
    'use strict';

    const root = document.documentElement;
    const EMAIL = 'arhant@nyu.edu';
    const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const isFull = () => root.dataset.motion === 'full';

    /* ---------- 1. View transitions: lite mode never animates ---------- */

    // Skipping on either side cancels the transition, so a lite choice is honoured
    // whichever page the visitor made it on. Skipping rejects the ready promise:
    // it's handled first, so it never logs as an unhandled error.
    const skipInLite = (e) => {
        if (!e.viewTransition || isFull()) return;
        e.viewTransition.ready.catch(() => {});
        e.viewTransition.skipTransition();
    };
    window.addEventListener('pageswap', skipInLite);
    window.addEventListener('pagereveal', skipInLite);

    /* ---------- 2. Motion mode ---------- */

    let motionBtn = null;

    function storedMotion() {
        try { return localStorage.getItem('motion'); } catch (e) { return null; }
    }

    function syncMotionButton() {
        if (!motionBtn) return;
        motionBtn.setAttribute('aria-pressed', String(!isFull()));
        // The name stays put; the tooltip says which mode is on now (same pattern as the homepage)
        motionBtn.title = isFull()
            ? 'Animations on. Switch to lite mode'
            : 'Lite mode on. Switch animations back on';
    }

    function setMotion(mode, source) {
        if (mode === root.dataset.motion) return;
        root.dataset.motion = mode;
        if (source === 'user') {
            try { localStorage.setItem('motion', mode); } catch (e) { /* private mode */ }
        }
        syncMotionButton();
    }

    mqReduce.addEventListener('change', () => {
        const choice = storedMotion();
        if (choice !== 'full' && choice !== 'lite') setMotion(mqReduce.matches ? 'lite' : 'full', 'system');
    });

    // Back/forward cache: the choice may have changed on another page meanwhile
    window.addEventListener('pageshow', (e) => {
        if (!e.persisted) return;
        const choice = storedMotion();
        if (choice === 'full' || choice === 'lite') setMotion(choice, 'system');
    });

    /* ---------- 3. Email: clicking it copies the address, with a toast ---------- */

    let toastEl = null;
    let liveEl = null;
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

    async function copyEmail() {
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

    /* ---------- Wire up once the DOM exists ---------- */

    function init() {
        motionBtn = document.getElementById('motion-toggle');
        if (motionBtn) {
            motionBtn.hidden = false;
            syncMotionButton();
            motionBtn.addEventListener('click', () => setMotion(isFull() ? 'lite' : 'full', 'user'));
        }

        toastEl = document.getElementById('toast');
        liveEl = document.getElementById('live-status');
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

        // Same contact analytics as the homepage (only when GA is configured)
        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-track]');
            if (el && typeof window.gtag === 'function') window.gtag('event', 'contact_click', { method: el.dataset.track });
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
