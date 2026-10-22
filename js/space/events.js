/* UI ↔ scene contract. All events are window CustomEvents with a space: prefix. */
export const EV = {
    // scene → UI {tier, post: 'direct'|'composer', probeMs (median boot-probe frame interval, 0 if
    // skipped), revival (true for the READY sent when 3D is turned back on after a perf fallback)}
    READY: 'space:ready',
    FALLBACK: 'space:fallback', // scene → UI {reason}
    TIER: 'space:tier',         // scene → UI {tier, scale, kind: 'tier'|'scale', post}
    SECTION: 'space:section',   // UI → scene {id, index, scene, prevId, direction}
    WARP: 'space:warp',         // UI → scene {active, reason: 'velocity'|'nav'|'return'}
    // UI → scene {mode: 'full'|'lite', source, still (reduced-motion visitor who chose 3D: no camera sway)}
    MOTION: 'space:motion',
    FOCUS: 'space:focus',       // UI → scene {id}
    PLUNGE: 'space:plunge',     // UI → scene {active, reason}
    PLUNGE_STATE: 'space:plunge-state', // scene → UI {r, beta, t}
    PLUNGE_END: 'space:plunge-end',     // scene → UI (reached the singularity)
    PLUNGE_DONE: 'space:plunge-done',   // scene → UI (camera handed back)
    // UI → scene {active}: palette-only free look. The page is hidden while active; the scene takes
    // fine-pointer moves and arrow keys as a look target (x, y in [-1, 1], +x right, +y down)
    LOOK: 'space:look',
    POSTER: 'space:poster',     // scene → UI {dataURL} (?poster=<s>[&t=<seconds>] capture mode only)
};

export const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

export function on(name, fn) {
    window.addEventListener(name, fn);
    return () => window.removeEventListener(name, fn);
}
