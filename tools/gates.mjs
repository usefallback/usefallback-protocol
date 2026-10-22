// npm run gates: static + behavioural gates over src/ and dist/. Exit 0 only when every gate passes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import { renderCA, renderSocial, renderTile, renderChip, validateRegister, deriveHandle, isStated } from '../src/js/register-render.js';
import { scanAddresses } from '../src/js/address-scan.js';
import { X_PATH, GITHUB_PATH } from '../src/js/icons.js';
import { words, bigrams } from './grams.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = (...p) => path.join(root, 'dist', ...p);
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
const walk = (dir, skip = []) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  if (skip.includes(d.name)) return [];
  return d.isDirectory() ? walk(p, skip) : [p];
});

const results = [];
function gate(name, fn) {
  try { const bad = fn(); const list = Array.isArray(bad) ? bad : bad ? [String(bad)] : []; results.push({ name, ok: list.length === 0, detail: list }); }
  catch (e) { results.push({ name, ok: false, detail: [e.message] }); }
}
const eq = (cond, msg) => (cond ? [] : [msg]);

const reg = JSON.parse(read(path.join(root, 'src', 'register.json')));
const distReg = exists(dist('register.json')) ? JSON.parse(read(dist('register.json'))) : null;
const tokens = JSON.parse(read(path.join(root, 'src', 'tokens.json')));
const html = exists(dist('index.html')) ? read(dist('index.html')) : '';
const textFiles = exists(dist()) ? walk(dist()).filter((f) => /\.(html|js|css|svg|json)$/.test(f)) : [];

// Fixtures only: stated stand-ins used to drive the stated branch.
const FIX = {
  ca: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  hex: '0x52908400098527886E0F7030069857D2E4169EE7',
  x: 'https://x.com/fixture_handle',
  github: 'https://github.com/fixture-org',
};
const fixtureStated = (id, base) => {
  const r = { ...base, state: 'stated' };
  if (id === 'ca') r.value = FIX.ca; else r.url = FIX[id];
  return r;
};
const asAbsent = (base) => { const { value, url, pairsUrl, ...rest } = base; return { ...rest, state: 'absent' }; };

/* ---------- build output & assets ---------- */
gate('dist/ exists with index.html, styles, js entry', () => [
  ...eq(exists(dist('index.html')), 'dist/index.html missing'), ...eq(exists(dist('styles.css')), 'styles.css missing'), ...eq(exists(dist('js', 'main.js')), 'js/main.js missing')]);

