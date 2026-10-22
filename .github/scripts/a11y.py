#!/usr/bin/env python3
"""Accessibility check with axe-core, run by .github/workflows/ci.yml (blocking).

Loads every page at a desktop and a phone viewport, in lite and in full motion, scrolls through
it so the reveal animations finish, then runs axe-core and fails on serious or critical
violations. Moderate and minor findings are printed as notes only.

Headless CI renders WebGL with SwiftShader (or not at all), so the full-motion runs usually end
on the static backdrop, which is the same fallback a slow device gets. The live 3D path is on
the README's manual release checklist.

    python .github/scripts/a11y.py                                  # serves the repo itself
    python .github/scripts/a11y.py --base-url http://127.0.0.1:8000 --channel chrome

Needs Python Playwright (pip install playwright; python -m playwright install chromium).
axe-core is downloaded from a pinned jsDelivr URL and checked against a pinned SHA-256; it is
only used here and is never shipped with the site.
"""
import argparse
import contextlib
import hashlib
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]

PAGES = [
    '/',
    '/work/spec-driven-development/',
    '/work/message-level-encryption/',
    '/work/credit-application-apis/',
    '/black-hole/',
]
VIEWPORTS = [
    # name, viewport, mobile (touch + mobile meta viewport)
    ('desktop', {'width': 1440, 'height': 900}, False),
    ('phone', {'width': 390, 'height': 844}, True),
]
MOTIONS = ['lite', 'full']

