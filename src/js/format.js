const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const DASH = '—';

export function fmtPrice(p) {
  if (!Number.isFinite(p)) return DASH;
  if (p >= 1000) return '$' + grouped.format(p);
  if (p >= 1) return '$' + cents.format(p);
  if (p >= 0.01) return '$' + p.toFixed(4);
  if (p <= 0) return '$0';
  const d = Math.min(12, Math.max(4, 2 - Math.floor(Math.log10(p))));
  return '$' + p.toFixed(d);
}
export const fmtUsd = (v) => (Number.isFinite(v) ? '$' + compact.format(v) : DASH);
export const fmtPct = (v) => (Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%' : DASH);