gate('every local src/href/url() in dist resolves to a file in dist (relative, no leading slash)', () => {
  const bad = [];
  const check = (ref, from) => {
    if (/^(https?:|data:|#|mailto:)/.test(ref)) return;
    if (ref.startsWith('/')) { bad.push(`${ref} is root-absolute`); return; }
    const p = path.join(path.dirname(from), ref.split('#')[0].split('?')[0]);
    if (!exists(p)) bad.push(`${ref} (from ${path.basename(from)}) not found`);
  };
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) check(m[1], dist('index.html'));
  for (const m of read(dist('styles.css')).matchAll(/url\("?([^")]+)"?\)/g)) check(m[1], dist('styles.css'));
  for (const m of read(dist('tokens.css')).matchAll(/url\("?([^")]+)"?\)/g)) check(m[1], dist('tokens.css'));
  return bad;
});

gate('logo file copied into dist/ and referenced by index.html (img) and styles.css (mask)', () => [
  ...eq(exists(dist('assets', 'logo-192.png')), 'dist/assets/logo-192.png missing'),
  ...eq(exists(dist('assets', 'logo-mark.png')), 'dist/assets/logo-mark.png missing'),
  ...eq(/<img[^>]+class="brand-logo"[^>]+src="assets\/logo-192\.png"/.test(html), 'header <img> does not point at assets/logo-192.png'),
  ...eq(read(dist('styles.css')).includes('url("assets/logo-mark.png")'), 'styles.css does not reference assets/logo-mark.png')]);

gate('logo PNGs decode, correct size, mark keeps alpha (premultiplied resize, no halo)', () => {
  const bad = [];
  const a = PNG.sync.read(fs.readFileSync(dist('assets', 'logo-192.png')));
  if (a.width !== 192 || a.height !== 192) bad.push('logo-192 wrong size');
  const m = PNG.sync.read(fs.readFileSync(dist('assets', 'logo-mark.png')));
  let semi = 0, bright = 0, opaque = 0;
  for (let i = 0; i < m.width * m.height; i++) {
    const al = m.data[i * 4 + 3];
    if (al === 255) opaque++;
    if (al > 0 && al < 255) { semi++; if (m.data[i * 4] > 40) bright++; }
  }
  if (!opaque) bad.push('mark has no opaque pixels');
  const s0 = PNG.sync.read(fs.readFileSync(path.join(root, 'brand', 'LOGO FALLBACK PNG...png')));
  const meanSemi = (p) => { let n = 0, s = 0; for (let i = 0; i < p.width * p.height; i++) { const al = p.data[i * 4 + 3]; if (al > 0 && al < 255) { n++; s += p.data[i * 4]; } } return s / n; };
  if (meanSemi(m) > meanSemi(s0) + 2) bad.push('edge pixels brighter than the source: halo');
  const rep = JSON.parse(read(path.join(root, 'tools', 'assets-report.json')));
  const alpha = rep['brand/LOGO FALLBACK PNG...png'];
  if (!(alpha.ihdr.colourType === 6 && alpha.pureBlackTransparentPixels > 0)) bad.push('asset report lost the pure-black-transparent finding');
  if (!/resizePremult/.test(read(path.join(root, 'tools', 'build.mjs')))) bad.push('build lost the premultiplied resize');
  return bad;
});

gate('favicon.svg: 32x32, no XML comments, no double hyphen anywhere, colours from tokens, traced from the logo grid', () => {
  const svg = read(dist('favicon.svg'));
  const bad = [];
  if (!/width="32"/.test(svg) || !/height="32"/.test(svg) || !/viewBox="0 0 32 32"/.test(svg)) bad.push('not 32x32');
  if (svg.includes('<!--')) bad.push('has a comment');
  if (svg.includes('--')) bad.push('contains a double hyphen');
  for (const hex of svg.match(/#[0-9a-fA-F]{6}/g) || []) if (!Object.values(tokens.colors).some((c) => c.hex === hex)) bad.push(`fill ${hex} not a token`);
  const grid = read(path.join(root, 'tools', 'favicon-grid.txt')).trim().split('\n');
  const tile = PNG.sync.read(fs.readFileSync(path.join(root, 'brand', 'LOGO FALLBACK PNG.png')));
  const dark = (x, y) => { const o = (y * tile.width + x) * 4; return tile.data[o] + tile.data[o + 1] + tile.data[o + 2] < 200; };
  let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0;
  for (let y = 0; y < tile.height; y += 2) for (let x = 0; x < tile.width; x += 2) if (dark(x, y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cell = (x1 - x0 + 2) / 32; let agree = 0, total = 0;
  grid.forEach((line, j) => [...line].forEach((c, i) => { total++; if ((c === '1') === dark(Math.floor(x0 + (i + 0.5) * cell), Math.floor(y0 + (j + 0.5) * cell))) agree++; }));
  if (agree / total < 0.9) bad.push(`grid agrees with logo pixels only ${(100 * agree / total).toFixed(1)}%`);
  if (!/rel="icon" type="image\/svg\+xml" href="favicon\.svg"/.test(html)) bad.push('index.html does not link favicon.svg');
  return bad;
});

/* ---------- palette ---------- */
gate('palette: each token hex equals the real pixel it cites', () => {
  const bad = [];
  for (const [k, c] of Object.entries(tokens.colors)) {
    const png = PNG.sync.read(fs.readFileSync(path.join(root, c.file)));
    const o = (c.y * png.width + c.x) * 4;
    const hex = '#' + [0, 1, 2].map((i) => png.data[o + i].toString(16).padStart(2, '0')).join('');
    if (hex !== c.hex) bad.push(`${k}: ${c.hex} cited, pixel is ${hex}`);
  }
  return bad;
});

gate('palette: hex literals live only in src/tokens.json and its generated outputs', () => {
  const bad = [];
  const HEX = /#[0-9a-fA-F]{3,8}\b/g;
  const gen = new Set(['tokens.css', 'favicon.svg']);
  const files = [...walk(path.join(root, 'src')).filter((f) => !f.endsWith('tokens.json')), ...textFiles.filter((f) => !gen.has(path.basename(f)) && !f.endsWith('register.json'))];
  for (const f of files) {
    let t = read(f);
    if (f.endsWith('index.html') && f.includes('dist')) t = t.replace(/<meta name="theme-color" content="#[0-9a-fA-F]{6}">/, '');
    const hits = t.match(HEX);
    if (hits) bad.push(`${path.relative(root, f)}: ${[...new Set(hits)].join(', ')}`);
  }
  const tc = read(dist('tokens.css'));
  for (const h of tc.match(HEX) || []) if (!Object.values(tokens.colors).some((c) => c.hex === h)) bad.push(`tokens.css has non-token ${h}`);
  return bad;
});

/* ---------- register ---------- */
gate('register: states valid; absent/unconfirmed carry no value or url; no stored handle', () => [...validateRegister(reg), ...(distReg ? validateRegister(distReg) : ['dist/register.json missing'])]);

gate('register: x, github, ca records exist; dates only in register.json', () => {
  const bad = ['ca', 'x', 'github', 'chain', 'market'].filter((k) => !reg.records[k]).map((k) => `missing ${k}`);
  return bad;
});

/* ---------- branch: absent (whatever the current record is, force it) ---------- */
gate('branch absent: CA slot inert, no value, no copy control', () => {
  const html1 = renderCA(asAbsent(reg.records.ca));
  return [...eq(/is-inert/.test(html1) && /pending/.test(html1), 'not inert/pending'), ...eq(!/data-copy|<button|href=|value=/.test(html1), 'inert CA carries copy/href/value')];
});
gate('branch absent: X and GitHub icons render, inert, no href, no handle', () => {
  const bad = [];
  for (const id of ['x', 'github']) {
    const h = renderSocial(id, asAbsent(reg.records[id]));
    if (/href=/.test(h)) bad.push(`${id} has href`);
    if (!/is-inert/.test(h) || !/<svg/.test(h)) bad.push(`${id} not inert svg`);
    if (/@|handle/.test(h)) bad.push(`${id} shows a handle`);
  }
  return bad;
});
gate('branch absent: stat tiles show label + pending only', () => Object.entries(reg.records).filter(([, r]) => r.kind === 'stat').flatMap(([id, r]) => {
  const h = renderTile(id, asAbsent(r));
  return /pending/.test(h) && !/\d/.test(h.replace(/data-[a-z-]+="[^"]*"/g, '')) ? [] : [`${id} tile leaks content`];
}));

/* ---------- branch: stated ---------- */
gate('branch stated: CA shows the full address, click-to-copy with feedback hooks', () => {
  const h = renderCA(fixtureStated('ca', reg.records.ca));
  return [...eq(h.includes(`data-copy="${FIX.ca}"`) && h.includes(`>${FIX.ca}<`), 'full address/data-copy missing'), ...eq(/<button/.test(h) && /data-fb/.test(h) && /aria-live/.test(h), 'no button/feedback hook')];
});
gate('branch stated: link rule, href from stored URL, handle derived, never stored', () => {
  const bad = [];
  for (const id of ['x', 'github']) {
    const rec = fixtureStated(id, reg.records[id]);
    const h = renderSocial(id, rec);
    if (!h.includes(`href="${rec.url}"`)) bad.push(`${id} href missing`);
    if (!h.includes(deriveHandle(rec.url))) bad.push(`${id} handle not derived`);
    if ('handle' in rec) bad.push('handle stored');
  }
  const wrong = renderSocial('x', { state: 'stated', label: 'X', url: 'https://evil.example/x' });
  const js = renderSocial('x', { state: 'stated', label: 'X', url: 'javascript:alert(1)' });
  if (/href=/.test(wrong) || /href=/.test(js)) bad.push('foreign host or javascript: url produced an href');
  return bad;
});
gate('branch stated: a stated tile shows its value, an unconfirmed one stays inert', () => {
  const s = renderTile('vault', { state: 'stated', label: 'Held in vault', value: 'FIXTURE' });
  const u = renderTile('vault', { state: 'unconfirmed', label: 'Held in vault' });
  return [...eq(s.includes('FIXTURE'), 'stated value missing'), ...eq(/pending/.test(u) && !/FIXTURE/.test(u), 'unconfirmed not inert')];
});

/* ---------- mutation harness: anchors read the current record at runtime ---------- */
gate('mutation: flipping the current state of ca/x/github flips the render (both directions, any starting state)', () => {
  const bad = [];
  for (const src of [reg, distReg]) for (const id of ['ca', 'x', 'github']) {
    const cur = src.records[id];
    const mutated = isStated(cur) ? asAbsent(cur) : fixtureStated(id, cur);
    const before = id === 'ca' ? renderCA(cur) : renderSocial(id, cur);
    const after = id === 'ca' ? renderCA(mutated) : renderSocial(id, mutated);
    const live = (h) => (id === 'ca' ? /data-copy/.test(h) : /href=/.test(h));
    if (live(before) !== isStated(cur)) bad.push(`${id}: baseline render disagrees with state ${cur.state}`);
    if (live(before) === live(after)) bad.push(`${id}: mutation did not change render`);
    if (validateRegister({ records: { [id]: mutated } }).length) bad.push(`${id}: mutated record invalid`);
  }
  return bad;
});

gate('mutation: CA state has zero effect on market (market code reads only the market record)', () => {
  const m = read(path.join(root, 'src', 'js', 'market.js')), main = read(path.join(root, 'src', 'js', 'main.js'));
  const boot = main.slice(main.indexOf('async function boot'));
  const bad = [];
  if (/records\.ca|register|\bca\b/.test(m.replace(/\/\/.*$/gm, ''))) bad.push('market.js refers to register/ca');
  if (/records\.(ca|x|github)\b|\.ca\b/.test(boot)) bad.push('boot block references ca/x/github');
  if (!/startMarket\(market,/.test(boot) || !/isStated\(market\)/.test(boot)) bad.push('market not gated on its own record');
  for (const flip of [asAbsent(reg.records.ca), fixtureStated('ca', reg.records.ca)]) {
    const r = { ...reg, records: { ...reg.records, ca: flip } };
    if (JSON.stringify(r.records.market) !== JSON.stringify(reg.records.market)) bad.push('market record changed with ca');
  }
  return bad;
});

/* ---------- address scanner ---------- */
gate('gate warning: unstated 0x/base58 shapes flagged; stated ones matched, never blanket-rejected; CA exempt', () => {
  const bad = [];
  const withHex = { records: { ...reg.records, treasury: { state: 'stated', kind: 'address', label: 'T', value: FIX.hex } } };
  if (scanAddresses(`see ${FIX.hex}`, reg).length !== 1) bad.push('unstated 0x not flagged');
  if (scanAddresses(`see ${FIX.hex}`, withHex).length !== 0) bad.push('stated 0x was rejected (blanket reject)');
  if (scanAddresses(`see ${FIX.ca}`, reg).length !== 1) bad.push('unstated base58 not flagged');
  if (scanAddresses(`see ${FIX.ca}`, reg, FIX.ca).length !== 0) bad.push('CA not exempt');
  return bad;
});
gate('gate warning: no unstated address-shaped string anywhere in dist/', () => textFiles.filter((f) => !f.endsWith('register.json')).flatMap((f) => {
  const ca = isStated(reg.records.ca) ? reg.records.ca.value : null;
  return scanAddresses(read(f), reg, ca).map((h) => `${path.basename(f)}: ${h}`);
}));

/* ---------- no dates, no invented numbers ---------- */
const DATE_PATTERNS = [/\b\d{4}-\d{2}-\d{2}\b/, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i, /\b\d{1,2}:\d{2}(?::\d{2})?\b/, /\bas of\b/i, /\bchecked\b/i, /\btimestamp\b/i, /\blast updated\b/i, /\btoLocale(?:Date|Time)String\b|\btoISOString\b|new Date\(|Intl\.DateTimeFormat|\bgetFullYear\b/];
gate('no dates, timestamps, as-of or clock strings in any shipped file (register.json excepted)', () => textFiles.filter((f) => !f.endsWith('register.json')).flatMap((f) => {
  const t = read(f).replace(/<!--[\s\S]*?-->/g, '');
  const pats = f.endsWith('.svg') ? DATE_PATTERNS.slice(0, 1) : [...DATE_PATTERNS, /(?<![0-9])20[0-9]{2}(?![0-9])/];
  return pats.filter((p) => p.test(t)).map((p) => `${path.basename(f)} matches ${p}`);
}));
gate('dates exist in register.json only as data', () => eq(Object.values(reg.records).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.recorded || '')), 'a record lacks its recorded date'));

gate('no invented numbers: visible page text carries no digits beyond step indices', () => {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
  const nums = (body.match(/\d+(?:[.,]\d+)*/g) || []).filter((n) => !['01', '02', '03', '04'].includes(n));
  return nums.map((n) => `digit run "${n}"`);
});

/* ---------- copy: no shared 2-grams with the reference ---------- */
gate('copy: zero shared content 2-grams with the reference site', () => {
  const ref = new Set(JSON.parse(read(path.join(root, 'tools', 'ref-grams.json'))));
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' | ');
  const meta = [...html.matchAll(/<meta (?:name|property)="(?:description|og:[a-z_]+|twitter:[a-z_]+)" content="([^"]+)"/g)].map((m) => ' | ' + m[1]).join('');
  const js = read(dist('js', 'main.js'));
  const strings = [...js.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n]){6,200})\1/g)].map((m) => m[2]).filter((s) => /\s/.test(s) && !/[{}=;<>]|\$\{/.test(s)).join(' | ');
  const mine = new Set(`${body} ${meta} | ${strings}`.split('|').flatMap((seg) => bigrams(words(seg))));
  return [...mine].filter((g) => ref.has(g)).map((g) => `shared: "${g}"`);
});

/* ---------- layout, controls, motion ---------- */
gate('top of page: CA slot lives in the sticky header above main; social icons top-right, icon-only, both present', () => {
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  const css = read(dist('styles.css'));
  const socials = (header.match(/<div class="socials" data-slot="social">([\s\S]*?)<\/div>/) || [, ''])[1];
  const text = socials.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, '').trim();
  const bad = [];
  if (!header.includes('data-slot="ca"')) bad.push('CA not in header');
  if (html.indexOf('data-slot="ca"') > html.indexOf('<main')) bad.push('CA below main');
  if (!/\.top \{[^}]*position: sticky/.test(css)) bad.push('header not sticky');
  if (!/\.socials \{[^}]*margin-left: auto/.test(css)) bad.push('socials not pushed right on mobile');
  if ((socials.match(/class="social/g) || []).length !== 2) bad.push('need exactly two social icons');
  if (text) bad.push(`social icons carry text: "${text}"`);
  if (!/\.ca-addr \{[^}]*clamp\([^)]*22px\)/.test(css)) bad.push('CA font not large');
  if (!/\.ca-addr \{[^}]*overflow-wrap: anywhere/.test(css)) bad.push('full address cannot wrap');
  return bad;
});
gate('icons: official X mark and Octicon mark-github paths unchanged', () => {
  const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  return [...eq(h(X_PATH) === '52ea74b2897c7ec5', 'X path altered'), ...eq(h(GITHUB_PATH) === '20201911fe31ee5d', 'GitHub path altered')];
});
gate('tap targets: 44px minimums declared for every control', () => {
  const css = read(dist('styles.css')), bad = [];
  const need = [[/\.social \{[^}]*width: 44px; height: 44px/, '.social'], [/\.icon-btn \{[^}]*width: 44px; height: 44px/, '.icon-btn'], [/\.btn \{[^}]*height: 2\.75rem/, '.btn'], [/\.tabs button \{[^}]*min-height: 44px/, '.tabs button'], [/\.nav a \{[^}]*min-height: 44px/, '.nav a'], [/\.nav-m a \{[^}]*min-height: 44px/, '.nav-m a'], [/\.ca \{[^}]*min-height: 44px/, '.ca'], [/\.brand \{[^}]*min-height: 44px/, '.brand'], [/\.faq summary \{[^}]*min-height: 52px/, 'summary']];
  for (const [re, n] of need) if (!re.test(css)) bad.push(`${n} lacks 44px`);
  return bad;
});
gate('no ch units anywhere in shipped CSS/HTML', () => textFiles.filter((f) => /\.(css|html)$/.test(f)).filter((f) => /\d(?:\.\d+)?ch\b/.test(read(f))).map((f) => path.basename(f)));
gate('reduced motion: CSS kills all animation/transition, JS falls back instantly', () => {
  const css = read(dist('styles.css')), mo = read(dist('js', 'motion.js')), main = read(dist('js', 'main.js'));
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  return [...eq(/animation: none !important/.test(block) && /transition: none !important/.test(block), 'CSS block incomplete'), ...eq(/prefers-reduced-motion: reduce/.test(mo) && /reduced\(\)/.test(mo) && /reduced/.test(main), 'JS does not consult the query'), ...eq(/\.js \[data-reveal\] \{ opacity: 1 !important/.test(block), 'reveal not forced visible')];
});
gate('motion features present: spring solver, parallax, spotlight, progress bar, count-up flash, skeletons, ticker, live pill', () => {
  const mo = read(dist('js', 'motion.js')), css = read(dist('styles.css'));
  const bad = [];
  for (const [re, n] of [[/stiffness/, 'spring'], [/initParallax/, 'parallax'], [/initSpotlight/, 'spotlight'], [/initProgress/, 'progress'], [/countTo/, 'count-up']]) if (!re.test(mo)) bad.push(n);
  for (const [re, n] of [[/@keyframes flash-up/, 'flash'], [/\.row\.skel/, 'skeleton'], [/@keyframes marquee/, 'marquee'], [/@keyframes ping/, 'pulsing dot'], [/\.spot::before/, 'spotlight css'], [/\.blob/, 'mesh']]) if (!re.test(css)) bad.push(n);
  if ((html.match(/class="row skel"/g) || []).length < 10) bad.push('fewer than 10 skeleton rows');
  return bad;
});
gate('market: top 10 by 24h volume, solana only, 60s poll, hidden-tab pause, backoff, last-good kept, letter-tile fallback', () => {
  const m = read(dist('js', 'market.js')), main = read(dist('js', 'main.js')), bad = [];
  for (const [re, n] of [[/const TOP = 10/, 'top 10'], [/chainId === 'solana'/, 'solana filter'], [/POLL_MS = 60000/, '60s'], [/visibilitychange/, 'visibility'], [/document\.hidden/, 'hidden pause'], [/2 \*\* attempt/, 'exponential backoff'], [/BACKOFF_CAP_MS/, 'cap'], [/b\.volume - a\.volume|volume - a\.volume/, 'volume sort'], [/token-boosts|record\.url/, 'boosts url via record'], [/pairsUrl/, 'pairs url']]) if (!re.test(m)) bad.push(n);
  if (!/hasData/.test(m) || !/hasData/.test(main)) bad.push('last-good retention');
  if (!/wireImg/.test(main) || !/<span>\$\{letter\}<\/span>/.test(main)) bad.push('letter tile fallback');
  if (!/data-copy="\$\{esc\(r\.address\)\}"/.test(main)) bad.push('per-row copy');
  const rec = reg.records.market;
  if (!rec.url.startsWith('https://api.dexscreener.com/token-boosts/top/v1') || !rec.pairsUrl.startsWith('https://api.dexscreener.com/tokens/v1/solana/{addresses}')) bad.push('market record urls differ from the stated source');
  return bad;
});
gate('chain record: Solana via the stated RPC host', () => eq(reg.records.chain.value === 'Solana' && reg.records.rpc.url === 'https://solana-rpc.publicnode.com', 'chain/rpc records drifted'));

/* ---------- repo ---------- */
gate('repo hygiene: no agent config files, no attribution strings in any repo text', () => {
  const bad = [];
  const banned = new RegExp(['cla', 'ude'].join('') + '|' + ['anthro', 'pic'].join('') + '|co-authored|generated with', 'i');
  if (exists(path.join(root, ['CLA', 'UDE.md'].join('')))) bad.push('agent memory file present');
  if (exists(path.join(root, '.' + ['cla', 'ude'].join('')))) bad.push('agent dir present');
  for (const f of walk(root, ['node_modules', '.git', 'brand', 'reference']).filter((f) => !f.endsWith(path.join('tools', 'gates.mjs'))).filter((f) => /\.(md|json|mjs|js|css|html|svg|txt|yml|yaml)$/.test(f) || path.basename(f) === 'LICENSE')) {
    if (f.endsWith('package-lock.json')) continue;
    if (banned.test(read(f))) bad.push(`${path.relative(root, f)} mentions a banned term`);
  }
  return bad;
});
gate('repo files: README, docs/whitepaper.md, LICENSE at root; none inside dist/', () => {
  const bad = [];
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) if (!exists(path.join(root, f))) bad.push(`${f} missing`);
  for (const f of ['README.md', 'LICENSE', 'whitepaper.md', 'docs']) if (exists(dist(f))) bad.push(`dist/${f} must not exist`);
  if (!bad.length) {
    const rd = read(path.join(root, 'README.md')), wp = read(path.join(root, 'docs', 'whitepaper.md')), lic = read(path.join(root, 'LICENSE'));
    if (!/img\.shields\.io/.test(rd) || !/fallback\.ink/.test(rd)) bad.push('README lacks live-site badge');
    for (const s of ['Overview', 'Features', 'Links', 'Solana']) if (!rd.includes(s)) bad.push(`README lacks ${s}`);
    if (!/CA/.test(rd)) bad.push('README lacks CA placeholder');
    if (!/MIT License/.test(lic) || !/Copyright \(c\) 2026 Fallback/.test(lic)) bad.push('LICENSE not MIT / Fallback / 2026');
    for (const s of ['Vision', 'Mission', 'Tokenomics', 'Roadmap', 'Team']) if (!new RegExp(s, 'i').test(wp)) bad.push(`whitepaper lacks ${s}`);
    if ((wp.match(/^### Phase \d/gm) || []).length < 3) bad.push('roadmap needs 3-4 phases');
  }
  return bad;
});
gate('dist hygiene: no brand/reference/source folders or node_modules shipped', () => ['brand', 'reference', 'src', 'tools', 'node_modules', 'docs'].filter((d) => exists(dist(d))).map((d) => `dist/${d} present`));

/* ---------- report ---------- */
let pass = 0;
for (const r of results) { if (r.ok) pass++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`); for (const d of r.detail.slice(0, 12)) console.log(`        ${d}`); }
console.log(`\nGATES: ${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