AXE_URL = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js'
AXE_SHA256 = 'b511cd9dec01c76f4b2ad1723b66b6db37d4c2eb4ed199076e1829d9ee7b75e3'
AXE_OPTIONS = {
    'runOnly': {'type': 'tag', 'values': ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']},
    'resultTypes': ['violations'],
}
BLOCKING = ('critical', 'serious')

# Same key the head script in index.html reads; 'lite' runs also emulate prefers-reduced-motion,
# which is how most visitors end up in lite mode.
INIT_SCRIPT = """
try { localStorage.setItem('motion', '%s'); } catch (e) {}
addEventListener('space:ready', () => { window.__a11yScene = 'ready'; });
addEventListener('space:fallback', (e) => { window.__a11yScene = 'fallback (' + ((e.detail && e.detail.reason) || '?') + ')'; });
"""

# Scroll down in half-viewport steps, slower than the velocity-warp threshold (7 vh/s), so every
# [data-reveal] block intersects once. Instant steps: full motion sets scroll-behavior: smooth.
SCROLL_THROUGH = """async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = Math.max(1, Math.round(innerHeight * 0.5));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo({ top: y, behavior: 'instant' });
        await sleep(120);
    }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    await sleep(300);
    window.scrollTo({ top: 0, behavior: 'instant' });
}"""

# Wait until nothing is mid-transition (finite CSS animations and transitions, warp, plunge),
# so color-contrast never measures a half-faded panel. Scroll-driven animations (scroll() and
# view() timelines) are always "running" and only move with the scroll position, so they don't count.
SETTLE = """async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const root = document.documentElement;
    const timed = (a) => !window.DocumentTimeline || a.timeline instanceof DocumentTimeline;
    const t0 = performance.now();
    await sleep(400);
    while (performance.now() - t0 < 8000) {
        const busy = root.matches('.is-moving, .is-warping, .is-plunging, .is-plunge-returning') ||
            document.getAnimations().some((a) => a.playState === 'running' && timed(a) && a.effect &&
                a.effect.getComputedTiming().endTime !== Infinity);
        if (!busy) return true;
        await sleep(150);
    }
    return false;
}"""

RUN_AXE = """async (options) => {
    const result = await axe.run(document, options);
    return result.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => ({
            impact: n.impact,
            target: [].concat(n.target).join(' '),
            summary: (n.failureSummary || '').replace(/\\s+/g, ' ').trim(),
        })),
    }));
}"""


def fetch_axe():
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(AXE_URL, timeout=30) as r:
                body = r.read()
            break
        except OSError as e:
            last = e
            time.sleep(2 * (attempt + 1))
    else:
        sys.exit(f'a11y: could not download axe-core from {AXE_URL}: {last}')
    digest = hashlib.sha256(body).hexdigest()
    if digest != AXE_SHA256:
        sys.exit(f'a11y: axe-core checksum mismatch ({digest}); refusing to run it')
    return body.decode('utf-8')


@contextlib.contextmanager
def serve(root):
    """python -m http.server on a free local port, for the duration of the run."""
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', str(root)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f'http://127.0.0.1:{port}'
    try:
        deadline = time.monotonic() + 15
        while True:
            try:
                urllib.request.urlopen(base + '/', timeout=2).close()
                break
            except OSError:
                if proc.poll() is not None or time.monotonic() > deadline:
                    sys.exit('a11y: http.server did not start')
                time.sleep(0.2)
        yield base
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def check(browser, axe_source, base, path, viewport, motion):
    """One page in one configuration. Returns (blocking violations, other violations, notes)."""
    _, size, mobile = viewport
    ctx = browser.new_context(
        viewport=size, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1,
        reduced_motion='reduce' if motion == 'lite' else 'no-preference', bypass_csp=True)
    ctx.add_init_script(INIT_SCRIPT % motion)
    page = ctx.new_page()
    notes = []
    page.on('pageerror', lambda e: notes.append(f'page error: {e}'))
    try:
        resp = page.goto(base + path, wait_until='load', timeout=60000)
        if resp is None or resp.status >= 400:
            raise RuntimeError(f'HTTP {resp.status if resp else "no response"}')
        if motion == 'full':
            # Pages without the scene canvas (subpages) have nothing to wait for
            try:
                page.wait_for_function("() => window.__a11yScene || !document.getElementById('space-canvas')",
                                       timeout=20000)
                scene = page.evaluate('window.__a11yScene || null')
                if scene:
                    notes.append(f'scene: {scene}')
            except PlaywrightTimeout:
                notes.append('scene: no space:ready or space:fallback within 20 s')
            page.evaluate(SCROLL_THROUGH)
        if not page.evaluate(SETTLE):
            notes.append('page still animating after 8 s; results may include mid-transition contrast')
        page.add_script_tag(content=axe_source)
        violations = page.evaluate(RUN_AXE, AXE_OPTIONS)
    finally:
        ctx.close()
    blocking, other = [], []
    for v in violations:
        nodes = [n for n in v['nodes'] if n['impact'] in BLOCKING]
        if nodes:
            blocking.append({**v, 'nodes': nodes})
        rest = len(v['nodes']) - len(nodes)
        if rest:
            other.append(f"{v['id']} ({v['impact']}) x{rest}")
    return blocking, other, notes


def annotate(title, message):
    """An error annotation on the workflow run (GitHub Actions only)."""
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        return

    def esc(s):
        return s.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')

    print(f'::error title={esc(title).replace(",", "%2C").replace(":", "%3A")}::{esc(message)}')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--base-url', help='test an already running server instead of serving the repo')
    ap.add_argument('--channel', help='browser channel, e.g. chrome or msedge (default: Playwright Chromium)')
    ap.add_argument('--pages', nargs='+', default=PAGES, metavar='PATH', help='paths to check (default: all)')
    args = ap.parse_args()
    sys.stdout.reconfigure(errors='replace')

    axe_source = fetch_axe()
    failures = 0
    with contextlib.ExitStack() as stack:
        base = args.base_url.rstrip('/') if args.base_url else stack.enter_context(serve(ROOT))
        print(f'a11y: axe-core 4.10.2, {len(args.pages)} pages x {len(VIEWPORTS)} viewports x '
              f'{len(MOTIONS)} motion modes, {base}')
        with sync_playwright() as p:
            browser = p.chromium.launch(channel=args.channel)
            for path in args.pages:
                for viewport in VIEWPORTS:
                    for motion in MOTIONS:
                        label = f'{path:<34} {viewport[0]:<7} {motion:<4}'
                        try:
                            blocking, other, notes = check(browser, axe_source, base, path, viewport, motion)
                        except Exception as e:  # a page that fails to load fails the check
                            failures += 1
                            print(f'  ERROR {label}  {(str(e).splitlines() or [repr(e)])[0]}')
                            annotate('a11y: page did not load', f'{path} {viewport[0]} {motion}: {e}')
                            continue
                        status = 'FAIL ' if blocking else 'ok   '
                        count = sum(len(v['nodes']) for v in blocking)
                        print(f'  {status} {label}  {count} serious/critical'
                              + (f'; notes: {", ".join(other)}' if other else ''))
                        for note in notes:
                            print(f'          {note}')
                        for v in blocking:
                            failures += 1
                            print(f"          [{v['impact']}] {v['id']}: {v['help']} ({len(v['nodes'])} nodes)")
                            print(f"            {v['helpUrl']}")
                            for n in v['nodes'][:8]:
                                print(f"            - {n['target']}")
                                if n['summary']:
                                    print(f"              {n['summary'][:300]}")
                            if len(v['nodes']) > 8:
                                print(f"            ... and {len(v['nodes']) - 8} more")
                            annotate(f"axe: {v['id']}",
                                     f"{path} {viewport[0]} {motion}: {v['help']} ({len(v['nodes'])} nodes)")
            browser.close()
    if failures:
        print(f'a11y: {failures} problem(s): serious/critical violations or pages that did not load')
        return 1
    print('a11y: no serious or critical violations')
    return 0


if __name__ == '__main__':
    sys.exit(main())
