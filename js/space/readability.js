/* Feeds the FinalPass readability mask: the largest visible [data-readable]
   blocks as rounded rects in drawing-buffer pixels (origin bottom-left).
   Panels get a tight mask (it stays under the panel, so no visible halo);
   free-standing text gets a wide, soft falloff. Each block's weight follows
   its reveal animation, so the scene never dims where nothing is shown yet.
   Document rects are cached; per frame only scrollY and classList are read. */
import { MAX_RECTS } from './shaders/final.glsl.js';

export class Readability {
    constructor() {
        this.root = document.documentElement;
        this.els = [...document.querySelectorAll('[data-readable]')];
        this.rects = this.els.map((el) => ({
            x: 0, y: 0, w: 0, h: 0,
            soft: !el.classList.contains('panel'),
            reveal: el.hasAttribute('data-reveal'),
            weight: 0,
        }));
        this.visible = [];
        this.order = [];
        this.measure = this.measure.bind(this);
        this.queued = false;
        const queue = () => {
            if (this.queued) return;
            this.queued = true;
            requestAnimationFrame(() => { this.queued = false; this.measure(); });
        };
        addEventListener('resize', queue, { passive: true });
        if ('ResizeObserver' in window) {
            this.ro = new ResizeObserver(queue);
            this.ro.observe(document.querySelector('main') || document.body);
        }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(queue);
        this.measure();
    }

    measure() {
        const y = scrollY;
        this.els.forEach((el, i) => {
            const r = el.getBoundingClientRect();
            const o = this.rects[i];
            o.x = r.left;
            o.y = r.top + y;
            o.w = r.width;
            o.h = r.height;
        });
    }

    update(uniforms, dpr, dt) {
        if (!uniforms) return;
        const sy = scrollY;
        const vh = innerHeight;
        const animating = this.root.classList.contains('reveal-ready');
        const k = 1 - Math.exp(-6 * dt);
        const vis = this.visible;
        vis.length = 0;
        for (let i = 0; i < this.rects.length; i++) {
            const r = this.rects[i];
            const shown = !r.reveal || !animating || this.els[i].classList.contains('is-revealed');
            r.weight += ((shown ? 1 : 0) - r.weight) * (dt > 0 ? k : 1);
            const top = r.y - sy;
            if (top + r.h < -120 || top > vh + 120 || r.w === 0 || r.weight < 0.01) continue;
            const area = r.w * (Math.min(vh, top + r.h) - Math.max(0, top));
            vis.push(i, area);
        }
        const order = this.order;
        order.length = 0;
        for (let j = 0; j < vis.length; j += 2) order.push(j);
        order.sort((a, b) => vis[b + 1] - vis[a + 1]);

        const out = uniforms.uRects.value;
        const params = uniforms.uRectParams.value;
        const n = Math.min(MAX_RECTS, order.length);
        for (let j = 0; j < n; j++) {
            const r = this.rects[vis[order[j]]];
            const top = r.y - sy;
            out[j].set((r.x + r.w / 2) * dpr, (vh - (top + r.h / 2)) * dpr, (r.w / 2) * dpr, (r.h / 2) * dpr);
            params[j].set(r.soft ? 1 : 0, r.weight);
        }
        uniforms.uRectCount.value = n;
    }

    dispose() {
        if (this.ro) this.ro.disconnect();
    }
}
