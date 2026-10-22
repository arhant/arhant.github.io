/* ==========================================================================
   Command palette (Ctrl/⌘ K or /). Loaded on first use by main.js.
   Native <dialog> for focus trapping, Esc and the backdrop; the input is an
   ARIA combobox over a listbox of sections, case studies and actions.
   ========================================================================== */

let dialog = null;
let input = null;
let list = null;
let items = [];
let filtered = [];
let active = 0;
let opener = null;
let ctx = null;
let shown = false;

// Jumps go through main.js, so they warp like links, focus the heading and leave a Back entry
function goTo(id) {
    if (ctx.jumpTo) {
        ctx.jumpTo(id);
        return;
    }
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: ctx.isLite() ? 'auto' : 'smooth', block: 'start' });
}

const has = (name) => typeof ctx[name] === 'function';
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// "high · 60 fps · 100% → Medium": what runs now, and what choosing the row switches to
function qualityHint(q) {
    const parts = [q.tier];
    if (Number.isFinite(q.fps)) parts.push(`${Math.round(q.fps)} fps`);
    if (Number.isFinite(q.scale)) parts.push(`${Math.round(q.scale * 100)}%`);
    return `${parts.filter(Boolean).join(' · ')} → ${cap(q.next)}${q.reloads ? ' (reloads scene)' : ''}`;
}

function buildItems() {
    const sections = ctx.sections.map((s) => {
        const h = s.querySelector('h1, h2');
        const label = s.id === 'hero' ? 'Top' : (s.dataset.label || (h ? h.textContent : s.id)).trim();
        return { group: 'Sections', label, hint: s.id === 'hero' ? 'Launch' : '', run: () => goTo(s.id) };
    });
    if (document.getElementById('education')) {
        sections.splice(2, 0, { group: 'Sections', label: 'Education', hint: 'About', run: () => goTo('education') });
    }

    const cases = [...document.querySelectorAll('.case[id]')].map((c) => ({
        group: 'Case studies',
        label: (c.querySelector('h3')?.textContent || c.id).trim(),
        hint: (c.querySelector('.case-code')?.childNodes[0]?.textContent || '').trim(),
        run: () => goTo(c.id),
    }));

    const actions = [
        { group: 'Actions', label: 'Copy email address', hint: 'arhant@nyu.edu', run: () => ctx.copyEmail() },
        { group: 'Actions', label: 'Send an email', hint: 'mailto', run: () => { location.href = 'mailto:arhant@nyu.edu'; } },
        { group: 'Actions', label: 'Open LinkedIn', hint: 'new tab', run: () => window.open('https://www.linkedin.com/in/arhant-jain', '_blank', 'noopener') },
        { group: 'Actions', label: 'Open GitHub', hint: 'new tab', run: () => window.open('https://github.com/arhant', '_blank', 'noopener') },
        { group: 'Actions', label: '', hint: 'motion', toggle: true, run: () => ctx.toggleMotion() },
    ];
    // Scene commands only while the 3D scene is running
    if (has('canPlunge') && ctx.canPlunge()) {
        actions.push({ group: 'Actions', label: 'Cross the event horizon', hint: 'black hole · about 25 s', run: () => ctx.plunge() });
    }
    if (has('canLook') && ctx.canLook()) {
        actions.push({ group: 'Actions', label: 'Look around the scene', hint: '3D · Esc to return', run: () => ctx.look() });
    }
    const quality = has('quality') ? ctx.quality() : null;
    if (quality) {
        actions.push({ group: 'Actions', label: 'Graphics quality', hint: qualityHint(quality), run: () => ctx.setQuality(quality.next) });
    }
    actions.push({ group: 'Actions', label: 'Back to top', hint: 'Return to launch', run: () => ctx.backToTop() });
    return [...sections, ...cases, ...actions];
}

function labelOf(item) {
    if (item.toggle) return ctx.isLite() ? 'Turn on full motion (3D scene)' : 'Turn on lite mode (no 3D)';
    return item.label;
}

