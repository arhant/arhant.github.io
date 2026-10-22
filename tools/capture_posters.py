"""Capture the scene stills in img/scene/ and the social preview og-image.jpg.

The stills come from the real renderer: each shot opens the page with
?poster=<s>&t=<seconds>, where app.js renders one exact, undamped frame of
section-space position s (0 hero, 1 about, 2 experience, 3 skills, 4 projects,
5 contact; the page ends at 6) on the high tier at DPR 1 and hands it over as a
PNG data URL in window.__poster. This script decodes it and encodes AVIF and
WebP (plus JPEG where listed) with Pillow. og-image.jpg is an ordinary
screenshot of the homepage hero once the scene is up and the entrance is over.

Requirements: the site served locally (for example `python -m http.server 8000`
in the repo root), Python with Playwright (Chrome channel installed) and
Pillow >= 11.3 (AVIF support). Chrome runs headless on the real GPU; the
software rasteriser works but is slow.

Usage (from the repo root):
    python tools/capture_posters.py                     # every shot, then og-image.jpg
    python tools/capture_posters.py --only hero-wide,og # just these (names from --list)
    python tools/capture_posters.py --list              # the shot table
    python tools/capture_posters.py --png build/        # also keep the raw PNG renders
    python tools/capture_posters.py --base http://127.0.0.1:8000 --angle d3d11

Re-capture after any change to js/space/path-data.js, a set piece or the
post-processing, then check the hero still lines up with the live scene.
Browsers take the first type they support from an image-set or <picture>, so
css/style.css (and /black-hole/) list the smaller encoding of each still first;
the script prints which one that is for every shot.
"""
import argparse
import base64
import io
import sys
import time
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
WIDE = (2520, 1080)   # 21:9; the backdrop shows it full height in landscape
TALL = (900, 2000)    # below a 3:4 aspect it is shown full width
OG = (1200, 630)

# name, viewport, s, t, {format: quality}, AVIF size ceiling in KB (quality steps down to fit)
# Pillow's AVIF quality scale: below ~65 the faint stars smear out. The hero still
# sits under the live scene, so it keeps that detail; the lite section stills are
# dimmed and blurred by the CSS, so they can be smaller.
# t: the hero stays at 0 because the live scene's clock starts there, so the
# handoff matches. Skills uses 8 so the transiting planet sits beside the
# star's disk, not on its limb; the black hole uses 7 for a more structured disk.
HERO = {'avif': 70, 'webp': 78}
LITE = {'avif': 55, 'webp': 65}
SHOTS = [
    ('hero-wide', WIDE, 0.0, 0.0, HERO, 90),
    ('hero-tall', TALL, 0.0, 0.0, HERO, 90),
    ('about-wide', WIDE, 1.0, 0.0, LITE, 60),
    ('about-tall', TALL, 1.0, 0.0, LITE, 60),
    ('experience-wide', WIDE, 2.0, 0.0, LITE, 60),
    ('experience-tall', TALL, 2.0, 0.0, LITE, 60),
    ('skills-wide', WIDE, 3.0, 8.0, LITE, 60),
    ('skills-tall', TALL, 3.0, 8.0, LITE, 60),
    ('projects-wide', WIDE, 4.0, 0.0, LITE, 60),
    ('projects-tall', TALL, 4.0, 0.0, LITE, 60),
    ('contact-wide', WIDE, 6.0, 7.0, LITE, 60),
    ('contact-tall', TALL, 6.0, 7.0, LITE, 60),
    ('black-hole-wide', WIDE, 5.75, 7.0, {'avif': 70, 'webp': 78, 'jpg': 80}, 90),
    ('black-hole-og', OG, 5.75, 7.0, {'jpg': 84}, None),
]
OG_NAME = 'og'  # the homepage screenshot, written to og-image.jpg

TIMEOUT = 60_000


def launch(p, angle):
    args = ['--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars']
    if angle:
        args.append(f'--use-angle={angle}')
    if angle == 'swiftshader':
        args.append('--enable-unsafe-swiftshader')
    return p.chromium.launch(channel='chrome', headless=True, args=args)


