import { ICONS } from './icons.js';
import { esc, isStated, renderCA, renderSocial, renderTile, renderChip, validateRegister } from './register-render.js';
import { startMarket } from './market.js';
import { fmtPrice, fmtUsd, fmtPct, DASH } from './format.js';
import { reduced, initReveal, initSpotlight, initProgress, initParallax, countTo, initNavIndicator } from './motion.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- register: re-render slots from the current record set ---------- */
const TIER_IDS = ['tier1', 'tier2', 'tier3'];
const VAULT_IDS = ['vault', 'refunded', 'opened', 'cap', 'fee'];

function paintRegister(reg) {
  const r = reg.records;
  $('[data-slot="ca"]').innerHTML = renderCA(r.ca);
  $('[data-slot="social"]').innerHTML = renderSocial('x', r.x) + renderSocial('github', r.github);
  $('[data-slot="chain"]').innerHTML = renderChip(r.chain);
  $('[data-slot="tiers"]').innerHTML = TIER_IDS.map((id) => renderTile(id, r[id])).join('');
  $('[data-slot="vault"]').innerHTML = VAULT_IDS.map((id) => renderTile(id, r[id])).join('');
  $$('[data-slot="tiers"] [data-reveal], [data-slot="vault"] [data-reveal]').forEach((e) => e.classList.add('in'));
}

async function loadRegister() {
  try {
    const res = await fetch('register.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('register');
    const reg = await res.json();
    if (validateRegister(reg).length) throw new Error('register invalid');
    paintRegister(reg);
    return reg;
  } catch { return null; }
}

/* ---------- copy ---------- */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove(); return ok;
}
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const ok = await copyText(btn.dataset.copy);
  const fb = $('[data-fb]', btn), ico = $('[data-ico]', btn);
  btn.classList.toggle('is-copied', ok);
  if (fb) fb.textContent = ok ? 'Copied' : 'Press and hold to copy';
  if (ico) ico.innerHTML = ok ? ICONS.check : ICONS.copy;
  if (btn.classList.contains('icon-btn')) btn.innerHTML = ok ? ICONS.check : ICONS.copy;
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.classList.remove('is-copied');
    if (fb) fb.textContent = 'Copy';
    if (ico) ico.innerHTML = ICONS.copy;
    if (btn.classList.contains('icon-btn')) btn.innerHTML = ICONS.copy;
  }, 1800);
});

/* ---------- market view ---------- */
const rowsEl = $('[data-rows]'), tickerEl = $('[data-ticker]'), msgEl = $('[data-board-msg]'), pill = $('[data-pill]'), pillText = $('[data-pill-text]');
let sortKey = 'volume', current = [], rowMap = new Map(), firstPaint = true;

const sorters = {
  volume: (a, b) => b.volume - a.volume,
  move: (a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0),
  depth: (a, b) => (b.liquidity || 0) - (a.liquidity || 0),
};

function tokHTML(r) {
  const letter = esc((r.symbol || '?').trim().charAt(0).toUpperCase() || '?');
  return `<span class="tok" aria-hidden="true"><span>${letter}</span>${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</span>`;
}
function wireImg(scope) {
  $$('.tok img', scope).forEach((img) => {
    const ok = () => img.classList.add('is-ok'), bad = () => img.remove();
    if (img.complete) { img.naturalWidth ? ok() : bad(); } else { img.addEventListener('load', ok, { once: true }); img.addEventListener('error', bad, { once: true }); }
  });
}
const chgHTML = (v) => (Number.isFinite(v) ? `<span class="chg ${v >= 0 ? 'up' : 'dn'}"><span aria-hidden="true">${v >= 0 ? '▲' : '▼'}</span><span data-n="change">${fmtPct(v)}</span></span>` : DASH);

function buildRow(r, i) {
  const li = document.createElement('li');
  li.className = 'row spot enter'; li.dataset.addr = r.address; li.style.setProperty('--i', i);
  li.innerHTML = `<div class="c-tok">${tokHTML(r)}<span class="tok-t"><b class="sym">${esc(r.symbol)}</b><span class="nm">${esc(r.name)}</span></span></div>
<div class="c-price num"><span data-n="price">${DASH}</span></div>
<div class="c-chg num"><span class="m-l label">Day move</span><span data-chg>${chgHTML(r.change)}</span></div>
<div class="c-vol num"><span class="m-l label">Volume</span><span data-n="volume">${DASH}</span></div>
<div class="c-liq num"><span class="m-l label">Pool depth</span><span data-n="liquidity">${DASH}</span></div>
<div class="c-act"><button type="button" class="icon-btn" data-copy="${esc(r.address)}" aria-label="Copy address for ${esc(r.symbol)}">${ICONS.copy}</button></div>`;
  wireImg(li);
  return li;
}

