// Live market. Driven by the market-source register record only; no other record is read here.
const TOP = 10;
const TIMEOUT_MS = 12000;
const POLL_MS = 60000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 60000;

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

const num = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : NaN; };

export async function loadBoard(record) {
  const boosts = await getJson(record.url);
  const addrs = [...new Set((Array.isArray(boosts) ? boosts : []).filter((b) => b && b.chainId === 'solana' && b.tokenAddress).map((b) => b.tokenAddress))].slice(0, 30);
  if (!addrs.length) throw new Error('no solana entries');
  const pairs = await getJson(record.pairsUrl.replace('{addresses}', addrs.join(',')));
  const best = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const a = p && p.baseToken && p.baseToken.address;
    if (!a || !addrs.includes(a)) continue;
    const liq = num(p.liquidity && p.liquidity.usd);
    const cur = best.get(a);
    if (!cur || (Number.isFinite(liq) ? liq : -1) > cur._liq) {
      best.set(a, {
        address: a,
        symbol: String(p.baseToken.symbol || '?').slice(0, 12),
        name: String(p.baseToken.name || '').slice(0, 40),
        image: (p.info && typeof p.info.imageUrl === 'string' && /^https:\/\//.test(p.info.imageUrl)) ? p.info.imageUrl : '',
        price: num(p.priceUsd),
        change: num(p.priceChange && p.priceChange.h24),
        volume: num(p.volume && p.volume.h24),
        liquidity: num(p.liquidity && p.liquidity.usd),
        _liq: Number.isFinite(liq) ? liq : -1,
      });
    }
  }
  const rows = [...best.values()].filter((r) => Number.isFinite(r.volume)).sort((a, b) => b.volume - a.volume).slice(0, TOP);
  if (!rows.length) throw new Error('no pairs');
  return rows;
}

// startMarket(record, { onState, onData }) -> stop(). Polls every minute, rests while hidden, backs off on failure.
export function startMarket(record, { onState, onData }) {
  let timer = 0, attempt = 0, busy = false, stopped = false, hasData = false;

  const clear = () => { clearTimeout(timer); timer = 0; };
  const schedule = (ms) => { clear(); if (!stopped && !document.hidden) timer = setTimeout(tick, ms); };

  async function tick() {
    if (busy || stopped) return;
    busy = true; clear();
    onState(hasData ? 'refreshing' : 'loading');
    try {
      const rows = await loadBoard(record);
      hasData = true; attempt = 0;
      onData(rows);
      onState('live');
      busy = false; schedule(POLL_MS);
    } catch {
      attempt += 1;
      const wait = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt) * (0.85 + Math.random() * 0.3);
      onState('error', { hasData });
      busy = false; schedule(wait);
    }
  }

  const onVis = () => { if (document.hidden) clear(); else if (!busy) tick(); };
  document.addEventListener('visibilitychange', onVis);
  if (!document.hidden) tick();
  return () => { stopped = true; clear(); document.removeEventListener('visibilitychange', onVis); };
}
