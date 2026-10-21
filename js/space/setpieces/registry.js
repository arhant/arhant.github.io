/* Set-pieces in section space. `range` is where a piece is visible (s values,
   where s = section index + progress); it is loaded when s comes within 1.0. */
export const REGISTRY = [
    { id: 'earth', range: [-1, 1.7], load: () => import('./earth.js') },
    { id: 'nebula', range: [0.55, 2.3], load: () => import('./nebula.js') },
    { id: 'gas-giant', range: [1.55, 3.35], load: () => import('./gas-giant.js') },
    { id: 'star', range: [2.6, 4.2], load: () => import('./star.js') },
    { id: 'galaxy', range: [3.45, 5.45], load: () => import('./galaxy.js') },
    { id: 'black-hole', range: [4.4, 7], load: () => import('./black-hole.js') },
];