function paintRow(li, r) {
  countTo($('[data-n="price"]', li), r.price, fmtPrice);
  countTo($('[data-n="volume"]', li), r.volume, fmtUsd);
  countTo($('[data-n="liquidity"]', li), r.liquidity, fmtUsd);
  const chgWrap = $('[data-chg]', li);
  const prev = li._chg; li._chg = r.change;
  if (prev !== r.change || !$('[data-n="change"]', chgWrap)) {
    chgWrap.innerHTML = chgHTML(r.change);
    const n = $('[data-n="change"]', chgWrap);
    if (n) countTo(n, r.change, fmtPct);
  }
}

function paintTicker(rows) {
  const one = rows.map((r) => `<span class="tick">${tokHTML(r)}<b>${esc(r.symbol)}</b><span class="num">${fmtPrice(r.price)}</span>${Number.isFinite(r.change) ? `<span class="chg ${r.change >= 0 ? 'up' : 'dn'} num">${r.change >= 0 ? '▲' : '▼'} ${fmtPct(r.change)}</span>` : ''}</span>`).join('');
  tickerEl.innerHTML = one + one;
  wireImg(tickerEl);
}

function paintStats(rows) {
  const set = (k, v, f) => countTo($(`[data-stat="${k}"]`), v, f);
  set('count', rows.length, (v) => String(Math.round(v)));
  set('volume', rows.reduce((s, r) => s + (r.volume || 0), 0), fmtUsd);
  set('depth', Math.max(...rows.map((r) => r.liquidity || 0)), fmtUsd);
  const mv = [...rows].sort(sorters.move)[0];
  const el = $('[data-stat="mover"]');
  el.dataset.sym = mv.symbol;
  countTo(el, mv.change, (v) => `${mv.symbol} ${fmtPct(v)}`);
}

function order(rows) { return [...rows].sort(sorters[sortKey]); }

function render(rows) {
  const sorted = order(rows);
  const next = new Map();
  if (firstPaint) {
    rowsEl.innerHTML = '';
    sorted.forEach((r, i) => { const li = buildRow(r, i); next.set(r.address, li); rowsEl.appendChild(li); paintRow(li, r); });
    requestAnimationFrame(() => requestAnimationFrame(() => $$('.row.enter', rowsEl).forEach((li) => li.classList.add('is-in'))));
    if (reduced()) $$('.row.enter', rowsEl).forEach((li) => li.classList.add('is-in'));
    firstPaint = false;
  } else {
    sorted.forEach((r, i) => {
      let li = rowMap.get(r.address);
      if (!li) { li = buildRow(r, i); li.classList.add('is-in'); }
      next.set(r.address, li); rowsEl.appendChild(li); paintRow(li, r);
    });
    for (const [a, li] of rowMap) if (!next.has(a)) li.remove();
  }
  rowMap = next; current = rows;
  msgEl.hidden = true; rowsEl.hidden = false;
  paintTicker(sorted); paintStats(rows);
}

function setState(state, info) {
  pill.dataset.state = state === 'error' ? 'error' : state === 'live' ? 'live' : 'loading';
  pillText.textContent = state === 'live' ? 'Market live' : state === 'error' ? (info && info.hasData ? 'Held, retrying' : 'Source down') : state === 'refreshing' ? 'Refreshing' : 'Syncing';
  if (state === 'error' && !(info && info.hasData)) {
    rowsEl.hidden = true; msgEl.hidden = false;
    msgEl.innerHTML = `<b>${DASH}</b>The market source did not answer. Retrying with a growing pause.`;
    $$('[data-stat]').forEach((e) => { e.textContent = DASH; e._v = NaN; });
  }
}

$$('[data-sort]').forEach((b) => b.addEventListener('click', () => {
  sortKey = b.dataset.sort;
  $$('[data-sort]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  if (current.length) { order(current).forEach((r) => { const li = rowMap.get(r.address); if (li) rowsEl.appendChild(li); }); paintTicker(order(current)); }
}));

/* ---------- boot ---------- */
(async function boot() {
  initProgress($('[data-progress]'));
  initSpotlight();
  initReveal();
  initParallax($('[data-hero]'));
  initNavIndicator();
  const reg = await loadRegister();
  const market = reg ? reg.records.market : JSON.parse(document.documentElement.dataset.market || 'null');
  // The board follows the market-source record alone.
  if (isStated(market) && market.url && market.pairsUrl) startMarket(market, { onState: setState, onData: render });
  else setState('error', { hasData: false });
})();
