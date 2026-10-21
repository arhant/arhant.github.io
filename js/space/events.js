/* UI ↔ scene contract. All events are window CustomEvents with a space: prefix. */
export const EV = {
    READY: 'space:ready',       // scene → UI {tier}
    FALLBACK: 'space:fallback', // scene → UI {reason}
    TIER: 'space:tier',         // scene → UI {tier, scale}
    SECTION: 'space:section',   // UI → scene {id, index, scene, prevId, direction}
    WARP: 'space:warp',         // UI → scene {active, reason}
    MOTION: 'space:motion',     // UI → scene {mode}
    FOCUS: 'space:focus',       // UI → scene {id}
};

export const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

export function on(name, fn) {
    window.addEventListener(name, fn);
    return () => window.removeEventListener(name, fn);
}
