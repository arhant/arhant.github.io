/* Feeds the FinalPass readability mask: the largest visible [data-readable]
   blocks as rounded rects in drawing-buffer pixels (origin bottom-left).
   Panels get a tight mask (it stays under the panel, so no visible halo);
   free-standing text gets a wide, soft falloff, stronger behind section
   headings (large type over the brightest set pieces) than in the hero, where
   the Earth should stay bright. While html[data-glass] is set,
   an on-screen [data-glass-panel] gets a reserved slot as a frosted-glass rect.
   Each block's weight follows its reveal animation, staggered delay included,
   so the scene never dims where nothing is shown yet.
   Also hands the camera the Contact panel's viewport rect (frame.contact).
   Document rects are cached at each block's resting place (a block that hasn't
   made its entrance yet still carries the reveal offset, which is taken out);
   per frame only scrollY and classList are read. */
import { MAX_RECTS, RECT_PANEL, RECT_SOFT, RECT_GLASS } from './shaders/final.glsl.js';

const MAX_GLASS = 2;
// Soft-shade strength (the shader's per-rect cap): section headings vs. other free-standing text
const SOFT_HEAD = 0.9;
const SOFT_TEXT = 0.7;

// An element's current translate in px ('none', 'x' or 'x y'), so the rest position can be recovered
function translateOf(el) {
    const t = getComputedStyle(el).translate;
    if (!t || t === 'none') return [0, 0];
    const [x, y] = t.split(' ');
    return [parseFloat(x) || 0, parseFloat(y) || 0];
}

// A CSS time ('80ms', '0.3s') in milliseconds
function parseTime(value) {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return 0;
    return /ms\s*$/.test(value) ? n : n * 1000;
}

export class Readability {
    constructor() {
        this.root = document.documentElement;
        this.els = [...document.querySelectorAll('[data-readable], [data-glass-panel]')];
        this.rects = this.els.map((el) => ({
            x: 0, y: 0, w: 0, h: 0, radius: 0,
            soft: !el.classList.contains('panel'),
            strength: el.classList.contains('section-head') ? SOFT_HEAD : SOFT_TEXT,
            glass: el.hasAttribute('data-glass-panel'),
            reveal: el.hasAttribute('data-reveal'),
            weight: 0,
            showAt: -1, // when a revealed block may start masking (its reveal delay); -1 until it's revealed
        }));
        const contact = document.querySelector('.contact');
        this.contact = contact ? { el: contact, x: 0, y: 0, w: 0, h: 0 } : null;
        this.contactView = { x: 0, y: 0, w: 0, h: 0 };
        this.visible = [];
        this.order = [];
        this.glassSlots = [];
        this.radiiStale = true;
        this.measure = this.measure.bind(this);
        this.queued = false;
        const queue = () => {
            if (this.queued) return;
            this.queued = true;
            requestAnimationFrame(() => { this.queued = false; this.measure(); });
        };
        // Corner radii only change with the viewport (media queries), so they're re-read on resize only
        addEventListener('resize', () => { this.radiiStale = true; queue(); }, { passive: true });
        if ('ResizeObserver' in window) {
            this.ro = new ResizeObserver(queue);
            this.ro.observe(document.querySelector('main') || document.body);
        }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(queue);
        // Belt and braces for the resting positions: measure again as each entrance ends
        document.addEventListener('animationend', (e) => {
            if (e.target instanceof Element && e.target.hasAttribute('data-reveal')) queue();
        });
        this.measure();
    }

    measure() {
        const y = scrollY;
        const radii = this.radiiStale;
        this.radiiStale = false;
        this.els.forEach((el, i) => {
            const r = el.getBoundingClientRect();
            const [tx, ty] = translateOf(el);
            const o = this.rects[i];
            o.x = r.left - tx;
            o.y = r.top + y - ty;
            o.w = r.width;
            o.h = r.height;
            if (radii) o.radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        });
        const c = this.contact;
        if (c) {
            const r = c.el.getBoundingClientRect();
            const [tx, ty] = translateOf(c.el);
            c.x = r.left - tx;
            c.y = r.top + y - ty;
            c.w = r.width;
            c.h = r.height;
        }
    }

