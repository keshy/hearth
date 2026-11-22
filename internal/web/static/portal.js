(() => {
  const q = document.getElementById('q');
  const cards = [...document.querySelectorAll('#all .card')];
  const recent = document.querySelector('section.recent');
  const nomatch = document.getElementById('nomatch');
  let tag = '';

  function apply() {
    const term = (q.value || '').trim().toLowerCase();
    let shown = 0;
    for (const c of cards) {
      const okTerm = !term || c.dataset.search.includes(term);
      const okTag = !tag || c.dataset.tags.split(',').includes(tag);
      c.hidden = !(okTerm && okTag);
      if (!c.hidden) shown++;
    }
    if (nomatch) nomatch.hidden = shown > 0;
    if (recent) recent.hidden = Boolean(term || tag);
  }

  q.addEventListener('input', apply);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = cards.find((c) => !c.hidden);
      if (first) window.location.href = first.href;
    }
    if (e.key === 'Escape') { q.value = ''; apply(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); }
  });
  document.querySelectorAll('#tags .tag').forEach((b) => b.addEventListener('click', () => {
    tag = b.dataset.tag;
    document.querySelectorAll('#tags .tag').forEach((x) => x.classList.toggle('active', x === b));
    apply();
  }));

  async function refresh() {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (!res.ok) return;
      const st = await res.json();
      document.querySelectorAll('.card').forEach((c) => {
        const s = st[c.dataset.name];
        const d = c.querySelector('.dot');
        if (s && d) {
          d.className = 'dot ' + s.state;
          d.title = s.state + (s.detail ? ': ' + s.detail : '');
        }
      });
    } catch (_) { /* server restarting; try again next tick */ }
  }
  refresh();
  setInterval(refresh, 20000);
})();
