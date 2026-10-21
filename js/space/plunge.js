/* The plunge: keep scrolling at the bottom of the page and the camera free-falls
   into the black hole, on autopilot.

   The observer is a "raindrop" (falling radially from rest at infinity), so its
   speed relative to local static observers is beta = sqrt(rs / r): it reaches c at
   the horizon. The black-hole shader uses beta for the matching aberration and
   Doppler shift, which is what makes the view change the way it really would.
   Nothing special happens locally at the horizon; past it, every path leads to the
   singularity, where tidal forces stretch everything apart.

   Any click, key press, upward scroll or touch hands the camera back to the rig. */
import * as THREE from 'three';
import { ORIGINS } from './path-data.js';
import { smoothstep, lerp } from './lib/math.js';

const RS = 25; // world units per Schwarzschild radius (matches black-hole.js)

// (seconds, distance in Schwarzschild radii): a long approach, quick through the
// photon sphere (1.5 rs), the horizon at 18 s, then the last moments inside
const SCHEDULE = [[0, 19.4], [4, 12], [8.5, 6.5], [11.5, 3.6], [14.5, 2.0], [17, 1.0], [19.5, 0.5], [22, 0.2], [24, 0.06], [25, 0.025]];
export const PLUNGE_DURATION = 25;
// Auto-exposure while falling: the disk and the blueshifted sky fill the view, as an eye or camera would adapt
const EXPOSURE = [[0, 1], [4, 0.5], [8.5, 0.26], [11.5, 0.2], [14.5, 0.17], [17, 0.22], [19.5, 0.6], [21.5, 1.6], [23.5, 3.0], [25, 3.5]];
export const HORIZON_TIME = 17;

const WORLD_UP = new THREE.Vector3(0, 1, 0);

function exposureAt(t) {
    for (let i = 0; i < EXPOSURE.length - 1; i++) {
        const [t0, e0] = EXPOSURE[i];
        const [t1, e1] = EXPOSURE[i + 1];
        if (t <= t1) return lerp(e0, e1, smoothstep(t0, t1, t));
    }
    return EXPOSURE[EXPOSURE.length - 1][1];
}

export class Plunge {
    constructor(camera, onEvent) {
        this.camera = camera;
        this.onEvent = onEvent;
        this.state = 'idle'; // idle | falling | ended | returning
        this.t = 0;
        this.center = new THREE.Vector3(...ORIGINS.blackHole);
        this.dir = new THREE.Vector3();
        this.schedule = SCHEDULE.map((k) => [k[0], Math.log(k[1])]);
        this.params = { beta: 0, tidal: 0, blackout: 0, exposure: 1, r: 99, active: false };

        this.fromPos = new THREE.Vector3();
        this.fromQuat = new THREE.Quaternion();
        this.fromFov = 50;
        this.from = { beta: 0, tidal: 0, blackout: 0, exposure: 1 };
        this.startFov = 50;
        this.rt = 0;
        this.lastTick = -1;

        this._fwd = new THREE.Vector3();
        this._side = new THREE.Vector3();
        this._up = new THREE.Vector3();
        this._look = new THREE.Vector3();
        this._prev = new THREE.Vector3();
        this._pos = new THREE.Vector3();
        this._quat = new THREE.Quaternion();
    }

    get active() { return this.state !== 'idle'; }

    start() {
        if (this.state === 'falling' || this.state === 'ended') return;
        const cam = this.camera;
        this.dir.subVectors(cam.position, this.center);
        this.schedule[0][1] = Math.log(Math.max(2.5, this.dir.length() / RS));
        this.dir.normalize();
        this.startFov = cam.fov;
        this.t = 0;
        this.lastTick = -1;
        this.state = 'falling';
        this.params.active = true;
    }

    abort() {
        if (this.state !== 'falling' && this.state !== 'ended') return;
        const cam = this.camera;
        this.state = 'returning';
        this.rt = 0;
        this.fromPos.copy(cam.position);
        this.fromQuat.copy(cam.quaternion);
        this.fromFov = cam.fov;
        this.from.beta = this.params.beta;
        this.from.tidal = this.params.tidal;
        this.from.blackout = this.params.blackout;
        this.from.exposure = this.params.exposure;
        cam.up.copy(WORLD_UP);
    }

