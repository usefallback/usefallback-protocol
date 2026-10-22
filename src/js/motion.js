// Motion layer. Every entry point checks the reduced-motion query and falls back to the instant end state.
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Damped harmonic oscillator, semi-implicit Euler at a fixed substep. Resolves once the spring is at rest.
export function spring(onFrame, { from = 0, to = 1, stiffness = 170, damping = 17, mass = 1, delay = 0 } = {}) {
  if (reduced()) { onFrame(to); return Promise.resolve(); }
  return new Promise((resolve) => {
    let x = from, v = 0, last = 0, acc = 0, started = false;
    const H = 1 / 240;
    const step = (t) => {
      if (!started) { started = true; last = t; }
      acc += Math.min(0.05, (t - last) / 1000); last = t;
      while (acc >= H) { v += ((-stiffness * (x - to) - damping * v) / mass) * H; x += v * H; acc -= H; }
      onFrame(x);
      if (Math.abs(x - to) < 0.0005 && Math.abs(v) < 0.0005) { onFrame(to); resolve(); } else requestAnimationFrame(step);
    };
    setTimeout(() => requestAnimationFrame(step), delay);
  });
}

export function initReveal() {
  const els = [...document.querySelectorAll('[data-reveal]')];
  if (reduced() || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  let batch = 0, batchTimer = 0;
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const el = en.target, i = batch++;
      clearTimeout(batchTimer); batchTimer = setTimeout(() => { batch = 0; }, 120);
      el.style.willChange = 'transform, opacity';
      const finish = () => { if (el._done) return; el._done = true; el.style.opacity = el.style.transform = el.style.willChange = ''; el.classList.add('in'); };
      spring((p) => {
        if (el._done) return;
        el.style.opacity = String(Math.max(0, Math.min(1, p * 1.25)));
        el.style.transform = `translate3d(0, ${(1 - p) * 28}px, 0) scale(${0.985 + 0.015 * p})`;
      }, { delay: i * 70 }).then(finish);
      setTimeout(finish, 2e3 + i * 70); // a throttled frame loop must never leave content hidden
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -32px 0px' });
  els.forEach((e) => io.observe(e));
}

export function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('.spot');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', e.clientX - r.left + 'px');
    t.style.setProperty('--my', e.clientY - r.top + 'px');
  }, { passive: true });
}

export function initProgress(bar) {
  let queued = false;
  const paint = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  };
  const q = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  addEventListener('scroll', q, { passive: true }); addEventListener('resize', q); paint();
}

export function initParallax(hero) {
  if (reduced()) return;
  const layers = [...hero.querySelectorAll('[data-depth]')].map((el) => ({ el, d: parseFloat(el.dataset.depth) }));
  let tx = 0, ty = 0, cx = 0, cy = 0, sy = 0, raf = 0, visible = true;
  const kick = () => { if (!raf && visible) raf = requestAnimationFrame(frame); };
  function frame() {
    raf = 0;
    cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
    for (const { el, d } of layers) el.style.transform = `translate3d(${cx * d * 18}px, ${cy * d * 18 + sy * d * 0.12}px, 0)`;
    if (Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002) raf = requestAnimationFrame(frame);
  }
  hero.addEventListener('pointermove', (e) => { const r = hero.getBoundingClientRect(); tx = ((e.clientX - r.left) / r.width - 0.5) * 2; ty = ((e.clientY - r.top) / r.height - 0.5) * 2; kick(); }, { passive: true });
  hero.addEventListener('pointerleave', () => { tx = ty = 0; kick(); });
  addEventListener('scroll', () => { sy = scrollY; kick(); }, { passive: true });
  new IntersectionObserver((en) => { visible = en[0].isIntersecting; if (visible) kick(); }).observe(hero);
}

// Count a numeric readout toward a new value; flash by direction.
export function countTo(el, to, fmt) {
  const prev = el._v;
  el._v = to;
  const dir = Number.isFinite(prev) && Number.isFinite(to) ? Math.sign(to - prev) : 0;
  const id = (el._anim = (el._anim || 0) + 1);
  if (reduced() || !Number.isFinite(to)) { el.textContent = fmt(to); }
  else {
    const a = Number.isFinite(prev) ? prev : 0, t0 = performance.now(), dur = Number.isFinite(prev) ? 600 : 900;
    const run = (t) => {
      if (id !== el._anim) return;
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(a + (to - a) * e);
      if (k < 1) requestAnimationFrame(run); else el.textContent = fmt(to);
    };
    requestAnimationFrame(run);
  }
  if (dir !== 0 && !reduced()) {
    const target = el.closest('.c-price, .c-chg, .c-vol, .c-liq, .tile-v') || el;
    target.classList.remove('flash-up', 'flash-dn'); void target.offsetWidth;
    target.classList.add(dir > 0 ? 'flash-up' : 'flash-dn');
    target.addEventListener('animationend', () => target.classList.remove('flash-up', 'flash-dn'), { once: true });
  }
}

export function initNavIndicator() {
  const nav = document.querySelector('[data-nav]'), block = document.querySelector('[data-nav-block]');
  const links = [...document.querySelectorAll('[data-nav-link], [data-nav-m] a')];
  const place = (id) => {
    for (const a of links) a.classList.toggle('is-active', a.getAttribute('href') === '#' + id);
    const a = nav && nav.querySelector(`[href="#${id}"]`);
    if (a && block && getComputedStyle(nav).display !== 'none') { block.style.left = a.offsetLeft + 'px'; block.style.width = a.offsetWidth + 'px'; }
    else if (block) block.style.width = '0px';
  };
  let cur = '';
  const io = new IntersectionObserver((en) => {
    for (const e of en) if (e.isIntersecting) { cur = e.target.id; place(cur); }
  }, { rootMargin: '-35% 0px -55% 0px' });
  document.querySelectorAll('[data-section]').forEach((s) => io.observe(s));
  addEventListener('resize', () => cur && place(cur));
}
