# Third-party notices

This site includes the third-party components listed below. Each one is used under its own
license. These licenses cover only the named components. Everything else in this repository is
covered by [LICENSE](LICENSE) (all rights reserved).

## Three.js r170

`js/vendor/three/`, MIT License. Copyright 2010-2024 Three.js Authors.
The full license text is in [js/vendor/three/LICENSE](js/vendor/three/LICENSE).

The tone-mapping functions in `js/space/shaders/final.glsl.js` are ported from Three.js r170 under
the same license: the ACES filmic fit, and the AgX and Khronos PBR Neutral operators (the last two
are used only behind the `?tm=` URL flag).

## FXAA 3.11

`js/space/shaders/final.glsl.js` contains an independent GLSL port of the quality preset 10 of
FXAA 3.11 by Timothy Lottes (NVIDIA).

## web-vitals 4.2.4

`js/vendor/web-vitals/web-vitals.js`, the standard ES module build, under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). Copyright 2020 Google LLC.
The full license text is in [js/vendor/web-vitals/LICENSE](js/vendor/web-vitals/LICENSE).

## Lucide 0.460.0 (line icons)

The line icons in the SVG sprites (inline in `index.html`, and `img/icons.svg` for the standalone
pages) are from [Lucide](https://lucide.dev), under the ISC License. Portions of Lucide come from
[Feather](https://github.com/feathericons/feather), under the MIT License (text below).

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Feather (the portions of Lucide noted above):

```
The MIT License (MIT)

Copyright (c) 2013-2023 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Font Awesome Free 6.5.1 (brand icons only)

The three brand marks (GitHub, LinkedIn and YouTube) in the same SVG sprites are from Font Awesome
Free Brands, under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
Icons by Fonticons, Inc. (https://fontawesome.com), license details at https://fontawesome.com/license/free.
The brands themselves are trademarks of their respective owners.

## 3D simplex noise (webgl-noise)

Used in `js/space/shaders/common.glsl.js`.

```
Copyright (C) 2011 Ashima Arts
Copyright (C) 2011-2016 Stefan Gustavson

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Hash without Sine

Used in `js/space/shaders/common.glsl.js`.

```
Copyright (c) 2014 David Hoskins

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Fonts

Inter, Space Grotesk and JetBrains Mono are self-hosted in `fonts/` (the unmodified Latin variable
subsets published by [Fontsource](https://fontsource.org)) under the
[SIL Open Font License 1.1](https://openfontlicense.org):

- Inter: Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)
- Space Grotesk: Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)
- JetBrains Mono: Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)

The full license text is in [fonts/OFL.txt](fonts/OFL.txt). Google Fonts is no longer used.

## Used in CI only (not part of the site)

[axe-core](https://github.com/dequelabs/axe-core) 4.10.2 (Mozilla Public License 2.0, Deque Systems,
Inc.) is downloaded by `.github/scripts/a11y.py` while the accessibility check runs. It is not in
this repository and is never served with the site.
