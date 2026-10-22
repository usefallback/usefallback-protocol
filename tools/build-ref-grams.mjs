// Builds tools/ref-grams.json: the 2-gram set of the reference site's own copy (JS strings + meta text).
// usage: node tools/build-ref-grams.mjs <reference-app.js> <reference-index.html>
import fs from 'node:fs';
import path from 'node:path';
import { words, bigrams } from './grams.mjs';

const [jsPath, htmlPath] = process.argv.slice(2);
const js = fs.readFileSync(jsPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
const texts = [];
for (const m of js.matchAll(/(["`])((?:\.|(?!\1)[^\\n]){6,400})\1/g)) {
  if (/\s/.test(m[2]) && /[a-z]{3}/i.test(m[2]) && !/[{}=;]|=>|\$\{/.test(m[2])) texts.push(m[2]);
}
for (const m of html.matchAll(/content="([^"]+)"/g)) texts.push(m[1]);
const t = html.match(/<title>([^<]+)/); if (t) texts.push(t[1]);
const set = new Set();
for (const s of texts) for (const g of bigrams(words(s))) set.add(g);
fs.writeFileSync(path.join(import.meta.dirname, 'ref-grams.json'), JSON.stringify([...set].sort()));
console.log('texts', texts.length, 'bigrams', set.size);