def new_page(browser, size, logs):
    ctx = browser.new_context(viewport={'width': size[0], 'height': size[1]}, device_scale_factor=1,
                              reduced_motion='no-preference')
    # Full motion regardless of a stored preference; lite never loads the scene
    ctx.add_init_script("try { localStorage.setItem('motion', 'full') } catch (e) {}")
    page = ctx.new_page()
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}')
            if m.type == 'error' and not m.text.startswith('Failed to load resource') else None)
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    page.on('response', lambda r: logs.append(f'[http {r.status}] {r.url}') if r.status >= 400 else None)
    return ctx, page


def render_poster(browser, base, size, s, t):
    """Open ?poster=s&t=t and return the rendered frame as an RGB image."""
    logs = []
    ctx, page = new_page(browser, size, logs)
    try:
        page.goto(f'{base}/?poster={s:g}&t={t:g}', wait_until='load')
        try:
            page.wait_for_function('() => !!window.__poster', timeout=TIMEOUT, polling=200)
        except Exception:
            fallback = page.evaluate("() => document.documentElement.className")
            raise RuntimeError(f'no poster after {TIMEOUT // 1000} s (html: {fallback}); ' + '; '.join(logs[-5:]))
        url = page.evaluate('() => window.__poster')
    finally:
        ctx.close()
    if logs:
        print('    console:', '; '.join(logs[-3:]))
    data = base64.b64decode(url.split(',', 1)[1])
    img = Image.open(io.BytesIO(data)).convert('RGB')
    if img.size != size:
        raise RuntimeError(f'poster is {img.size[0]}x{img.size[1]}, expected {size[0]}x{size[1]}')
    return img


def encode(img, path, fmt, quality, ceiling_kb=None):
    """Write img as fmt; an AVIF over its ceiling is re-encoded a few quality steps lower."""
    while True:
        buf = io.BytesIO()
        if fmt == 'avif':
            img.save(buf, 'AVIF', quality=quality, speed=3, subsampling='4:2:0')
        elif fmt == 'webp':
            img.save(buf, 'WEBP', quality=quality, method=6)
        else:
            img.save(buf, 'JPEG', quality=quality, optimize=True, progressive=True, subsampling='4:2:0')
        kb = buf.tell() / 1024
        if fmt != 'avif' or not ceiling_kb or kb <= ceiling_kb or quality <= 30:
            break
        quality -= 4
    path.write_bytes(buf.getvalue())
    return kb, quality


# og-image.jpg framing: the live hero as a card that still reads as a small link
# preview. Chrome, the summary, CTAs and readouts are dropped; the avatar, name,
# role and typed line are scaled up. Selectors that no longer match do nothing.
OG_CARD_CSS = """
.hud, .scroll-cue, .hero-summary, .hero-cta, .hero .readouts, .plunge-hint, .back-to-top,
.back-chip, .look-exit, .toast, .skip-link { display: none !important; }
.hero { padding-block: 0 !important; min-height: 100vh !important; }
.hero .container { padding-inline: 72px !important; max-width: none !important; }
.hero-id { gap: 26px !important; margin-bottom: 30px !important; }
.avatar { width: 124px !important; height: 124px !important; }
.avatar-orbit { inset: -10px !important; }
.hero-name { font-size: 92px !important; }
.hero-role { margin-top: 18px !important; font-size: 27px !important; }
.hero-typer { margin-top: 12px !important; font-size: 19px !important; }
.typer-caret { animation: none !important; }
"""

# The typewriter keeps rewriting its line; swap in a detached copy that holds the
# phrase the markup ships with, so the card never shows a half-typed word
OG_FREEZE_TYPER = """async () => {
    const el = document.getElementById('typewriter');
    if (!el) return null;
    const html = await (await fetch(location.pathname, { cache: 'no-store' })).text();
    const src = new DOMParser().parseFromString(html, 'text/html').getElementById('typewriter');
    const copy = el.cloneNode(false);
    copy.textContent = src ? src.textContent : el.textContent;
    el.replaceWith(copy);
    return copy.textContent;
}"""


