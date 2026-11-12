// Compares the tutorial's Redcode parser with the Python parser on many sources.
//   python tools/check_parser.py out.json && node tools/check_parser.mjs out.json
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const RC = require('../assets/js/engine.js');
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let bad = 0;
for (const c of cases) {
  let got, err = null;
  try { got = RC.parse(c.src, c.defs); } catch (e) { err = e.message; }
  if (c.error || err) {
    if (!(c.error && err)) { bad++; console.log('DIFF', c.name, 'python:', c.error || 'ok', '| js:', err || 'ok'); }
    continue;
  }
  const same = JSON.stringify(got.instructions) === JSON.stringify(c.ins) && got.start === c.start;
  if (!same) { bad++; console.log('DIFF', c.name); }
}
console.log(`${cases.length - bad}/${cases.length} sources parsed identically`);