    // Viewport CSS-px rect of the Contact panel while any of it is on screen, else null
    contactRect(sy, vh) {
        const c = this.contact;
        if (!c || c.w === 0) return null;
        const top = c.y - sy;
        if (top >= vh || top + c.h <= 0) return null;
        const v = this.contactView;
        v.x = c.x;
        v.y = top;
        v.w = c.w;
        v.h = c.h;
        return v;
    }

    /* Should block i mask now? A revealed block waits out its --reveal-delay (read once, when it is
       first seen revealed) so the shade never leads a staggered card; .no-anim blocks mask at once. */
    shown(i, r, animating, now) {
        if (!r.reveal || !animating) return true;
        const el = this.els[i];
        if (!el.classList.contains('is-revealed')) return false;
        if (r.showAt < 0) {
            const instant = el.classList.contains('no-anim');
            r.showAt = now + (instant ? 0 : parseTime(getComputedStyle(el).getPropertyValue('--reveal-delay')));
            if (instant) r.weight = 1;
        }
        return now >= r.showAt;
    }

    update(uniforms, dpr, dt, frame) {
        const sy = scrollY;
        const vh = innerHeight;
        // The camera frames Contact on every path, including the direct one that has no shader mask
        if (frame) frame.contact = this.contactRect(sy, vh);
        if (!uniforms) return;
        const now = performance.now();
        const animating = this.root.classList.contains('reveal-ready');
        const glassOn = this.root.hasAttribute('data-glass');
        const k = dt > 0 ? 1 - Math.exp(-6 * dt) : 1;
        const vis = this.visible;
        const glass = this.glassSlots;
        vis.length = 0;
        glass.length = 0;
        for (let i = 0; i < this.rects.length; i++) {
            const r = this.rects[i];
            r.weight += ((this.shown(i, r, animating, now) ? 1 : 0) - r.weight) * k;
            const top = r.y - sy;
            if (top + r.h < -120 || top > vh + 120 || r.w === 0 || r.weight < 0.01) continue;
            // Glass slots are reserved ahead of the area sort, but only while the panel is actually on screen
            if (glassOn && r.glass && glass.length < MAX_GLASS && top < vh && top + r.h > 0) {
                glass.push(i);
                continue;
            }
            const area = r.w * (Math.min(vh, top + r.h) - Math.max(0, top));
            vis.push(i, area);
        }
        const order = this.order;
        order.length = 0;
        for (let j = 0; j < vis.length; j += 2) order.push(j);
        order.sort((a, b) => vis[b + 1] - vis[a + 1]);

        let n = 0;
        for (let j = 0; j < glass.length; j++) this.write(uniforms, n++, this.rects[glass[j]], RECT_GLASS, sy, vh, dpr);
        for (let j = 0; j < order.length && n < MAX_RECTS; j++) {
            const r = this.rects[vis[order[j]]];
            this.write(uniforms, n++, r, r.soft ? RECT_SOFT : RECT_PANEL, sy, vh, dpr);
        }
        uniforms.uRectCount.value = n;
    }

    // uRectParams: mode, weight, then the corner radius (panels) or the shade strength (soft rects)
    write(uniforms, n, r, mode, sy, vh, dpr) {
        const top = r.y - sy;
        uniforms.uRects.value[n].set((r.x + r.w / 2) * dpr, (vh - (top + r.h / 2)) * dpr, (r.w / 2) * dpr, (r.h / 2) * dpr);
        uniforms.uRectParams.value[n].set(mode, r.weight, mode === RECT_SOFT ? r.strength : Math.min(r.radius, r.w / 2, r.h / 2));
    }

    dispose() {
        if (this.ro) this.ro.disconnect();
    }
}
