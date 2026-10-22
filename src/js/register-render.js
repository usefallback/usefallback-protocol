// Pure renderers over the register. No DOM access: the build pre-renders with these and the page re-renders with them.
import { ICONS } from './icons.js';

export const STATES = ['stated', 'absent', 'unconfirmed'];
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX40 = /^0x[0-9a-fA-F]{40}$/;

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const isStated = (r) => !!r && r.state === 'stated';
export const isAddressShape = (v) => typeof v === 'string' && (B58.test(v) || HEX40.test(v));

const SOCIAL_HOSTS = { x: ['x.com', 'twitter.com'], github: ['github.com'] };

function parseHttps(url) {
  try { const u = new URL(url); return u.protocol === 'https:' ? u : null; } catch { return null; }
}

export function socialHref(id, url) {
  const u = parseHttps(url);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, '');
  return (SOCIAL_HOSTS[id] || []).includes(host) ? u.href : null;
}

// Link rule: the register stores the URL only; the handle is always derived.
export function deriveHandle(url) {
  const u = parseHttps(url);
  const seg = u && u.pathname.split('/').filter(Boolean)[0];
  return seg || null;
}

export function validateRegister(reg) {
  const problems = [];
  for (const [id, r] of Object.entries(reg.records || {})) {
    if (!STATES.includes(r.state)) problems.push(`${id}: bad state ${r.state}`);
    if (r.state !== 'stated') {
      for (const k of ['value', 'url', 'pairsUrl', 'handle']) if (k in r) problems.push(`${id}: ${r.state} record carries ${k}`);
    } else {
      if (!r.value && !r.url) problems.push(`${id}: stated record has neither value nor url`);
      if ('handle' in r) problems.push(`${id}: handle is derived, never stored`);
      if (r.kind === 'address' && !isAddressShape(r.value)) problems.push(`${id}: stated address is not address-shaped`);
    }
  }
  return problems;
}

export function renderSocial(id, rec) {
  const icon = ICONS[id];
  const label = (rec && rec.label) || id;
  if (isStated(rec)) {
    const href = socialHref(id, rec.url);
    if (href) {
      const h = deriveHandle(href);
      return `<a class="social" data-social="${id}" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}${h ? ' ' + esc(h) : ''}">${icon}</a>`;
    }
  }
  return `<span class="social is-inert" data-social="${id}" data-state="${esc((rec && rec.state) || 'absent')}" role="img" aria-label="${esc(label)} pending">${icon}</span>`;
}

export function renderCA(rec) {
  const label = (rec && rec.label) || 'Contract';
  if (isStated(rec) && isAddressShape(rec.value)) {
    return `<button type="button" class="ca" data-ca data-state="stated" data-copy="${esc(rec.value)}" aria-label="Copy contract address"><span class="label">${esc(label)}</span><span class="ca-addr">${esc(rec.value)}</span><span class="ca-act"><span class="ca-ico" data-ico>${ICONS.copy}</span><span class="ca-fb" data-fb aria-live="polite">Copy</span></span></button>`;
  }
  return `<div class="ca is-inert" data-ca data-state="${esc((rec && rec.state) || 'absent')}" aria-disabled="true"><span class="label">${esc(label)}</span><span class="ca-addr">pending</span></div>`;
}

export function renderTile(id, rec, hint = '') {
  const stated = isStated(rec) && rec.value;
  return `<div class="tile card spot" data-record="${esc(id)}" data-state="${esc(rec.state)}" data-reveal><span class="label">${esc(rec.label)}</span><span class="tile-v num${stated ? '' : ' is-pending'}">${stated ? esc(rec.value) : 'pending'}</span>${hint ? `<span class="tile-h">${esc(hint)}</span>` : ''}</div>`;
}

export function renderChip(rec) {
  return `<span class="chip" data-state="${esc(rec.state)}"><span class="label">${esc(rec.label)}</span><span class="chip-v">${isStated(rec) && rec.value ? esc(rec.value) : 'pending'}</span></span>`;
}

export function hostOf(url) { const u = parseHttps(url); return u ? u.hostname : null; }
