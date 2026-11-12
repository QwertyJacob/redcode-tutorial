/* Redcode for the tutorial: a parser and a battle engine.
 *
 * The engine is a line-by-line port of the battle loop of Landlord War
 * (landlord_war/engine.py, `_Battle._loop`, and laws.py, `BoundLaws`), which in
 * turn ports the vendored simulator of Rodrigo Setti (CC BY-NC-SA 3.0). It keeps
 * its quirks: numbers in loaded cells are not reduced modulo the core size, only
 * clamped; SLT.I and SNE.I compare whole cells for equality; SNE.F skips only if
 * both fields differ. tools/check_engine.mjs checks that it gives the same results
 * as the Python engine on every scenario in data/scenarios.
 *
 * Two modes:
 *   plain  - Core War with no landlord: programs loaded where you say, no laws
 *            (the small cores of the first chapters);
 *   arena  - a battle exported by tools/export_scenarios.py: service, mailbox,
 *            tenants, Red, Blue's laws and the referee.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ codes
  const OPS = ['DAT', 'MOV', 'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'JMP', 'JMZ', 'JMN', 'DJN', 'SPL',
    'SLT', 'CMP', 'SEQ', 'SNE', 'NOP'];
  const OPCODE = {}; OPS.forEach((n, i) => { OPCODE[n] = i; });
  const MODS = ['A', 'B', 'AB', 'BA', 'F', 'X', 'I'];
  const MODIFIER = {}; MODS.forEach((n, i) => { MODIFIER[n] = i; });
  const MODES = ['#', '$', '@', '<', '>', '*', '{', '}'];
  const MODE = {}; MODES.forEach((n, i) => { MODE[n] = i; });
  const [DAT, MOV, ADD, SUB, MUL, DIV, MODOP, JMP, JMZ, JMN, DJN, SPL, SLT, CMP, SEQ, SNE, NOP] =
    OPS.map((_, i) => i);
  const M_A = 0, M_B = 1, M_AB = 2, M_BA = 3, M_F = 4, M_X = 5, M_I = 6;
  const IMM = 0, DIR = 1;

  const pack = (op, mod, am, bm) => (op << 9) | (mod << 6) | (am << 3) | bm;
  const DAT00_K = pack(DAT, M_F, DIR, DIR);
  const CLAMP = 999999999;
  const pmod = (v, S) => ((v % S) + S) % S;

  const USES_A = new Set([MOV, ADD, SUB, MUL, DIV, MODOP, SLT, CMP, SEQ, SNE]);
  const USES_B = new Set([ADD, SUB, MUL, DIV, MODOP, SLT, CMP, SEQ, SNE, JMZ, JMN, DJN]);
  const JUMP_OPS = new Set([JMP, JMZ, JMN, DJN, SPL]);

  // events, actions, regions (as in engine.py)
  const EV_WRITE = 0, EV_READ = 1, EV_EXEC = 2, EV_JUMP = 3, EV_SPAWN = 4, EV_TICK = 5;
  const EVENT_NAMES = ['write', 'read', 'exec', 'jump', 'spawn', 'tick'];
  const ALLOW = 0, BLOCK = 1, KILL = 2, RESTART = 3;
  const ACTION_CODE = { allow: ALLOW, block: BLOCK, kill: KILL, restart_service: RESTART };
  const R_NONE = 0, R_CODE = 1, R_DATA = 2, R_MAILBOX = 3;
  const SLOT_SIZE = 6;
  const ERROR_REPLY = -1;

  function fmtInstr(k, a, b) {
    return OPS[k >> 9] + '.' + (MODS[(k >> 6) & 7] + ' ').slice(0, 2) + ' ' +
      MODES[(k >> 3) & 7] + a + ', ' + MODES[k & 7] + b;
  }
  function fmtShort(k, a, b) {
    return OPS[k >> 9] + '.' + MODS[(k >> 6) & 7] + ' ' + MODES[(k >> 3) & 7] + a + ', ' + MODES[k & 7] + b;
  }

  // ------------------------------------------------------------- the parser
  // Mirrors landlord_war/redcode.py (itself the vendored parser without eval).
  const DEFAULT_MODS = [
    [[DAT, NOP], [['#$@<>*{}', '#$@<>*{}', 'F']]],
    [[MOV, CMP], [['#', '#$@<>*{}', 'AB'], ['$@<>*{}', '#', 'B'], ['$@<>*{}', '$@<>*{}', 'I']]],
    [[ADD, SUB, MUL, DIV, MODOP], [['#', '#$@<>*{}', 'AB'], ['$@<>*{}', '#', 'B'], ['$@<>*{}', '$@<>*{}', 'F']]],
    [[SLT, SEQ, SNE], [['#', '#$@<>*{}', 'AB'], ['$@<>*{}', '#$@<>*{}', 'B']]],
    [[JMP, JMZ, JMN, DJN, SPL], [['#$@<>*{}', '#$@<>*{}', 'B']]],
  ];
  function defaultModifier(op, am, bm) {
    for (const [ops, table] of DEFAULT_MODS) {
      if (!ops.includes(op)) continue;
      for (const [as, bs, m] of table) {
        if (as.includes(MODES[am]) && bs.includes(MODES[bm])) return MODIFIER[m];
      }
    }
    throw new Error('no default modifier');
  }

  // integer expressions: + - * / % unary, parentheses, names (EQU or labels), comparisons
  function safeEval(expr, names, depth) {
    depth = depth || 0;
    if (depth > 20) throw new Error('expression nesting too deep: ' + expr);
    const text = String(expr).trim();
    const toks = text.match(/\d+|[A-Za-z_]\w*|==|!=|<=|>=|&&|\|\||[-+*/%()<>!]/g) || [];
    let i = 0;
    const peek = () => toks[i];
    const take = () => toks[i++];
    function primary() {
      const t = take();
      if (t === undefined) throw new Error('bad expression ' + expr);
      if (t === '(') { const v = orx(); if (take() !== ')') throw new Error('missing )'); return v; }
      if (t === '-') return -primary();
      if (t === '+') return primary();
      if (t === '!') return primary() ? 0 : 1;
      if (/^\d+$/.test(t)) return parseInt(t, 10);
      if (/^[A-Za-z_]/.test(t)) {
        if (!(t in names)) throw new Error('unknown name ' + t);
        const v = names[t];
        return typeof v === 'string' ? safeEval(v, names, depth + 1) : v;
      }
      throw new Error('bad token ' + t);
    }
    function mul() {
      let v = primary();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        const o = take(); const w = primary();
        if (o === '*') v = v * w;
        else {
          if (w === 0) throw new Error('division by zero');
          if (o === '/') { const q = Math.floor(Math.abs(v) / Math.abs(w)); v = ((v >= 0) === (w >= 0)) ? q : -q; }
          else { const r = Math.abs(v) % Math.abs(w); v = v >= 0 ? r : -r; }
        }
      }
      return v;
    }
    function add() {
      let v = mul();
      while (peek() === '+' || peek() === '-') { const o = take(); const w = mul(); v = o === '+' ? v + w : v - w; }
      return v;
    }
    function cmp() {
      let v = add();
      while (['==', '!=', '<', '>', '<=', '>='].includes(peek())) {
        const o = take(); const w = add();
        v = ({ '==': v === w, '!=': v !== w, '<': v < w, '>': v > w, '<=': v <= w, '>=': v >= w })[o] ? 1 : 0;
      }
      return v;
    }
    function andx() { let v = cmp(); while (peek() === '&&') { take(); const w = cmp(); v = (v && w) ? 1 : 0; } return v; }
    function orx() { let v = andx(); while (peek() === '||') { take(); const w = andx(); v = (v || w) ? 1 : 0; } return v; }
    const v = orx();
    if (i !== toks.length) throw new Error('bad expression ' + expr);
    return v;
  }

  const INSTR_RE = /^([a-z]{3})(?:\s*\.\s*([abfxi]{1,2}))?(?:\s*([#$*@{<}>])?\s*([^,$]+))?(?:\s*,\s*([#$*@{<}>])?\s*(.+))?$/i;

  /* parse(text, defs) -> {instructions: [[op,mod,am,an,bm,bn]...], start, labels, comments, lines}
   * `lines[k]` is the source line number of instruction k. */
  function parse(text, definitions) {
    const lines = text.split('\n');
    const defs = Object.assign({}, definitions || {});
    let env = Object.assign({}, defs);
    let labels = {}, raw = [], comments = {}, srcLine = [];
    let startExpr = null, name = 'Unnamed', found = false;
    for (let n = 0; n < lines.length; n++) {
      let line = lines[n].trim();
      if (!line) continue;
      if (/^;redcode\w*$/i.test(line)) {
        if (found) break;
        raw = []; labels = {}; comments = {}; srcLine = []; env = Object.assign({}, defs); found = true; continue;
      }
      let m = line.match(/^;name\s+(.+)$/i);
      if (m) { name = m[1].trim(); continue; }
      if (/^;author\s+(.+)$/i.test(line) || /^;assert\s+(.+)$/i.test(line)) continue;
      let comment = null;
      m = line.match(/^([^;]*)\s*;(.*)$/);
      if (m) { comment = m[2].trim(); line = m[1].trim(); if (!line) continue; }
      m = line.match(/^ORG\s+(.+)\s*$/i);
      if (m) { startExpr = m[1]; continue; }
      m = line.match(/^END(?:\s+([^\s]+))?$/i);
      if (m) { if (m[1]) startExpr = m[1]; break; }
      m = line.match(/^([a-z]\w*)\s+EQU\s+(.*)\s*$/i);
      if (m) { env[m[1]] = m[2].trim(); continue; }
      for (;;) {
        m = line.match(/^([a-z]\w*)\s+(.+)\s*$/i);
        if (m && !(m[1].toUpperCase() in OPCODE)) { labels[m[1]] = raw.length; line = m[2]; continue; }
        break;
      }
      m = line.match(INSTR_RE);
      if (!m) {
        const m2 = line.match(/^([a-z]\w*)$/i);
        if (m2 && !(m2[1].toUpperCase() in OPCODE)) { labels[m2[1]] = raw.length; continue; }
        throw new Error('riga ' + (n + 1) + ': istruzione attesa: "' + line + '"');
      }
      const [, opc, modifier, aMode, aExpr, bMode, bExpr] = m;
      if (!(opc.toUpperCase() in OPCODE)) throw new Error('riga ' + (n + 1) + ': opcode sconosciuto ' + opc);
      if (modifier !== undefined && !(modifier.toUpperCase() in MODIFIER)) throw new Error('riga ' + (n + 1) + ': modificatore sconosciuto ' + modifier);
      if (comment) comments[raw.length] = comment;
      srcLine.push(n);
      raw.push([opc, modifier, aMode, aExpr, bMode, bExpr]);
    }
    const instructions = raw.map(([opc, modifier, aMode, aExpr, bMode, bExpr], n) => {
      const names = Object.assign({}, env);
      for (const k in labels) names[k] = labels[k] - n;
      const op = OPCODE[opc.toUpperCase()];
      const am = aMode !== undefined ? MODE[aMode] : DIR;
      const an = aExpr !== undefined ? safeEval(aExpr, names) : 0;
      let bm;
      if (bMode !== undefined) bm = MODE[bMode];
      else bm = (op === DAT && aExpr !== undefined) ? IMM : DIR;
      const bn = bExpr !== undefined ? safeEval(bExpr, names) : 0;
      const mod = modifier !== undefined ? MODIFIER[modifier.toUpperCase()] : defaultModifier(op, am, bm);
      return [op, mod, am, an, bm, bn];
    });
    let start = 0;
    if (startExpr !== null) {
      const names = Object.assign({}, env, labels);
      start = safeEval(startExpr, names);
    }
    return { instructions, start, name, labels, comments, lines: srcLine };
  }

  // ------------------------------------------------------------- the engine
  const FIELDS = ['ins', 'an', 'bn', 'bd', 'own', 'lw', 'lo', 'mtag', 'itag', 'flg', 'region', 'entry',
    'okc', 'cnry', 'sslot', 'spick'];
  const FIELD_DEFAULT = { ins: DAT00_K, an: 0, bn: 0, bd: 1, own: -1, lw: -1, lo: -1, mtag: 0, itag: 0, flg: 0,
    region: R_NONE, entry: -1, okc: -1, cnry: -1, sslot: -3, spick: -1 };

  class World {
    constructor(S) {
      this.S = S;
      for (const f of FIELDS) {
        this[f] = new Int32Array(S);
        if (FIELD_DEFAULT[f] !== 0) this[f].fill(FIELD_DEFAULT[f]);
      }
      this.t = 0;
      this.svc = -1; this.red = -1;
      this.last_prog_t = 0;
      this.canary_broken = 0; this.canary_vals = []; this.canary_addr = []; this.canary_ok = [];
      this.alarms = []; this.alarm_counts = [];
      this.rate_log = {};
      this.queues = [];
    }
  }

  class SimpleDeque {          // rate logs: append at the end, drop from the front
    constructor() { this.a = []; this.h = 0; }
    push(x) { this.a.push(x); }
    get length() { return this.a.length - this.h; }
    first() { return this.a[this.h]; }
    shift() { const x = this.a[this.h++]; if (this.h > 64 && this.h * 2 > this.a.length) { this.a = this.a.slice(this.h); this.h = 0; } return x; }
    at(i) { return this.a[this.h + i]; }
  }

  /* The laws, compiled to closures (laws.py, BoundLaws). `fired` counts, per law,
   * how many times its condition held (for the viewer; no effect on the battle). */
  function bindLaws(laws, battle, enabled) {
    const W = battle.W, S = W.S, svc = W.svc;
    const cc = battle.cost.check_cycles;
    const evOn = battle.events_on || {};
    const live = laws.map((l, i) => (enabled ? enabled[i] : true) && evOn[l.event] !== false);
    const counter = [0];
    const rateW = {};
    const iterAtoms = function* (c) {
      if (!c) return;
      if (c[0] === 'atom') { yield c; return; }
      for (let k = 1; k < c.length; k++) yield* iterAtoms(c[k]);
    };
    laws.forEach((l, i) => {
      if (!live[i]) return;
      for (const a of iterAtoms(l.cond)) {
        if (a[1] === 'rate_gt') {
          const e = EVENT_NAMES.indexOf(a[2]);
          rateW[e] = Math.max(rateW[e] || 0, a[4]);
        }
      }
    });
    const nprog = W.queues.length;
    W.alarm_counts = new Array(nprog).fill(0);
    const logs = {};
    for (const e in rateW) { logs[e] = []; for (let p = 0; p < nprog; p++) logs[e].push(new SimpleDeque()); }
    W.rate_log = logs;
    const { region, own, mtag, itag, flg, entry } = W;

    function mkAtom(a) {
      const name = a[1];
      if (name === 'actor_is_service') return (pid, proc) => { proc[1] += cc; return pid === svc; };
      if (name === 'target_in') {
        const R = a[2];
        if (R === 'service_code') return (pid, proc, pc, t) => { proc[1] += cc; return region[t] === R_CODE; };
        if (R === 'service_data') return (pid, proc, pc, t) => { proc[1] += cc; return region[t] === R_DATA; };
        if (R === 'mailbox') return (pid, proc, pc, t) => { proc[1] += cc; return region[t] === R_MAILBOX; };
        if (R === 'own_region') return (pid, proc, pc, t) => { proc[1] += cc; return own[t] === pid; };
        return (pid, proc, pc, t) => { proc[1] += cc; return own[t] < 0; };
      }
      if (name === 'owner_eq') return (pid, proc, pc, t) => { proc[1] += cc; return own[t] === pid; };
      if (name === 'tag_eq') return (pid, proc, pc, t) => { proc[1] += cc; return mtag[t] === itag[pc]; };
      if (name === 'flag') { const bit = 1 << a[2]; return (pid, proc, pc, t) => { proc[1] += cc; return (flg[t] & bit) !== 0; }; }
      if (name === 'distance_gt') {
        const N = a[2];
        return (pid, proc, pc, t) => { proc[1] += cc; const d = pmod(t - pc, S); return (d <= S - d ? d : S - d) > N; };
      }
      if (name === 'is_entry') return (pid, proc, pc, t) => { proc[1] += cc; return entry[t] === pid; };
      if (name === 'rate_gt') {
        const e = EVENT_NAMES.indexOf(a[2]), n = a[3], Wd = a[4];
        const lg = logs[e];
        return (pid, proc) => {
          proc[1] += cc;
          const dq = lg[pid]; const lim = W.t - Wd; let c = 0;
          for (let k = dq.length - 1; k >= 0; k--) {
            if (dq.at(k) <= lim) break;
            c += 1;
            if (c > n) return true;
          }
          return false;
        };
      }
      if (name === 'canaries_intact') return (pid, proc) => { proc[1] += cc; return W.canary_broken === 0; };
      if (name === 'service_stalled') { const Wd = a[2]; return (pid, proc) => { proc[1] += cc; return W.t - W.last_prog_t >= Wd; }; }
      throw new Error('atom ' + name);
    }
    function mk(c) {
      if (c[0] === 'atom') { const f = mkAtom(c); return (p, q, r, t) => { counter[0]++; return f(p, q, r, t); }; }
      if (c[0] === 'not') { const x = mk(c[1]); return (p, q, r, t) => !x(p, q, r, t); }
      const x = mk(c[1]), y = mk(c[2]);
      if (c[0] === 'and') return (p, q, r, t) => x(p, q, r, t) && y(p, q, r, t);
      return (p, q, r, t) => x(p, q, r, t) || y(p, q, r, t);
    }
    function mkEffect(e, li) {
      if (e[0] === 'set_flag') { const bit = 1 << e[1]; return (pid, t) => { flg[t] |= bit; }; }
      if (e[0] === 'clear_flag') { const mask = ~(1 << e[1]); return (pid, t) => { flg[t] &= mask; }; }
      return (pid) => { W.alarm_counts[pid] += 1; if (W.alarms.length < 1000) W.alarms.push([W.t, pid, li]); };
    }
    const perEvent = [[], [], [], [], [], []];
    const fired = new Array(laws.length).fill(0);
    const acted = new Array(laws.length).fill(0);
    laws.forEach((l, li) => {
      if (!live[li]) return;
      const e = EVENT_NAMES.indexOf(l.event);
      perEvent[e].push([li, l.cond ? mk(l.cond) : null, ACTION_CODE[l.action], (l.effects || []).map(x => mkEffect(x, li)), l.T]);
    });
    const hooked = [0, 1, 2, 3, 4].map(e => perEvent[e].length > 0 || (e in rateW));
    const tickPeriods = Array.from(new Set(perEvent[EV_TICK].map(x => x[4]))).sort((a, b) => a - b);
    function mkEval(e) {
      const ls = perEvent[e];
      const counted = e in rateW;
      const lg = logs[e];
      const maxW = rateW[e] || 0;
      return (pid, proc, pc, t) => {
        if (counted) {
          const dq = lg[pid]; const now = W.t;
          dq.push(now);
          while (dq.first() <= now - maxW) dq.shift();
        }
        for (const [li, cond, act, effs] of ls) {
          if (cond === null || cond(pid, proc, pc, t)) {
            fired[li]++;
            for (const h of effs) h(pid, t);
            if (act !== ALLOW) { acted[li]++; battle.lastLaw = li; return act; }
          }
        }
        return ALLOW;
      };
    }
    const evaluators = [0, 1, 2, 3, 4].map(e => hooked[e] ? mkEval(e) : null);
    const tickLaws = perEvent[EV_TICK];
    const dummy = [0, 0.0];
    function tick(now) {
      const q = W.queues[svc];
      const proc = q.length ? q[0] : dummy;
      const pc = q.length ? proc[0] : battle.svc_entry;
      for (const [li, cond, act, effs, T] of tickLaws) {
        if (now % T) continue;
        if (cond === null || cond(svc, proc, pc, pc)) {
          fired[li]++;
          for (const h of effs) h(svc, pc);
          if (act !== ALLOW) { acted[li]++; battle.lastLaw = li; return act; }
        }
      }
      return ALLOW;
    }
    return { hooked, tickPeriods, costed: cc > 0, evaluators, tick, counter, fired, acted };
  }

  class Kill extends Error {}
  const KILL_SIGNAL = new Kill('kill');
  const SKIP_SIGNAL = { skip: true };

  class Battle {
    /* Arena battle from an exported scenario. opts.enabled: which laws are on. */
    static fromScenario(sc, opts) {
      opts = opts || {};
      const b = new Battle();
      b.sc = sc;
      b.plain = false;
      b.S = sc.S; b.cycles = opts.cycles || sc.cycles; b.maxp = sc.maxp;
      const W = b.W = new World(sc.S);
      const nf = sc.fields.length;
      for (const c of sc.cells) {
        const a = c[0];
        for (let f = 0; f < nf; f++) W[sc.fields[f]][a] = c[1 + f];
      }
      // empty cells carry the free tag
      if (sc.free_tag) {
        const set = new Set(sc.cells.map(c => c[0]));
        for (let a = 0; a < sc.S; a++) if (!set.has(a)) { W.mtag[a] = sc.free_tag; W.itag[a] = sc.free_tag; }
      }
      W.svc = sc.svc; W.red = sc.red;
      W.queues = sc.queues.map(q => q.map(pc => [pc, 0.0]));
      b.names = sc.names;
      b.order = sc.order.slice();
      b.mb_base = sc.mb_base; b.n_slots = sc.n_slots;
      b.slot_of = {}; for (const k in sc.slot_of) b.slot_of[+k] = sc.slot_of[k];
      b.win_base = sc.win_base; b.window_len = sc.window_len; b.mb_len = sc.mb_len;
      b.free_tag = sc.free_tag; b.tag_bits = sc.tag_bits;
      b.ptag = sc.ptag;
      b.fill_max = sc.fill_max;
      b.cost = sc.cost; b.stall_window = sc.stall_window;
      b.events_on = sc.events_on;
      b.laws = sc.laws;
      b.enabled = opts.enabled || sc.laws.map(() => true);
      b.svc_resume = -1;
      b.applySvcScalars(sc.svc0);
      W.canary_addr = sc.svc0.canary_addr.slice();
      W.canary_vals = sc.svc0.canary_vals.map(v => v.slice());
      for (let k = 0; k < W.canary_addr.length; k++) W.cnry[W.canary_addr[k]] = k;
      b.svc_clean = b.cleanFromCore(sc.svc0);
      b.reloadIndex = 0;
      b.reloadsWrapped = false;
      b.init();
      return b;
    }

    /* Plain Core War: programs = [{name, prog (parsed), base}], core size S. */
    static plainCore(S, programs, opts) {
      opts = opts || {};
      const b = new Battle();
      b.plain = true;
      b.S = S; b.cycles = opts.cycles || 1e9; b.maxp = opts.maxp || 64;
      const W = b.W = new World(S);
      b.names = programs.map(p => p.name);
      programs.forEach((p, k) => {
        p.prog.instructions.forEach((i, off) => {
          const a = pmod(p.base + off, S);
          W.ins[a] = pack(i[0], i[1], i[2], i[4]);
          W.an[a] = i[3]; W.bn[a] = i[5]; W.bd[a] = opts.bound ? 1 : 0;
          W.own[a] = k; W.lw[a] = k;
        });
        W.queues.push([[pmod(p.base + p.prog.start, S), 0.0]]);
      });
      b.order = programs.map((_, k) => k);
      b.laws = []; b.enabled = [];
      b.cost = { check_cycles: 0, restart_downtime: 200 };
      b.init();
      return b;
    }

    applySvcScalars(s) {
      this.svc_base = s.svc_base; this.svc_entry = s.svc_entry; this.svc_code = s.svc_code;
      this.prog_addr = s.prog_addr; this.vault_addr = s.vault_addr; this.ret_addr = s.ret_addr;
      this.work_addr = s.work_addr; this.table_addr = s.table_addr;
      this.vault_orig = s.vault_orig.slice();
      this.mb_tag = s.mb_tag;
      this.svc_desc = s.desc;
    }

    cleanFromCore(s) {
      const W = this.W, S = this.S, out = [];
      for (let off = 0; off < s.desc.len; off++) {
        const a = pmod(s.svc_base + off, S);
        out.push([W.ins[a], W.an[a], W.bn[a]]);
      }
      return out;
    }

    /* _Battle._load_service for a restart: the next exported image. */
    loadService() {
      const W = this.W, S = this.S, sc = this.sc;
      for (let x = 0; x < this.window_len; x++) {
        const a = (this.win_base + x) % S;
        W.ins[a] = DAT00_K; W.an[a] = 0; W.bn[a] = 0; W.bd[a] = 1;
        W.own[a] = -1; W.lw[a] = -1; W.lo[a] = -1;
        W.mtag[a] = this.free_tag; W.itag[a] = this.free_tag; W.flg[a] = 0;
        W.region[a] = R_NONE; W.entry[a] = -1; W.okc[a] = -1; W.cnry[a] = -1;
        W.sslot[a] = -3; W.spick[a] = -1;
      }
      let k = this.reloadIndex++;
      if (k >= sc.loads.length) { k = k % sc.loads.length; this.reloadsWrapped = true; }
      const ld = sc.loads[k];
      const tp = sc.templates[ld.t];
      if (this.tag_bits) {
        this.mb_tag = ld.mb_tag;
        for (let f = 0; f < this.mb_len; f++) {
          const a = (this.mb_base + f) % S;
          W.mtag[a] = W.itag[a] = ld.mb_tag;
        }
      }
      const nf = sc.fields.length;
      for (let x = 0; x < this.window_len; x++) {
        const a = (this.win_base + x) % S;
        const c = tp.window[x];
        for (let f = 0; f < nf; f++) W[sc.fields[f]][a] = c[f];
        const r = tp.roles[x];
        const tagOf = (role) => role === 'free' ? this.free_tag : ld.tags[role];
        W.mtag[a] = tagOf(r[0]); W.itag[a] = tagOf(r[1]);
      }
      W.canary_addr = tp.canary_addr.slice();
      for (let i = 0; i < W.canary_addr.length; i++) {
        const a = W.canary_addr[i];
        W.an[a] = ld.cvals[i]; W.bn[a] = ld.cvals[i];
        W.cnry[a] = i;
      }
      W.canary_vals = W.canary_addr.map(a => [W.ins[a], W.an[a], W.bn[a]]);
      W.canary_broken = 0;
      this.applySvcScalars(tp);
      this.svc_clean = this.cleanFromCore(tp);
    }

    init() {
      const W = this.W, nprog = W.queues.length;
      this.t = 0;
      this.work = new Array(nprog).fill(0);
      this.icount = new Array(nprog).fill(0);
      this.served_red = 0;
      this.restarts = [];
      this.events = [];
      this.log = [];                    // events for the viewer (Italian, see viewer.js)
      this.lastLaw = -1;
      this.LAW = null;
      if (!this.plain && this.laws && this.laws.length) {
        this.LAW = bindLaws(this.laws, this, this.enabled);
      }
      const L = this.LAW;
      this.H = L ? L.hooked : [false, false, false, false, false];
      this.tickList = L ? L.tickPeriods : [];
      this.COSTED = L ? L.costed : false;
      this.restartPending = false;
      this.cur = [-1, -1];
      this.red_slot = this.plain ? -1 : (this.slot_of[W.red] !== undefined ? this.slot_of[W.red] : -1);
      this.gt = { inj: -1, dev: -1, vault: -1, inj_cycles: 0, dev_cycles: 0, vault_cycles: 0, down_cycles: 0,
        inj_first: -1, dev_first: -1, vault_first: -1, down_first: -1, down_run_max: 0,
        injl: -1, injl_cycles: 0, injl_first: -1, devl_cycles: 0 };
      this.down_run = 0;
      this.down = false;
      W.canary_ok = W.canary_addr.map(() => true);
      this.last_prog_v = 0;
      W.last_prog_t = 0;
      this.svc_code0 = this.plain ? 0 : this.svc_code[0];
      this.trace = null;                // set to [] to record what each instruction does
    }

    // ---------------------------------------------------------- helpers
    gate(ev, pid, proc, pc, tgt, kind) {
      const a = this.LAW.evaluators[ev](pid, proc, pc, tgt);
      if (a === ALLOW) return true;
      if (this.trace) this.trace.push({ k: 'law', ev: kind, law: this.lastLaw, act: a, tgt });
      if (a === BLOCK) return false;
      if (a === KILL) throw KILL_SIGNAL;
      this.restartPending = true;
      return false;
    }

    touch(t, pid, pc) {
      const W = this.W, SVC = W.svc;
      if (W.own[t] < 0) {
        W.own[t] = pid;
        W.mtag[t] = (pid === SVC) ? W.itag[pc] : (this.ptag ? this.ptag[pid] : 0);
      }
      W.lw[t] = pid;
      W.lo[t] = (pid === SVC) ? this.cur[1] : -1;
      W.itag[t] = W.mtag[t];
      const k = W.cnry[t];
      if (k >= 0) {
        const cv = W.canary_vals[k];
        const intact = W.ins[t] === cv[0] && W.an[t] === cv[1] && W.bn[t] === cv[2];
        const was = W.canary_ok[k];
        if (intact !== was) {
          W.canary_ok[k] = intact;
          W.canary_broken += intact ? -1 : 1;
        }
      }
    }

    putA(t, v) {
      const W = this.W, S = this.S;
      if (W.bd[t]) { if (v > S || v < -S) v = pmod(v, S); } else if (v > CLAMP) v = CLAMP; else if (v < -CLAMP) v = -CLAMP;
      if (this.trace) this.trace.push({ k: 'set', addr: t, f: 'A', old: W.an[t], v });
      W.an[t] = v;
    }

    putB(t, v) {
      const W = this.W, S = this.S;
      if (W.bd[t]) { if (v > S || v < -S) v = pmod(v, S); } else if (v > CLAMP) v = CLAMP; else if (v < -CLAMP) v = -CLAMP;
      if (this.trace) this.trace.push({ k: 'set', addr: t, f: 'B', old: W.bn[t], v });
      W.bn[t] = v;
    }

    decSnapshot(v, bound) {
      v -= 1;
      if (bound && (v > this.S || v < -this.S)) v = pmod(v, this.S);
      return v;
    }

    endHijacks(t) {
      const gt = this.gt;
      if (gt.inj >= 0) { this.events.push({ kind: 'injection', start: gt.inj, end: t }); gt.inj = -1; }
      if (gt.dev >= 0) { this.events.push({ kind: 'deviation', start: gt.dev, end: t }); gt.dev = -1; }
      gt.injl = -1;
    }

    doRestart(t) {
      const W = this.W, S = this.S, SVC = W.svc;
      if (this.svc_resume > t) return;
      this.endHijacks(t);
      W.queues[SVC].length = 0;
      this.loadService();
      for (let j = 0; j < this.n_slots; j++) {
        const fa = (this.mb_base + j * SLOT_SIZE) % S;
        const ra = (fa + 5) % S;
        if (W.bn[fa] !== 0) {
          W.bn[fa] = 0;
          W.ins[ra] = DAT00_K; W.an[ra] = 0; W.bn[ra] = ERROR_REPLY;
          W.lw[fa] = W.lw[ra] = SVC;
          W.lo[fa] = W.lo[ra] = -1;
        }
      }
      W.canary_ok = W.canary_addr.map(() => true);
      this.svc_resume = t + this.cost.restart_downtime;
      this.last_prog_v = W.bn[this.prog_addr];
      W.last_prog_t = t;
      this.cur[0] = this.cur[1] = -1;
      this.svc_code0 = this.svc_code[0];
      this.restarts.push(t);
      this.log.push({ t, k: 'restart', law: this.lastLaw });
      const gt = this.gt;
      if (gt.vault >= 0) { this.events.push({ kind: 'vault', start: gt.vault, end: t }); gt.vault = -1; }
    }

    // ---------------------------------------------------------- one cycle
    /* Runs cycle t+1. If onlyPid is given (plain mode, step by step), runs just the
     * turn of that program. Returns false once the battle is over. */
    cycle() {
      if (this.t >= this.cycles) return false;
      const t = ++this.t;
      const W = this.W, S = this.S;
      W.t = t;
      const plain = this.plain;
      const SVC = W.svc, RED = W.red;
      if (!plain && this.svc_resume === t) {
        W.queues[SVC].push([this.svc_entry, 0.0]);
        this.svc_resume = -1;
        this.log.push({ t, k: 'resume' });
      }
      for (const pid of this.order) this.turn(pid, t);
      if (plain) return true;
      this.afterCycle(t);
      return true;
    }

    turn(pid, t) {
      const W = this.W, S = this.S;
      const q = W.queues[pid];
      if (!q.length) return null;
      const proc = q.shift();
      const ins = W.ins, an = W.an, bn = W.bn, bd = W.bd;
      const plain = this.plain;
      const SVC = W.svc, RED = W.red;
      const H = this.H;
      const LAW = this.LAW;
      const trace = this.trace;
      if (this.COSTED && proc[1] >= 1.0) {
        proc[1] -= 1.0;
        q.push(proc);
        if (trace) trace.push({ k: 'stall', pid });
        return { pid, stalled: true };
      }
      const pc = proc[0];
      this.icount[pid] += 1;
      let nxt = -1, child = -1, jumped = false;
      let ra = pc, rb = pc;
      const gt = this.gt;
      if (trace) trace.push({ k: 'exec', pid, pc, ins: ins[pc], an: an[pc], bn: bn[pc] });
      try {
        if (pid === SVC && !plain) {
          const s = W.sslot[pc];
          if (s !== -3) {
            if (s === -1) { this.cur[0] = this.cur[1] = -1; }
            else {
              this.cur[0] = s;
              if (W.spick[pc] === s) {
                const fa = (this.mb_base + s * SLOT_SIZE) % S;
                let origin = W.lw[fa];
                if (RED >= 0) {
                  for (let f = 1; f < 5; f++) if (W.lw[(fa + f) % S] === RED) origin = RED;
                }
                this.cur[1] = origin;
                if (trace) trace.push({ k: 'pickup', slot: s, origin });
              }
            }
          }
        }
        if (W.okc[pc] === pid) {
          this.work[pid] += 1;
          if (trace) trace.push({ k: 'ok', pid });
          if (pid === SVC && !plain && this.red_slot >= 0 && W.sslot[pc] === this.red_slot) this.served_red += 1;
        }
        if (H[EV_EXEC] && !this.gate(EV_EXEC, pid, proc, pc, pc, 'exec')) {
          nxt = pc + 1;
          throw SKIP_SIGNAL;
        }
        if (pid === SVC && !plain) {
          if (RED >= 0 && (gt.inj < 0 || gt.injl < 0) && (ins[pc] >> 9) !== 0) {
            const w_ = W.lw[pc];
            if (w_ === RED || (w_ === SVC && W.lo[pc] === RED)) {
              if (gt.injl < 0) { gt.injl = t; if (gt.injl_first < 0) gt.injl_first = t; this.log.push({ t, k: 'injl', pc }); }
              const off_ = pmod(pc - this.svc_base, S);
              const clean = this.svc_clean;
              if (gt.inj < 0 && (off_ >= clean.length || ins[pc] !== clean[off_][0] || an[pc] !== clean[off_][1] || bn[pc] !== clean[off_][2])) {
                gt.inj = t;
                if (gt.inj_first < 0) gt.inj_first = t;
                this.log.push({ t, k: 'inj', pc, via: w_ === RED ? 'direct' : 'mailbox' });
              }
            }
          }
        }
        const k = ins[pc];
        const op = k >> 9, mod = (k >> 6) & 7, am = (k >> 3) & 7, bm = k & 7;
        const ian = an[pc], ibn = bn[pc];
        let ak, aa, ab, abd, bk, ba, bb, bbd, p, off;
        // ---- A operand ----
        if (am === 0) {
          ra = pc;
          if (USES_A.has(op)) { ak = ins[pc]; aa = an[pc]; ab = bn[pc]; abd = bd[pc]; }
        } else {
          ra = pmod(pc + ian, S);
          if (am !== 1) {
            p = ra;
            if (am === 6) {
              if (!H[EV_WRITE] || this.gate(EV_WRITE, pid, proc, pc, p, 'write')) { this.putA(p, an[p] - 1); this.touch(p, pid, pc); }
            } else if (am === 3) {
              if (!H[EV_WRITE] || this.gate(EV_WRITE, pid, proc, pc, p, 'write')) { this.putB(p, bn[p] - 1); this.touch(p, pid, pc); }
            }
            if (H[EV_READ] && !this.gate(EV_READ, pid, proc, pc, p, 'read')) off = 0;
            else off = am >= 5 ? an[p] : bn[p];
            ra = pmod(p + off, S);
            if (trace) trace.push({ k: 'ptr', side: 'A', p, mode: am, target: ra, off });
          }
          if (USES_A.has(op)) {
            if (H[EV_READ] && !this.gate(EV_READ, pid, proc, pc, ra, 'read')) { ak = DAT00_K; aa = 0; ab = 0; abd = 1; }
            else { ak = ins[ra]; aa = an[ra]; ab = bn[ra]; abd = bd[ra]; }
            if (trace) trace.push({ k: 'read', side: 'A', addr: ra });
          }
          if (am === 7) {
            if (!H[EV_WRITE] || this.gate(EV_WRITE, pid, proc, pc, p, 'write')) { this.putA(p, an[p] + 1); this.touch(p, pid, pc); }
          } else if (am === 4) {
            if (!H[EV_WRITE] || this.gate(EV_WRITE, pid, proc, pc, p, 'write')) { this.putB(p, bn[p] + 1); this.touch(p, pid, pc); }
          }
        }
        // ---- B operand ----
        if (bm === 0) {
          rb = pc;
          if (USES_B.has(op)) { bk = ins[pc]; ba = an[pc]; bb = bn[pc]; bbd = bd[pc]; }
        } else {
          rb = pmod(pc + ibn, S);
          if (bm !== 1) {
            p = rb;
            if (bm === 6) {
              if (!H[EV_WRITE] || this.gate(EV_WRITE, pid, proc, pc, p, 'write')) { this.putA(p, an[p] - 1); this.touch(p, pid, pc); }
            } else if (bm === 3) {
              if (!H[EV_WRITE] || this.gate(EV_WRITE, pid, proc, pc, p, 'write')) { this.putB(p, bn[p] - 1); this.touch(p, pid, pc); }
            }
            if (H[EV_READ] && !this.gate(EV_READ, pid, proc, pc, p, 'read')) off = 0;
            else off = bm >= 5 ? an[p] : bn[p];
            rb = pmod(p + off, S);
            if (trace) trace.push({ k: 'ptr', side: 'B', p, mode: bm, target: rb, off });
          }
          if (USES_B.has(op)) {
            if (H[EV_READ] && !this.gate(EV_READ, pid, proc, pc, rb, 'read')) { bk = DAT00_K; ba = 0; bb = 0; bbd = 1; }
            else { bk = ins[rb]; ba = an[rb]; bb = bn[rb]; bbd = bd[rb]; }
            if (trace) trace.push({ k: 'read', side: 'B', addr: rb });
          }
          if (bm === 7) {
            if (!H[EV_WRITE] || this.gate(EV_WRITE, pid, proc, pc, p, 'write')) { this.putA(p, an[p] + 1); this.touch(p, pid, pc); }
          } else if (bm === 4) {
            if (!H[EV_WRITE] || this.gate(EV_WRITE, pid, proc, pc, p, 'write')) { this.putB(p, bn[p] + 1); this.touch(p, pid, pc); }
          }
        }
        if (trace) trace.push({ k: 'ops', ra, rb });
        // ---- execute ----
        if (op === MOV) {
          if (!H[EV_WRITE] || this.gate(EV_WRITE, pid, proc, pc, rb, 'write')) {
            if (mod === M_I) {
              if (trace) trace.push({ k: 'setI', addr: rb, old: [ins[rb], an[rb], bn[rb]], v: [ak, aa, ab] });
              ins[rb] = ak; an[rb] = aa; bn[rb] = ab; bd[rb] = abd;
            } else if (mod === M_A) this.putA(rb, aa);
            else if (mod === M_B) this.putB(rb, ab);
            else if (mod === M_AB) this.putB(rb, aa);
            else if (mod === M_BA) this.putA(rb, ab);
            else if (mod === M_F) { this.putA(rb, aa); this.putB(rb, ab); }
            else { this.putB(rb, aa); this.putA(rb, ab); }
            this.touch(rb, pid, pc);
          }
          nxt = pc + 1;
        } else if (op >= ADD && op <= MODOP) {
          if (!H[EV_WRITE] || this.gate(EV_WRITE, pid, proc, pc, rb, 'write')) {
            const f = ARITH[op];
            let wrote = false;
            try {
              if (mod === M_A) this.putA(rb, f(ba, aa));
              else if (mod === M_B) this.putB(rb, f(bb, ab));
              else if (mod === M_AB) this.putB(rb, f(bb, aa));
              else if (mod === M_BA) this.putA(rb, f(ba, ab));
              else if (mod === M_X) { this.putB(rb, f(bb, aa)); wrote = true; this.putA(rb, f(ba, ab)); }
              else { this.putA(rb, f(ba, aa)); wrote = true; this.putB(rb, f(bb, ab)); }
              wrote = true;
              nxt = pc + 1;
            } catch (e) {
              if (e !== ZERO_DIV) throw e;
              nxt = -1;
              if (trace) trace.push({ k: 'div0' });
            }
            if (wrote) this.touch(rb, pid, pc);
            if (trace) trace.push({ k: 'arith', op, mod, a: [aa, ab], b: [ba, bb] });
          } else nxt = pc + 1;
        } else if (op === JMP) {
          nxt = ra; jumped = true;
        } else if (op === JMZ) {
          let c;
          if (mod === M_A || mod === M_BA) c = ba === 0;
          else if (mod === M_B || mod === M_AB) c = bb === 0;
          else c = ba === 0 && bb === 0;
          nxt = c ? ra : pc + 1; jumped = c;
          if (trace) trace.push({ k: 'test', op, mod, ba, bb, c });
        } else if (op === JMN) {
          let c;
          if (mod === M_A || mod === M_BA) c = ba !== 0;
          else if (mod === M_B || mod === M_AB) c = bb !== 0;
          else c = ba !== 0 || bb !== 0;
          nxt = c ? ra : pc + 1; jumped = c;
          if (trace) trace.push({ k: 'test', op, mod, ba, bb, c });
        } else if (op === DJN) {
          const okw = !H[EV_WRITE] || this.gate(EV_WRITE, pid, proc, pc, rb, 'write');
          let c;
          if (mod === M_A || mod === M_BA) {
            if (okw) this.putA(rb, an[rb] - 1);
            ba = this.decSnapshot(ba, bbd); c = ba !== 0;
          } else if (mod === M_B || mod === M_AB) {
            if (okw) this.putB(rb, bn[rb] - 1);
            bb = this.decSnapshot(bb, bbd); c = bb !== 0;
          } else {
            if (okw) { this.putA(rb, an[rb] - 1); this.putB(rb, bn[rb] - 1); }
            ba = this.decSnapshot(ba, bbd); bb = this.decSnapshot(bb, bbd);
            c = ba !== 0 || bb !== 0;
          }
          if (okw) this.touch(rb, pid, pc);
          nxt = c ? ra : pc + 1; jumped = c;
          if (trace) trace.push({ k: 'test', op, mod, ba, bb, c });
        } else if (op === SPL) {
          nxt = pc + 1;
          if (!H[EV_SPAWN] || this.gate(EV_SPAWN, pid, proc, pc, ra, 'spawn')) child = ra;
          else if (trace) trace.push({ k: 'spawnblocked' });
        } else if (op >= SLT && op <= SNE) {
          let c;
          if (mod === M_I) c = ak === bk && aa === ba && ab === bb;
          else if (op === SLT) {
            if (mod === M_A) c = aa < ba; else if (mod === M_B) c = ab < bb; else if (mod === M_AB) c = aa < bb;
            else if (mod === M_BA) c = ab < ba; else if (mod === M_F) c = aa < ba && ab < bb; else c = aa < bb && ab < ba;
          } else if (op === SNE) {
            if (mod === M_A) c = aa !== ba; else if (mod === M_B) c = ab !== bb; else if (mod === M_AB) c = aa !== bb;
            else if (mod === M_BA) c = ab !== ba; else if (mod === M_F) c = aa !== ba && ab !== bb; else c = aa !== bb && ab !== ba;
          } else {
            if (mod === M_A) c = aa === ba; else if (mod === M_B) c = ab === bb; else if (mod === M_AB) c = aa === bb;
            else if (mod === M_BA) c = ab === ba; else if (mod === M_F) c = aa === ba && ab === bb; else c = aa === bb && ab === ba;
          }
          nxt = c ? pc + 2 : pc + 1;
          if (trace) trace.push({ k: 'cmp', op, mod, a: [ak, aa, ab], b: [bk, ba, bb], skip: c });
        } else if (op === NOP) {
          nxt = pc + 1;
        }
        // DAT: nxt stays -1, the process dies
        if (jumped) {
          if (H[EV_JUMP] && !this.gate(EV_JUMP, pid, proc, pc, ra, 'jump')) {
            nxt = pc + 1;
            if (trace) trace.push({ k: 'jumpblocked' });
          } else if (pid === SVC && !plain && gt.dev < 0 && W.entry[ra] !== SVC) {
            gt.dev = t;
            if (gt.dev_first < 0) gt.dev_first = t;
            this.log.push({ t, k: 'dev', from: pc, to: ra });
          }
        }
      } catch (e) {
        if (e === SKIP_SIGNAL) { /* blocked exec: the instruction is skipped */ }
        else if (e === KILL_SIGNAL) { nxt = -1; child = -1; }
        else throw e;
      }
      if (nxt >= 0) {
        proc[0] = pmod(nxt, S);
        q.push(proc);
      }
      let spawned = false;
      if (child >= 0 && q.length < this.maxp) { q.push([pmod(child, S), 0.0]); spawned = true; }
      if (trace) trace.push({ k: 'end', pid, pc, next: nxt >= 0 ? pmod(nxt, S) : -1, child: spawned ? pmod(child, S) : -1, ra, rb });
      if (nxt < 0 && !plain) {
        if (pid === SVC && !q.length) this.log.push({ t, k: 'svcdead', pc });
      }
      if (this.restartPending) {
        this.restartPending = false;
        this.doRestart(t);
      }
      return { pid, pc, next: nxt >= 0 ? pmod(nxt, S) : -1, child: spawned ? pmod(child, S) : -1, ra, rb };
    }

    afterCycle(t) {
      const W = this.W, gt = this.gt;
      const SVC = W.svc;
      if (this.tickList.length) {
        for (const T of this.tickList) {
          if (t % T === 0) {
            if (this.LAW.tick(t) === RESTART) this.doRestart(t);
            break;
          }
        }
      }
      const v = W.bn[this.prog_addr];
      if (v > this.last_prog_v) { this.last_prog_v = v; W.last_prog_t = t; }
      else if (v < this.last_prog_v) this.last_prog_v = v;
      const down = (!W.queues[SVC].length) || (t - W.last_prog_t >= this.stall_window);
      if (down) {
        gt.down_cycles += 1;
        this.down_run += 1;
        if (this.down_run > gt.down_run_max) gt.down_run_max = this.down_run;
        if (gt.down_first < 0) gt.down_first = t;
        if (!this.down) this.log.push({ t, k: 'down' });
      } else {
        if (this.down) this.log.push({ t, k: 'up' });
        this.down_run = 0;
      }
      this.down = down;
      if (gt.inj >= 0) gt.inj_cycles += 1;
      else if (gt.dev >= 0) gt.dev_cycles += 1;
      if (gt.injl >= 0) gt.injl_cycles += 1;
      else if (gt.dev >= 0) gt.devl_cycles += 1;
      const va = this.vault_addr;
      const bad = W.ins[va] !== this.vault_orig[0] || W.an[va] !== this.vault_orig[1] || W.bn[va] !== this.vault_orig[2];
      if (bad) {
        gt.vault_cycles += 1;
        if (gt.vault < 0) { gt.vault = t; if (gt.vault_first < 0) gt.vault_first = t; this.log.push({ t, k: 'vault' }); }
      } else if (gt.vault >= 0) {
        this.events.push({ kind: 'vault', start: gt.vault, end: t });
        gt.vault = -1;
        this.log.push({ t, k: 'vaultok' });
      }
    }

    run(n) {
      for (let i = 0; i < n; i++) if (!this.cycle()) return false;
      return true;
    }

    damage() {
      const gt = this.gt, c = Math.max(1, this.t);
      return { downtime: gt.down_cycles / c, injection: gt.inj_cycles / c, deviation: gt.dev_cycles / c,
        vault: gt.vault_cycles / c, injection_lw: gt.injl_cycles / c, deviation_lw: gt.devl_cycles / c };
    }

    workByName() {
      const out = {};
      this.names.forEach((n, i) => { out[n] = this.work[i]; });
      return out;
    }

    coreHash() {
      const W = this.W;
      let h = 2166136261 >>> 0;
      for (let a = 0; a < this.S; a++) {
        for (const v of [W.ins[a], W.an[a], W.bn[a]]) {
          h = Math.imul((h ^ (v >>> 0)) >>> 0, 16777619) >>> 0;
        }
      }
      return h >>> 0;
    }
  }

  const ZERO_DIV = new Error('division by zero');
  const pyFloorDiv = (a, b) => { if (b === 0) throw ZERO_DIV; return Math.floor(a / b); };
  const pyMod = (a, b) => { if (b === 0) throw ZERO_DIV; return a - b * Math.floor(a / b); };
  const ARITH = {};
  ARITH[ADD] = (b, a) => b + a;
  ARITH[SUB] = (b, a) => b - a;
  ARITH[MUL] = (b, a) => b * a;
  ARITH[DIV] = (b, a) => pyFloorDiv(b, a);
  ARITH[MODOP] = (b, a) => pyMod(b, a);

  const RC = {
    OPS, MODS, MODES, OPCODE, MODIFIER, MODE, pack, pmod, fmtInstr, fmtShort, parse, safeEval,
    Battle, World, DAT00_K, R_NONE, R_CODE, R_DATA, R_MAILBOX, SLOT_SIZE, EVENT_NAMES,
    ALLOW, BLOCK, KILL, RESTART, JUMP_OPS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = RC;
  else root.RC = RC;
})(typeof window !== 'undefined' ? window : globalThis);
