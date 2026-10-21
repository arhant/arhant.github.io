/* ==========================================================================
   Command palette (Ctrl/⌘ K). Loaded on first use by main.js.
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

function goTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: ctx.isLite() ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
    const heading = el.matches('h1, h2, h3') ? el : el.querySelector('h1, h2, h3');
    if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
    }
}

function buildItems() {
    const sections = ctx.sections.map((s) => {
        const h = s.querySelector('h1, h2');
        const label = s.id === 'hero' ? 'Top' : (h ? h.textContent.trim() : s.id);
        return { group: 'Sections', label, hint: s.id === 'hero' ? 'Launch' : '', run: () => goTo(s.id) };
    });
    sections.splice(2, 0, { group: 'Sections', label: 'Education', hint: 'About', run: () => goTo('education') });

    const cases = [...document.querySelectorAll('.case')].map((c) => ({
        group: 'Case studies',
        label: c.querySelector('h3').textContent.trim(),
        hint: (c.querySelector('.case-code').childNodes[0].textContent || '').trim(),
        run: () => goTo(c.id),
    }));

    const actions = [
        { group: 'Actions', label: 'Copy email address', hint: 'arhant@nyu.edu', run: () => ctx.copyEmail() },
        { group: 'Actions', label: 'Send an email', hint: 'mailto', run: () => { location.href = 'mailto:arhant@nyu.edu'; } },
        { group: 'Actions', label: 'Open LinkedIn', hint: 'new tab', run: () => window.open('https://www.linkedin.com/in/arhant-jain', '_blank', 'noopener') },
        { group: 'Actions', label: 'Open GitHub', hint: 'new tab', run: () => window.open('https://github.com/arhant', '_blank', 'noopener') },
        { group: 'Actions', label: '', hint: 'motion', toggle: true, run: () => ctx.toggleMotion() },
        { group: 'Actions', label: 'Back to top', hint: 'Return to launch', run: () => ctx.backToTop() },
    ];
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

function close(restoreFocus = true) {
    if (!dialog.open) return;
    dialog.close();
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
            <ul id="palette-list" class="palette-list" role="listbox" aria-label="Commands"></ul>
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
    dialog.addEventListener('close', () => {
        document.documentElement.classList.remove('palette-open');
        if (ctx && ctx.onClose) ctx.onClose();
    });
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
    input.focus();
}
