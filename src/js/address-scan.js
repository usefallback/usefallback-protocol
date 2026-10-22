// Address-shape scanner. Never blanket-rejects 0x hex: shapes are matched against stated registry values.
const B58 = /(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{32,44}(?![A-Za-z0-9])/g;
const HEX = /(?<![A-Za-z0-9])0x[0-9a-fA-F]{40}(?![A-Za-z0-9])/g;

export function statedAddresses(register) {
  const out = new Set();
  for (const r of Object.values(register.records)) {
    if (r.state === 'stated' && typeof r.value === 'string' && (B58.test(r.value) || HEX.test(r.value))) out.add(r.value);
    B58.lastIndex = 0; HEX.lastIndex = 0;
  }
  return out;
}

// exemptValue: the CA record's value (CA slot is exempt from the scanner).
export function scanAddresses(text, register, exemptValue = null) {
  const allowed = statedAddresses(register);
  if (exemptValue) allowed.add(exemptValue);
  const hits = [];
  for (const re of [B58, HEX]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) if (!allowed.has(m[0])) hits.push(m[0]);
  }
  return hits;
}
