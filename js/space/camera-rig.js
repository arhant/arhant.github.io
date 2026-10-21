/* Camera on a spline anchored to page sections.
   s = Journey.index + eased(Journey.progress); the dwell easing slows the
   camera mid-section (while you read) and speeds it up between sections.
   We damp s, not the position, so the camera can never leave the path. */
import * as THREE from 'three';
import { KEYS, ORIGINS, FRAMES, GRADES, FOCUS } from './path-data.js';
import { damp, clamp, smoothstep, lerp } from './lib/math.js';

const DWELL = 0.6;

export class CameraRig {
    constructor(camera) {
        this.camera = camera;
        const toWorld = (k, v) => {
            const p = new THREE.Vector3(...v);
            if (FRAMES[k.rel]) p.applyEuler(new THREE.Euler(...FRAMES[k.rel]));
            return p.add(new THREE.Vector3(...ORIGINS[k.rel]));
        };
        const curve = (pick) => new THREE.CatmullRomCurve3(KEYS.map((k) => toWorld(k, pick(k))), false, 'centripetal');
        this.posCurve = curve((k) => k.pos);
        this.lookCurve = curve((k) => k.look);
        // Portrait variants (fall back to the landscape shot where a key has none)
        this.pPosCurve = curve((k) => k.pPos || k.pos);
        this.pLookCurve = curve((k) => k.pLook || k.look);
        this._pp = new THREE.Vector3();
        this._pl = new THREE.Vector3();
        this.keyS = KEYS.map((k) => k.s);
        this.keyFov = KEYS.map((k) => k.fov);

        this.s = null;
        this.warp = 0;
        this.warpTarget = 0;
        this.velocity = new THREE.Vector3();
        this.speed = 0;
        this.grade = { exposure: 1, bloom: 0.7, vignette: 0.35 };

        this._p = new THREE.Vector3();
        this._l = new THREE.Vector3();
        this._prev = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._up = new THREE.Vector3();
        this._fwd = new THREE.Vector3();
        this._focus = new THREE.Vector3();
        this._focusTarget = new THREE.Vector3();
        this._galaxy = new THREE.Vector3(...ORIGINS.galaxy);

        this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
        this.parallax = matchMedia('(hover: hover) and (pointer: fine)');
        addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'mouse') return;
            this.pointer.tx = (e.clientX / innerWidth - 0.5) * 2;
            this.pointer.ty = (e.clientY / innerHeight - 0.5) * 2;
        }, { passive: true });
    }

    static targetS(J) {
        const u = clamp(J.progress, 0, 1);
        return J.index + u + (DWELL / (2 * Math.PI)) * Math.sin(2 * Math.PI * u);
    }

    setWarp(active) { this.warpTarget = active ? 1 : 0; }

    setFocus(id) {
        const f = id && FOCUS[id];
        if (f) this._focusTarget.set(f[0], f[1], f[2]);
        else this._focusTarget.set(0, 0, 0);
    }

    curveParam(s) {
        const ks = this.keyS;
        const n = ks.length;
        if (s <= ks[0]) return { t: 0, k: 0, f: 0 };
        if (s >= ks[n - 1]) return { t: 1, k: n - 2, f: 1 };
        let k = 0;
        while (k < n - 2 && s >= ks[k + 1]) k++;
        const f = (s - ks[k]) / (ks[k + 1] - ks[k]);
        return { t: (k + f) / (n - 1), k, f };
    }

    gradeAt(s) {
        const x = clamp(s - 0.5, 0, GRADES.length - 1);
        const i = Math.min(GRADES.length - 2, Math.floor(x));
        const t = smoothstep(0, 1, x - i);
        const a = GRADES[i];
        const b = GRADES[i + 1];
        this.grade.exposure = lerp(a.exposure, b.exposure, t);
        this.grade.bloom = lerp(a.bloom, b.bloom, t);
        this.grade.vignette = lerp(a.vignette, b.vignette, t);
        return this.grade;
    }

    /* Jump straight to the current target (first frame, deep links) */
    snap(J) {
        this.s = CameraRig.targetS(J);
        this.update(0, 0, J);
        this._prev.copy(this.camera.position);
        this.velocity.set(0, 0, 0);
    }

    update(dt, t, J, opts = {}) {
        const cam = this.camera;
        const target = CameraRig.targetS(J);
        if (this.s === null) this.s = target;

        // Warp is a spring: quick rise, slow fall
        this.warp = damp(this.warp, this.warpTarget, this.warpTarget > this.warp ? 1 / 0.35 * 2.3 : 1 / 0.9 * 2.3, dt);
        const lambda = this.warp > 0.1 ? 14 : 6;
        this.s = dt > 0 ? damp(this.s, target, lambda, dt) : target;

        const { t: ct, k, f } = this.curveParam(this.s);
        this.posCurve.getPoint(ct, this._p);
        this.lookCurve.getPoint(ct, this._l);
        const portrait = smoothstep(1.0, 0.75, cam.aspect);
        if (portrait > 0) {
            this.pPosCurve.getPoint(ct, this._pp);
            this.pLookCurve.getPoint(ct, this._pl);
            this._p.lerp(this._pp, portrait);
            this._l.lerp(this._pl, portrait);
        }

        // Mission Log focus nudges, only around the galaxy
        const inGalaxy = smoothstep(3.6, 4.0, this.s) * (1 - smoothstep(4.9, 5.1, this.s));
        this._focus.lerp(this._focusTarget, 1 - Math.exp(-2 * dt));
        this._l.addScaledVector(this._focus, inGalaxy);

        // Field of view: keyframed, widened during warp, compensated on portrait screens
        const fa = this.keyFov[k];
        const fb = this.keyFov[Math.min(k + 1, this.keyFov.length - 1)];
        let fov = lerp(fa, fb, smoothstep(0, 1, f)) + 14 * this.warp;
        const aspect = cam.aspect;
        if (aspect < 1) {
            const minH = THREE.MathUtils.degToRad(50);
            const need = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minH / 2) / aspect));
            fov = Math.max(fov, Math.min(need, 100));
        }
        if (Math.abs(cam.fov - fov) > 1e-3) {
            cam.fov = fov;
            cam.updateProjectionMatrix();
        }

        // Pointer parallax + idle breathing (fine pointers, full motion only)
        const p = this.pointer;
        p.x = damp(p.x, p.tx, 3, dt);
        p.y = damp(p.y, p.ty, 3, dt);
        const dist = this._p.distanceTo(this._l);
        const amp = this.parallax.matches && !opts.still ? 0.015 * dist : 0;
        this._fwd.subVectors(this._l, this._p).normalize();
        this._right.crossVectors(this._fwd, cam.up).normalize();
        this._up.crossVectors(this._right, this._fwd).normalize();
        const breathe = opts.still ? 0 : Math.sin(t * 0.3) * 0.003 * dist;
        this._p.addScaledVector(this._right, p.x * amp).addScaledVector(this._up, -p.y * amp * 0.6 + breathe);
        this._l.addScaledVector(this._right, p.x * amp * 0.3).addScaledVector(this._up, -p.y * amp * 0.18);

        cam.position.copy(this._p);
        cam.lookAt(this._l);
        cam.updateMatrixWorld();

        if (dt > 0) {
            const v = this._right.subVectors(cam.position, this._prev).divideScalar(dt);
            this.velocity.lerp(v, 1 - Math.exp(-10 * dt));
            this.speed = this.velocity.length();
        }
        this._prev.copy(cam.position);
        this.gradeAt(this.s);
        return this.s;
    }
}
