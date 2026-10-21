/* Feeds the FinalPass readability mask: the largest visible [data-readable]
   blocks as rounded rects in drawing-buffer pixels (origin bottom-left).
   Document rects are cached; per frame only scrollY is read. */
import { MAX_RECTS } from './shaders/final.glsl.js';

export class Readability {
    constructor() {
        this.els = [...document.querySelectorAll('[data-readable]')];
        this.rects = this.els.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
        this.visible = [];
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

    update(uniforms, dpr) {
        if (!uniforms) return;
        const sy = scrollY;
        const vh = innerHeight;
        const vis = this.visible;
        vis.length = 0;
        for (let i = 0; i < this.rects.length; i++) {
            const r = this.rects[i];
            const top = r.y - sy;
            if (top + r.h < 0 || top > vh || r.w === 0) continue;
            const area = r.w * (Math.min(vh, top + r.h) - Math.max(0, top));
            vis.push(i, area);
        }
        // Pick the largest visible blocks (insertion sort over pairs; the list is tiny)
        const order = [];
        for (let k = 0; k < vis.length; k += 2) order.push(k);
        order.sort((a, b) => vis[b + 1] - vis[a + 1]);

        const out = uniforms.uRects.value;
        const n = Math.min(MAX_RECTS, order.length);
        for (let j = 0; j < n; j++) {
            const r = this.rects[vis[order[j]]];
            const top = r.y - sy;
            out[j].set(
                (r.x + r.w / 2) * dpr,
                (vh - (top + r.h / 2)) * dpr,
                (r.w / 2) * dpr,
                (r.h / 2) * dpr,
            );
        }
        uniforms.uRectCount.value = n;
    }

    dispose() {
        if (this.ro) this.ro.disconnect();
    }
}
