// Runs every exported scenario in the tutorial's JavaScript engine and compares the
// result with the Python engine's reference runs saved in the scenario file.
//
//   node tools/check_engine.mjs [scenario ...]
//
// Compared: work of every program, processes alive at the end, the referee's damage
// fractions, the cycles of every restart, requests served on Red's slot, instructions
// executed, alarms, and a hash of the whole core at the end.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const RC = require(join(here, '..', 'assets', 'js', 'engine.js'));
const dir = join(here, '..', 'data', 'scenarios');
const only = process.argv.slice(2);
const files = readdirSync(dir).filter(f => f.endsWith('.js'))
  .filter(f => !only.length || only.includes(f.replace('.js', '')));

let bad = 0, total = 0;
const keys = ['downtime', 'injection', 'deviation', 'vault', 'injection_lw', 'deviation_lw'];
for (const f of files) {
  const txt = readFileSync(join(dir, f), 'utf8');
  const sc = JSON.parse(txt.slice(txt.indexOf('] = ') + 4, txt.lastIndexOf(';')));
  for (const ref of sc.refs) {
    total++;
    const enabled = sc.laws.map((_, i) => ((ref.mask >> i) & 1) === 1);
    const b = RC.Battle.fromScenario(sc, { enabled });
    const t0 = Date.now();
    b.run(sc.cycles);
    const ms = Date.now() - t0;
    const diffs = [];
    const work = b.workByName();
    for (const k in ref.work) if (work[k] !== ref.work[k]) diffs.push(`work.${k} ${work[k]} != ${ref.work[k]}`);
    const alive = {};
    b.names.forEach((n, i) => { alive[n] = b.W.queues[i].length; });
    for (const k in ref.alive) if (alive[k] !== ref.alive[k]) diffs.push(`alive.${k} ${alive[k]} != ${ref.alive[k]}`);
    const d = b.damage();
    for (const k of keys) if (Math.abs(d[k] - ref.damage[k]) > 1e-12) diffs.push(`${k} ${d[k]} != ${ref.damage[k]}`);
    if (JSON.stringify(b.restarts) !== JSON.stringify(ref.restarts)) diffs.push(`restarts ${b.restarts} != ${ref.restarts}`);
    if (b.served_red !== ref.served_red) diffs.push(`served_red ${b.served_red} != ${ref.served_red}`);
    const instr = b.icount.reduce((a, x) => a + x, 0);
    if (instr !== ref.instructions) diffs.push(`instructions ${instr} != ${ref.instructions}`);
    const alarms = (b.W.alarm_counts || []).reduce((a, x) => a + x, 0);
    if (alarms !== ref.alarms) diffs.push(`alarms ${alarms} != ${ref.alarms}`);
    const h = b.coreHash();
    if (h !== ref.core_hash) diffs.push(`core hash ${h} != ${ref.core_hash}`);
    const tag = `${sc.id} mask=${ref.mask}`.padEnd(26);
    if (diffs.length) { bad++; console.log(`DIFF ${tag} ${diffs.slice(0, 6).join('; ')}`); }
    else console.log(`ok   ${tag} served=${work.service} restarts=${b.restarts.length} ${ms} ms${b.reloadsWrapped ? ' (reloads wrapped)' : ''}`);
  }
}
console.log(`\n${total - bad}/${total} runs identical to the Python engine`);
process.exit(bad ? 1 : 0);
