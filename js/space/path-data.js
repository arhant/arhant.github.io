/* Authoring data only: where each set-piece sits, the camera keyframes for
   every section (s = sectionIndex + u), and the per-section look.
   Keyframe positions are relative to a set-piece origin so a set-piece can be
   moved without re-authoring its shots. */

export const ORIGINS = {
    earth: [0, 0, 0],
    nebula: [-300, 220, -3200],
    gasGiant: [900, -200, -7200],
    star: [-800, 320, -11800],
    galaxy: [2600, 1400, -20000],
    blackHole: [0, 0, -27000],
};

/* Optional per-set-piece frame rotation (Euler XYZ). Keyframes and sun
   directions for that set-piece are authored in its rotated frame; for the
   gas giant that means y is height above the ring plane. */
export const FRAMES = {
    gasGiant: [0.1, 0, 0.32],
};

// Sun directions (normalised in code), in each set-piece's frame
export const SUNS = {
    earth: [0.52, -0.06, -0.86],
    gasGiant: [-0.9, 0.3, -0.3],
};

/* Sections: 0 hero, 1 about, 2 experience, 3 skills, 4 projects (Mission Log), 5 contact.
   The page ends at s = 6. Optional pLook/pPos override the shot on portrait screens. */
export const KEYS = [
    // Hero: Earth's limb in the lower right, sun just behind it
    // (portrait: pitch down so the sunrise limb arcs across the top band, night side behind the text)
    { s: 0.0, rel: 'earth', pos: [0, 0, 0], look: [-8, 10, -100], pLook: [38, -62, -69], fov: 50 },
    { s: 0.5, rel: 'earth', pos: [-14, 26, -46], look: [0, 22, -150], pLook: [33.5, -43.2, -100], fov: 50 },
    // About: fly into the nebula
    { s: 1.0, rel: 'nebula', pos: [260, -80, 1500], look: [40, 0, 0], fov: 52 },
    { s: 1.5, rel: 'nebula', pos: [120, -30, 420], look: [160, 10, -500], fov: 55 },
    // Experience: gas giant arc (approach → ring plane → night side → backlit rings)
    { s: 2.0, rel: 'gasGiant', pos: [-1300, 600, 1300], look: [-150, 0, 0], fov: 50 },
    { s: 2.3, rel: 'gasGiant', pos: [-900, 260, 760], look: [-120, 0, 0], fov: 50 },
    { s: 2.5, rel: 'gasGiant', pos: [-620, 8, 340], look: [-60, 0, 0], fov: 54 },
    { s: 2.62, rel: 'gasGiant', pos: [-220, -150, 640], look: [0, 0, 0], fov: 54 },
    { s: 2.8, rel: 'gasGiant', pos: [800, -240, 300], look: [0, 40, 0], fov: 50 },
    // Skills: close to a blue-white star, framed right of centre
    { s: 3.0, rel: 'star', pos: [-420, -120, 720], look: [-210, -40, 0], fov: 50 },
    { s: 3.5, rel: 'star', pos: [-250, 20, 300], look: [-150, 10, 0], fov: 50 },
    // Mission Log: galaxy, from above the disk toward edge-on
    { s: 4.0, rel: 'galaxy', pos: [-2600, 3600, 4300], look: [300, 0, 0], fov: 50 },
    { s: 4.5, rel: 'galaxy', pos: [-3400, 1500, 2900], look: [500, 0, 0], fov: 50 },
    { s: 4.9, rel: 'galaxy', pos: [-3600, 380, 1500], look: [400, 0, 0], fov: 50 },
    // Contact: black hole, slightly above the disk plane
    { s: 5.0, rel: 'blackHole', pos: [-420, 200, 2300], look: [0, 0, 0], fov: 50 },
    { s: 5.5, rel: 'blackHole', pos: [0, 72, 540], look: [0, -6, 0], fov: 50 },
    { s: 6.0, rel: 'blackHole', pos: [0, 62, 480], look: [0, -6, 0], fov: 50 },
];

/* Per-section look, keyed at the section centre and interpolated between */
export const GRADES = [
    { exposure: 1.0, bloom: 0.75, vignette: 0.35 }, // hero
    { exposure: 1.05, bloom: 0.55, vignette: 0.4 }, // about
    { exposure: 1.0, bloom: 0.6, vignette: 0.38 },  // experience
    { exposure: 0.9, bloom: 0.9, vignette: 0.42 },  // skills
    { exposure: 1.05, bloom: 0.7, vignette: 0.38 }, // mission log
    { exposure: 1.0, bloom: 0.6, vignette: 0.42 },  // contact
];

/* Mission Log cards nudge the camera's look target toward a galaxy feature
   (offsets relative to the galaxy origin, in world units) */
export const FOCUS = {
    'ml-spec-driven': [0, 0, 0],
    'ml-credit-decision': [700, 0, -400],
    'ml-mle': [-600, 0, 500],
    'ml-rbac': [0, 900, 0],
    'ml-librefresh': [900, 0, 600],
    'ml-blue-green': [-800, 0, -700],
    'ml-credit-app': [0, -900, 0],
};

/* ---------- Framing helpers (plain math; used to place props inside a shot) ---------- */

const rad = (d) => (d * Math.PI) / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Euler XYZ, matching THREE.Euler's default order (R = Rx·Ry·Rz)
function rotate(v, e) {
    if (!e) return v.slice();
    let [x, y, z] = v;
    const [a, b, c] = e;
    [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)];
    [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
    [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
    return [x, y, z];
}

function keyFrameAt(s) {
    const k = KEYS.find((key) => key.s === s);
    if (!k) throw new Error(`No keyframe at s=${s}`);
    const o = ORIGINS[k.rel];
    const toWorld = (v) => { const r = rotate(v, FRAMES[k.rel]); return [r[0] + o[0], r[1] + o[1], r[2] + o[2]]; };
    const pos = toWorld(k.pos);
    const fwd = norm(sub(toWorld(k.look), pos));
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    return { pos, fwd, right, up };
}

/* Unit direction seen from keyframe `s`: yaw > 0 is right of centre, pitch > 0 is up (degrees) */
export function viewDir(s, yawDeg, pitchDeg) {
    const { fwd, right, up } = keyFrameAt(s);
    const cy = Math.cos(rad(yawDeg)), sy = Math.sin(rad(yawDeg));
    const cp = Math.cos(rad(pitchDeg)), sp = Math.sin(rad(pitchDeg));
    return norm([0, 1, 2].map((i) => fwd[i] * cp * cy + right[i] * cp * sy + up[i] * sp));
}

/* World position `dist` away from keyframe `s`'s camera, in direction viewDir(s, yaw, pitch) */
export function viewPoint(s, yawDeg, pitchDeg, dist) {
    const { pos } = keyFrameAt(s);
    const d = viewDir(s, yawDeg, pitchDeg);
    return [pos[0] + d[0] * dist, pos[1] + d[1] * dist, pos[2] + d[2] * dist];
}

/* Camera basis at keyframe `s` (for orienting props relative to the shot) */
export function viewBasis(s) {
    return keyFrameAt(s);
}
