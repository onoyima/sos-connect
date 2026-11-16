/**
 * Tables written in help pages, the design document and the policies can be wider than a phone. On phone-size screens
 * they are shown as stacked cards instead (one card per row, each value with its column name), so nothing ever
 * scrolls sideways. This copies each column name onto its cells (data-label) for the CSS in app.css to show.
 */
function label(root: ParentNode) {
    root.querySelectorAll<HTMLTableElement>('.doc table, .prose-legal table').forEach((t) => {
        if (t.dataset.stack === '1') return;
        // The column names: the <thead>, or a first row made only of header cells.
        let headRow = t.querySelector('thead tr');
        const first = t.querySelector('tr');
        if (!headRow && first && first.children.length && [...first.children].every((c) => c.tagName === 'TH')) headRow = first;
        if (!headRow) return;
        (headRow as HTMLElement).dataset.head = '1';
        const heads = [...headRow.children].map((th) => th.textContent?.trim() ?? '');
        t.querySelectorAll('tr').forEach((tr) => {
            if (tr === headRow) return;
            [...tr.children].forEach((cell, i) => { if (heads[i]) (cell as HTMLElement).dataset.label = heads[i]; });
        });
        t.dataset.stack = '1';
    });
}

export function stackTablesOnPhones() {
    let pending = 0;
    const run = () => { pending = 0; label(document); };
    run();
    new MutationObserver(() => { if (!pending) pending = window.setTimeout(run, 60); })
        .observe(document.body, { childList: true, subtree: true });
}