def capture_og(browser, base, out):
    """Homepage hero at 1200x630 in full motion, after the scene is ready and the entrance ends."""
    logs = []
    ctx, page = new_page(browser, OG, logs)
    try:
        page.goto(f'{base}/', wait_until='load')
        page.wait_for_function(
            """() => {
                const root = document.documentElement;
                const st = window.SpaceScene && SpaceScene.getState ? SpaceScene.getState() : null;
                const imgs = [...document.querySelectorAll('#hero img')];
                return root.classList.contains('scene-ready') && !root.classList.contains('intro')
                    && st && st.ignite >= 0.999 && imgs.every((i) => i.complete && i.naturalWidth > 0);
            }""",
            timeout=TIMEOUT, polling=200)
        page.add_style_tag(content=OG_CARD_CSS)
        page.evaluate(OG_FREEZE_TYPER)
        page.wait_for_timeout(1500)  # reveal transitions, the canvas fade and the text mask settle
        png = page.screenshot(type='png')
    finally:
        ctx.close()
    if logs:
        print('    console:', '; '.join(logs[-3:]))
    img = Image.open(io.BytesIO(png)).convert('RGB')
    kb, q = encode(img, out, 'jpg', 82)
    return img, kb, q


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--base', default='http://127.0.0.1:8000', help='where the site is served')
    ap.add_argument('--only', default='', help='comma-separated shot names (og = og-image.jpg)')
    ap.add_argument('--out', default=str(ROOT / 'img' / 'scene'), help='output folder for the stills')
    ap.add_argument('--png', default='', help='also save each raw render as PNG in this folder')
    ap.add_argument('--angle', default='d3d11' if sys.platform == 'win32' else '',
                    help='Chrome --use-angle backend (d3d11, metal, gl, swiftshader); empty = Chrome default')
    ap.add_argument('--list', action='store_true', help='print the shot table and exit')
    a = ap.parse_args()

    if a.list:
        for name, size, s, t, fmts, ceiling in SHOTS:
            print(f'{name:16} {size[0]}x{size[1]:<5} s={s:<5g} t={t:<4g} ' + ' '.join(f'{f}@{q}' for f, q in fmts.items()))
        print(f'{OG_NAME:16} {OG[0]}x{OG[1]:<5} homepage screenshot -> og-image.jpg')
        return

    only = {n.strip() for n in a.only.split(',') if n.strip()}
    known = {s[0] for s in SHOTS} | {OG_NAME}
    if only - known:
        ap.error('unknown shot(s): ' + ', '.join(sorted(only - known)))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    raw = Path(a.png) if a.png else None
    if raw:
        raw.mkdir(parents=True, exist_ok=True)

    failed = 0
    with sync_playwright() as p:
        browser = launch(p, a.angle)
        for name, size, s, t, fmts, ceiling in SHOTS:
            if only and name not in only:
                continue
            started = time.time()
            print(f'{name}  {size[0]}x{size[1]}  s={s:g} t={t:g}')
            try:
                img = render_poster(browser, a.base, size, s, t)
            except Exception as e:  # keep going; report at the end
                print('    FAILED:', e)
                failed += 1
                continue
            if raw:
                img.save(raw / f'{name}.png')
            sizes = {}
            for fmt, quality in fmts.items():
                kb, q = encode(img, out / f'{name}.{fmt}', fmt, quality, ceiling if fmt == 'avif' else None)
                sizes[fmt] = kb
                print(f'    {name}.{fmt:5} {kb:7.1f} KB  q{q}')
            if 'avif' in sizes and 'webp' in sizes:
                first = 'avif' if sizes['avif'] <= sizes['webp'] else 'webp'
                print(f'    smaller: {first} (list it first where this still is used)')
            print(f'    {time.time() - started:.1f} s')
        if not only or OG_NAME in only:
            print(f'og-image.jpg  {OG[0]}x{OG[1]}')
            try:
                img, kb, q = capture_og(browser, a.base, ROOT / 'og-image.jpg')
                if raw:
                    img.save(raw / 'og-image.png')
                print(f'    og-image.jpg {kb:7.1f} KB  q{q}')
            except Exception as e:
                print('    FAILED:', e)
                failed += 1
        browser.close()
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
