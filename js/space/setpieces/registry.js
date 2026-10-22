/* Set-pieces in section space. `range` is where a piece is visible (s values,
   where s = section index + progress); it is loaded when s comes within 1.0.
   The scene fades each piece over the first and last 0.12 of its range, so an
   edge should fall where the piece is off screen or small. Galaxy and black hole
   start where the camera has them just out of frame (top / top-left) between the
   Skills dwell and the Mission Log, so neither appears behind the Skills text and
   both slide into view already faded in. The nebula, comet and gas giant are in
   view from the hero/About onward; their fades run just after those dwells.
   `sky: true` marks a piece whose create() reads ctx.sky (the black hole lenses
   the sky cube), so it waits for the sky bake, which otherwise runs alongside. */
export const REGISTRY = [
    { id: 'earth', range: [-1, 1.7], load: () => import('./earth.js') },
    { id: 'nebula', range: [0.55, 2.3], load: () => import('./nebula.js') },
    { id: 'comet', range: [0.45, 1.75], load: () => import('./comet.js') },
    { id: 'gas-giant', range: [1.55, 3.35], load: () => import('./gas-giant.js') },
    { id: 'star', range: [2.6, 4.2], load: () => import('./star.js') },
    { id: 'galaxy', range: [3.57, 5.45], load: () => import('./galaxy.js') },
    { id: 'black-hole', range: [3.6, 7], sky: true, load: () => import('./black-hole.js') },
];