    reset() {
        this.state = 'idle';
        this.camera.up.copy(WORLD_UP);
        Object.assign(this.params, { beta: 0, tidal: 0, blackout: 0, exposure: 1, r: 99, active: false });
    }

    /* Distance in rs at time t: cubic Hermite through the schedule in log space (smooth speed) */
    rAt(t) {
        const k = this.schedule;
        const n = k.length;
        if (t <= k[0][0]) return Math.exp(k[0][1]);
        if (t >= k[n - 1][0]) return Math.exp(k[n - 1][1]);
        let i = 0;
        while (i < n - 2 && t > k[i + 1][0]) i++;
        const [t0, y0] = k[i];
        const [t1, y1] = k[i + 1];
        const slope = (a, b) => (k[b][1] - k[a][1]) / (k[b][0] - k[a][0]);
        const m0 = i === 0 ? slope(0, 1) : slope(i - 1, i + 1);
        const m1 = i + 1 === n - 1 ? slope(n - 2, n - 1) : slope(i, i + 2);
        const h = t1 - t0;
        const u = (t - t0) / h;
        const u2 = u * u;
        const u3 = u2 * u;
        const y = (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * m1;
        return Math.exp(y);
    }

    /* Drives the camera while active. Returns true while it owns the camera. */
    update(dt, frame, rig, J, time) {
        const cam = this.camera;
        const P = this.params;

        if (this.state === 'returning') {
            this.rt += dt;
            const k = smoothstep(0, 1.4, this.rt);
            rig.update(dt, time, J);
            this._pos.copy(cam.position);
            this._quat.copy(cam.quaternion);
            const rigFov = cam.fov;
            cam.position.lerpVectors(this.fromPos, this._pos, k);
            cam.quaternion.slerpQuaternions(this.fromQuat, this._quat, k);
            cam.fov = lerp(this.fromFov, rigFov, k);
            cam.updateProjectionMatrix();
            cam.updateMatrixWorld();
            P.beta = this.from.beta * (1 - k);
            P.tidal = this.from.tidal * (1 - k);
            P.blackout = this.from.blackout * (1 - k);
            P.exposure = lerp(this.from.exposure, 1, k);
            if (k >= 1) {
                this.reset();
                this.onEvent('done');
            }
            return true;
        }

        if (this.state === 'falling') this.t = Math.min(PLUNGE_DURATION, this.t + dt);
        const t = this.t;
        const r = this.rAt(t);
        P.r = r;

        this._prev.copy(cam.position);
        cam.position.copy(this.center).addScaledVector(this.dir, r * RS);

        // Face the hole; after the horizon, tilt up toward the outside universe still pouring in behind us
        const fwd = this._fwd.copy(this.dir).negate();
        const side = this._side.crossVectors(fwd, WORLD_UP).normalize();
        const up = this._up.crossVectors(side, fwd).normalize();
        const pitch = smoothstep(HORIZON_TIME + 0.5, HORIZON_TIME + 5.5, t) * 1.15;
        const look = this._look.copy(fwd).multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
        const roll = Math.sin(t * 0.17) * 0.1 + t * 0.012;
        cam.up.copy(up).multiplyScalar(Math.cos(roll)).addScaledVector(side, Math.sin(roll));
        cam.lookAt(look.add(cam.position));
        cam.fov = lerp(this.startFov, 66, smoothstep(8, HORIZON_TIME, t));
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();

        P.beta = smoothstep(0, 3, t);
        P.tidal = smoothstep(21, 24.5, t);
        P.blackout = smoothstep(23.6, PLUNGE_DURATION, t);
        P.exposure = exposureAt(t);

        if (dt > 0) {
            frame.velocity.subVectors(cam.position, this._prev).divideScalar(dt);
            frame.speed = frame.velocity.length();
        }

        if (this.state === 'falling' && t >= PLUNGE_DURATION) {
            this.state = 'ended';
            this.onEvent('end');
        }
        if (time - this.lastTick > 0.1) {
            this.lastTick = time;
            this.onEvent('tick', { r, beta: Math.sqrt(1 / r), t });
        }
        return true;
    }
}
