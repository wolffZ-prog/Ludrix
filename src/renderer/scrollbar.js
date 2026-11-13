function overlayScrollbar(el) {
  const bar = document.createElement('div'); bar.className = 'vsb'; bar.innerHTML = '<div class="vsbt"></div>';
  el.parentElement.appendChild(bar);
  const thumb = bar.firstChild;
  let hideT = 0, raf = 0, drag = null;
  const metrics = () => { const vh = el.clientHeight, sh = el.scrollHeight, th = bar.clientHeight; return { vh, sh, th, ratio: sh > vh ? vh / sh : 1 }; };
  const place = () => {
    raf = 0;
    bar.style.top = el.offsetTop + 'px'; bar.style.height = el.clientHeight + 'px';
    const m = metrics();
    if (m.ratio >= 1) { bar.classList.remove('has'); return; }
    bar.classList.add('has');
    const h = Math.max(36, Math.round(m.th * m.ratio));
    const y = Math.round((m.th - h) * (el.scrollTop / (m.sh - m.vh)));
    thumb.style.height = h + 'px'; thumb.style.transform = `translateY(${y}px)`;
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };
  const show = () => { bar.classList.add('on'); clearTimeout(hideT); if (!drag) hideT = setTimeout(() => bar.classList.remove('on'), 900); };
  el.addEventListener('scroll', () => { schedule(); show(); }, { passive: true });
  new ResizeObserver(schedule).observe(el);
  new MutationObserver(schedule).observe(el, { childList: true, subtree: true });
  bar.addEventListener('mouseenter', () => { bar.classList.add('on'); clearTimeout(hideT); });
  bar.addEventListener('mouseleave', () => { if (!drag) hideT = setTimeout(() => bar.classList.remove('on'), 600); });
  thumb.addEventListener('pointerdown', e => {
    e.preventDefault(); const m = metrics(); drag = { y: e.clientY, top: el.scrollTop, m }; bar.classList.add('drag'); el.style.scrollBehavior = 'auto'; thumb.setPointerCapture(e.pointerId);
  });
  thumb.addEventListener('pointermove', e => {
    if (!drag) return; const h = thumb.offsetHeight, span = drag.m.th - h; if (span <= 0) return;
    el.scrollTop = drag.top + (e.clientY - drag.y) / span * (drag.m.sh - drag.m.vh);
  });
  const end = () => { if (!drag) return; drag = null; bar.classList.remove('drag'); el.style.scrollBehavior = ''; show(); };
  thumb.addEventListener('pointerup', end); thumb.addEventListener('pointercancel', end);
  bar.addEventListener('pointerdown', e => {
    if (e.target !== bar) return; const m = metrics(); const r = bar.getBoundingClientRect();
    el.scrollTop = ((e.clientY - r.top) / m.th) * m.sh - m.vh / 2;
  });
  place();
}
window.addEventListener('load', () => { const v = document.getElementById('view'); if (v) overlayScrollbar(v); });
