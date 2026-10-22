/* Camera on a spline anchored to page sections.
   s = Journey.index + eased(Journey.progress); the dwell easing slows the
   camera mid-section (while you read) and speeds it up between sections.
   We spring s, not the position, so the camera can never leave the path.

   Layered on top of the path, in order: Mission Log focus nudges and free look
   (small yaw/pitch turns, never roll), pointer parallax and idle breathing, and
   at Contact a sideways slide of the frame (a view offset, not a camera move)
   that puts the black hole's shadow behind the Contact card. pose() skips all
   of them for poster captures. */
import * as THREE from 'three';
import { KEYS, ORIGINS, FRAMES, GRADES, FOCUS } from './path-data.js';
import { damp, clamp, smoothstep, lerp } from './lib/math.js';

const DWELL = 0.6;
const DEG = Math.PI / 180;

// s follows the page on a critically damped spring: calm at rest, tighter while warping
const OMEGA_REST = 10;
const OMEGA_WARP = 18;
// Field of view added at full warp (kept small: a wide FOV kick is a motion-sickness trigger)
const FOV_KICK = 3.5;
// Portrait screens keep at least this much horizontal field of view
const PORTRAIT_MIN_H = 50;
// Mission Log hover nudge: a slow turn of a few degrees toward the card's galaxy feature
const NUDGE_MAX = 3.5 * DEG;
const NUDGE_RATE = 1.1;
// Free look (palette only): a capped turn layered after the path, with inertia
const LOOK_YAW = 15 * DEG;
const LOOK_PITCH = 8 * DEG;
const LOOK_RATE = 2.5;
// Contact framing: where it fades in (section space) and how fast it eases on and off
const CONTACT_S = [5.35, 5.75];
const CONTACT_RATE = 3;
// Dev check (?debug): the view should never swing more than this in 0.1 s
const DEBUG = new URLSearchParams(location.search).has('debug');
const MAX_TURN = 90;

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
        this.sMin = this.keyS[0];
        this.sMax = this.keyS[this.keyS.length - 1];

        this.s = null;
        this.v = 0; // spring velocity of s (sections per second)
        this.warp = 0;
        this.warpTarget = 0;
        this.velocity = new THREE.Vector3();
        this.speed = 0;
        this.grade = { exposure: 1, bloom: 0.7, vignette: 0.35 };

        this._p = new THREE.Vector3();
        this._l = new THREE.Vector3();
        this._v = new THREE.Vector3();
        this._prev = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._up = new THREE.Vector3();
        this._fwd = new THREE.Vector3();
        this._galaxy = new THREE.Vector3(...ORIGINS.galaxy);
        this._hole = new THREE.Vector3(...ORIGINS.blackHole);

        // Focus nudge: the focused feature's world position (if focusOn) and the current turn in radians
        this._focusTarget = new THREE.Vector3();
        this.focusOn = false;
        this.nudge = { x: 0, y: 0 };
        // Free look: target and current offset in pointer convention (x right, y down, both -1..1)
        this.look = { on: false, x: 0, y: 0, tx: 0, ty: 0 };
        // Contact view offset: eased weight and the last aim point (the card's centre, NDC)
        this.shift = { k: 0, tx: 0, ty: 0 };
        this._dbg = { t: -1, sum: 0, dir: new THREE.Vector3(), target: 0, jump: false };

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

    /* Mission Log card focus: FOCUS[id] is a galaxy feature, relative to the galaxy origin */
    setFocus(id) {
        const f = id && FOCUS[id];
        this.focusOn = !!f;
        if (f) this._focusTarget.set(f[0], f[1], f[2]).add(this._galaxy);
    }

    /* Free look (palette action): the camera stays on the path and turns up to ±15° yaw, ±8° pitch */
    setFreeLook(on) {
        this.look.on = !!on;
        this.look.tx = 0;
        this.look.ty = 0;
    }

    /* x, y in -1..1 in pointer convention (x right, y down); ignored while free look is off */
    setLookTarget(x, y) {
        if (!this.look.on) return;
        this.look.tx = clamp(x, -1, 1);
        this.look.ty = clamp(y, -1, 1);
    }

    /* The plunge owns the camera and eases the view offset out itself. When the rig gets the camera
       back, its Contact offset eases in again from weight k (0 = no offset). */
    releaseOffset(k = 0) {
        this.shift.k = k;
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

    /* Path position (_p), look target (_l) and keyed field of view at s, portrait shots blended in */
    sample(s) {
        const aspect = this.camera.aspect;
        const { t: ct, k, f } = this.curveParam(s);
        this.posCurve.getPoint(ct, this._p);
        this.lookCurve.getPoint(ct, this._l);
        const portrait = smoothstep(1.0, 0.75, aspect);
        if (portrait > 0) {
            this.pPosCurve.getPoint(ct, this._pp);
            this.pLookCurve.getPoint(ct, this._pl);
            this._p.lerp(this._pp, portrait);
            this._l.lerp(this._pl, portrait);
        }
        const fa = this.keyFov[k];
        const fb = this.keyFov[Math.min(k + 1, this.keyFov.length - 1)];
        let fov = lerp(fa, fb, smoothstep(0, 1, f));
        // Portrait: widen until the keyed field of view (at most 50°) fits horizontally
        if (aspect < 1) {
            const minH = Math.min(fov, PORTRAIT_MIN_H) * DEG;
            const need = 2 * Math.atan(Math.tan(minH / 2) / aspect) / DEG;
            fov = Math.max(fov, Math.min(need, 100));
        }
        return fov;
    }

    /* Jump straight to the current target (first frame, deep links) */
    snap(J) {
        this.s = clamp(CameraRig.targetS(J), this.sMin, this.sMax);
        this.v = 0;
        this.update(0, 0, J);
        this._prev.copy(this.camera.position);
        this.velocity.set(0, 0, 0);
    }

    /* Exact camera at s for poster captures: no spring, warp, parallax, breathing,
       nudges or view offset. (Callers may pass t and opts as for update; a pose ignores them.) */
    pose(s) {
        const cam = this.camera;
        this.s = clamp(s, this.sMin, this.sMax);
        this.v = 0;
        this.warp = 0;
        this.warpTarget = 0;
        this.releaseOffset();
        cam.fov = this.sample(this.s);
        cam.position.copy(this._p);
        cam.lookAt(this._l);
        if (cam.view && cam.view.enabled) cam.clearViewOffset();
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        this._prev.copy(cam.position);
        this.velocity.set(0, 0, 0);
        this.speed = 0;
        this.gradeAt(this.s);
        return this.s;
    }

    update(dt, t, J, opts = {}) {
        const cam = this.camera;
        const target = clamp(CameraRig.targetS(J), this.sMin, this.sMax);
        if (this.s === null) this.s = target;

        // Warp is a spring: quick rise, slow fall
        this.warp = damp(this.warp, this.warpTarget, this.warpTarget > this.warp ? 1 / 0.35 * 2.3 : 1 / 0.9 * 2.3, dt);

        if (dt <= 0 || dt > 0.05) {
            // First frame or a long stall: jump rather than fly the whole way
            this.s = target;
            this.v = 0;
        } else {
            // Critically damped spring, stepped in closed form (exact at any frame rate): no velocity
            // jump when scrolling starts or stops, and the stiffness eases up with warp instead of switching
            const w = lerp(OMEGA_REST, OMEGA_WARP, smoothstep(0, 0.3, this.warp));
            const y = this.s - target;
            const c = this.v + w * y;
            const e = Math.exp(-w * dt);
            this.s = target + (y + c * dt) * e;
            this.v = (this.v - w * c * dt) * e;
            if (this.s <= this.sMin || this.s >= this.sMax) {
                this.s = clamp(this.s, this.sMin, this.sMax);
                this.v = 0;
            }
        }

        const fov = this.sample(this.s) + FOV_KICK * this.warp;
        const fwd = this._fwd.subVectors(this._l, this._p);
        const dist = fwd.length();
        fwd.divideScalar(dist || 1);
        this._right.crossVectors(fwd, cam.up).normalize();
        this._up.crossVectors(this._right, fwd).normalize();

        // Mission Log focus nudge, only around the galaxy: turn toward the feature, capped and slow
        const inGalaxy = smoothstep(3.6, 4.0, this.s) * (1 - smoothstep(4.9, 5.1, this.s));
        let nx = 0;
        let ny = 0;
        if (this.focusOn && !opts.still && inGalaxy > 0) {
            const d = this._v.subVectors(this._focusTarget, this._p);
            const z = d.dot(fwd);
            if (z > 0) {
                nx = Math.atan2(d.dot(this._right), z);
                ny = Math.atan2(d.dot(this._up), Math.hypot(d.dot(this._right), z));
                const m = Math.hypot(nx, ny);
                if (m > NUDGE_MAX) {
                    nx *= NUDGE_MAX / m;
                    ny *= NUDGE_MAX / m;
                }
            }
        }
        const N = this.nudge;
        N.x = damp(N.x, nx * inGalaxy, NUDGE_RATE, dt);
        N.y = damp(N.y, ny * inGalaxy, NUDGE_RATE, dt);

        // Free look: the target eases back to centre once it is switched off
        const L = this.look;
        L.x = damp(L.x, L.on ? L.tx : 0, LOOK_RATE, dt);
        L.y = damp(L.y, L.on ? L.ty : 0, LOOK_RATE, dt);

        const yaw = N.x + L.x * LOOK_YAW;
        const pitch = N.y - L.y * LOOK_PITCH;
        if (Math.abs(yaw) + Math.abs(pitch) > 1e-6) {
            const cp = Math.cos(pitch);
            this._l.copy(this._p)
                .addScaledVector(fwd, dist * cp * Math.cos(yaw))
                .addScaledVector(this._right, dist * cp * Math.sin(yaw))
                .addScaledVector(this._up, dist * Math.sin(pitch));
        }

        // Pointer parallax + idle breathing (fine pointers, full motion only; parallax rests during free look)
        const p = this.pointer;
        p.x = damp(p.x, L.on ? 0 : p.tx, 3, dt);
        p.y = damp(p.y, L.on ? 0 : p.ty, 3, dt);
        const amp = this.parallax.matches && !opts.still ? 0.015 * dist : 0;
        const breathe = opts.still ? 0 : Math.sin(t * 0.3) * 0.003 * dist;
        this._p.addScaledVector(this._right, p.x * amp).addScaledVector(this._up, -p.y * amp * 0.6 + breathe);
        this._l.addScaledVector(this._right, p.x * amp * 0.3).addScaledVector(this._up, -p.y * amp * 0.18);

        cam.position.copy(this._p);
        cam.lookAt(this._l);
        cam.updateMatrixWorld();
        cam.fov = fov;
        this.frameContact(dt, opts.contact);

        if (dt > 0) {
            const v = this._v.subVectors(cam.position, this._prev).divideScalar(dt);
            this.velocity.lerp(v, 1 - Math.exp(-10 * dt));
            this.speed = this.velocity.length();
        }
        this._prev.copy(cam.position);
        if (DEBUG) this.checkTurn(dt, t, target);
        this.gradeAt(this.s);
        return this.s;
    }

    /* Contact: slide the frame (a view offset, so the camera and the plunge's start point stay put)
       until the black hole's shadow sits behind the Contact card, so the shadow and photon ring frame
       it. `contact` is the card's viewport rect in CSS px, or null when it is off screen. Also applies
       cam.fov: every path through here updates the projection matrix exactly once. */
    frameContact(dt, contact) {
        const cam = this.camera;
        const S = this.shift;
        const zone = smoothstep(CONTACT_S[0], CONTACT_S[1], this.s);
        const want = contact && zone > 0 ? 1 : 0;
        S.k = dt > 0 ? damp(S.k, want, CONTACT_RATE, dt) : want;
        if (S.k < 1e-3 && !want) S.k = 0;
        const k = S.k * zone;

        if (contact) {
            // Aim point: the card's centre, kept well inside the screen while the card scrolls in
            const vw = innerWidth || 1;
            const vh = innerHeight || 1;
            S.tx = clamp(((contact.x + contact.w / 2) / vw) * 2 - 1, -0.6, 0.6);
            S.ty = clamp(1 - ((contact.y + contact.h / 2) / vh) * 2, -0.5, 0.5);
        }

        // Where the hole lands without an offset (NDC), from the camera basis and this frame's FOV
        let ox = 0;
        let oy = 0;
        const c = this._v.copy(this._hole).applyMatrix4(cam.matrixWorldInverse);
        if (k > 0 && c.z < -1) {
            const ty = Math.tan((cam.fov * DEG) / 2);
            const nx = c.x / -c.z / (ty * cam.aspect);
            const ny = c.y / -c.z / ty;
            ox = clamp((nx - S.tx) * k, -0.6, 0.6) * cam.aspect;
            oy = clamp((S.ty - ny) * k, -0.6, 0.6);
        }
        if (ox !== 0 || oy !== 0) {
            const fw = 2 * cam.aspect;
            cam.setViewOffset(fw, 2, ox, oy, fw, 2);
        } else if (cam.view && cam.view.enabled) {
            cam.clearViewOffset();
        } else {
            cam.updateProjectionMatrix();
        }
    }

    /* ?debug only: assert the view never turns faster than MAX_TURN degrees per 0.1 s while you
       scroll. Warps and jumps still in flight (nav links, flings, Home/End) are deliberate
       fly-throughs and are skipped. */
    checkTurn(dt, t, target) {
        const d = this._dbg;
        // A jump moves the target faster than any scroll can (~30 sections/s); skip until the camera catches up
        if (dt > 0 && Math.abs(target - d.target) / dt > 30) d.jump = true;
        else if (Math.abs(target - this.s) < 0.1) d.jump = false;
        d.target = target;
        const skip = d.jump || this.warp > 0.05;
        const dir = this.camera.getWorldDirection(this._v);
        if (skip || d.t < 0 || t < d.t) {
            // (Re)start the window; the turn is summed frame by frame so a swirl can't hide in it
            d.t = skip ? -1 : t;
            d.sum = 0;
            d.dir.copy(dir);
            return;
        }
        d.sum += d.dir.angleTo(dir) / DEG;
        d.dir.copy(dir);
        if (t - d.t < 0.1) return;
        const deg = d.sum * (0.1 / (t - d.t));
        console.assert(deg <= MAX_TURN, `[space] camera turned ${deg.toFixed(0)}° per 0.1 s near s=${this.s.toFixed(3)}`);
        d.t = t;
        d.sum = 0;
    }
}