function render() {
    const q = input.value.trim().toLowerCase();
    filtered = items
        .map((item) => {
            const text = `${labelOf(item)} ${item.hint} ${item.group}`.toLowerCase();
            const label = labelOf(item).toLowerCase();
            const score = !q ? 1 : label.startsWith(q) ? 3 : label.includes(q) ? 2 : text.includes(q) ? 1 : 0;
            return { item, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => (q ? b.score - a.score : 0))
        .map((r) => r.item);

    active = Math.min(active, Math.max(0, filtered.length - 1));
    list.textContent = '';
    let lastGroup = '';
    filtered.forEach((item, i) => {
        if (item.group !== lastGroup && !q) {
            const g = document.createElement('li');
            g.className = 'palette-group';
            g.setAttribute('role', 'presentation');
            g.textContent = item.group;
            list.appendChild(g);
            lastGroup = item.group;
        }
        const li = document.createElement('li');
        li.id = `palette-opt-${i}`;
        li.className = 'palette-item';
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === active));
        const label = document.createElement('span');
        label.textContent = labelOf(item);
        const hint = document.createElement('span');
        hint.className = 'palette-hint-text';
        hint.textContent = item.hint;
        li.append(label, hint);
        li.addEventListener('pointermove', () => { if (active !== i) { active = i; sync(); } });
        li.addEventListener('click', () => choose(i));
        list.appendChild(li);
    });
    if (!filtered.length) {
        const empty = document.createElement('li');
        empty.className = 'palette-empty';
        empty.setAttribute('role', 'presentation');
        empty.textContent = 'No matches';
        list.appendChild(empty);
    }
    sync();
}

function sync() {
    list.querySelectorAll('.palette-item').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    const current = document.getElementById(`palette-opt-${active}`);
    if (current) {
        input.setAttribute('aria-activedescendant', current.id);
        current.scrollIntoView({ block: 'nearest' });
    } else {
        input.removeAttribute('aria-activedescendant');
    }
}

function choose(i) {
    const item = filtered[i];
    if (!item) return;
    close(false);
    item.run();
}

// Runs once per open, whichever way it closes. The dialog's close event arrives a task later,
// so a command that runs right after close() already sees the palette as shut.
function closed() {
    if (!shown) return;
    shown = false;
    document.documentElement.classList.remove('palette-open');
    if (ctx && ctx.onClose) ctx.onClose();
}

function close(restoreFocus = true) {
    if (!dialog.open) return;
    dialog.close();
    closed();
    if (restoreFocus && opener && opener.focus) opener.focus();
}

function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'palette';
    dialog.setAttribute('aria-label', 'Command palette');
    dialog.innerHTML = `
        <div class="palette-inner">
            <div class="palette-search">
                <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-magnifying-glass"/></svg>
                <input type="text" role="combobox" aria-expanded="true" aria-controls="palette-list"
                       aria-autocomplete="list" aria-label="Search commands"
                       placeholder="Jump to a section, case study or action" autocomplete="off" spellcheck="false">
                <kbd>Esc</kbd>
            </div>
            <ul id="palette-list" class="palette-list" role="listbox" aria-label="Commands" tabindex="-1"></ul>
            <p class="palette-foot" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> select <kbd>Esc</kbd> close</p>
        </div>`;
    document.body.appendChild(dialog);
    input = dialog.querySelector('input');
    list = dialog.querySelector('.palette-list');

    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, filtered.length); sync(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + filtered.length) % Math.max(1, filtered.length); sync(); }
        else if (e.key === 'Home') { e.preventDefault(); active = 0; sync(); }
        else if (e.key === 'End') { e.preventDefault(); active = Math.max(0, filtered.length - 1); sync(); }
        else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    });
    // Clicking the backdrop (the dialog box itself, outside the inner panel) closes it
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    dialog.addEventListener('close', closed);
}

export function openPalette(context) {
    ctx = context;
    if (!dialog) build();
    if (dialog.open) return;
    opener = document.activeElement;
    items = buildItems();
    input.value = '';
    active = 0;
    render();
    document.documentElement.classList.add('palette-open');
    dialog.showModal();
    shown = true;
    input.focus();
}
