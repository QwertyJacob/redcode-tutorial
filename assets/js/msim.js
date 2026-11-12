/* Redcode tutorial — the small simulator: a core of a few dozen cells, drawn as a
 * tape, run one instruction at a time with arrows and an Italian explanation.
 *
 * <div class="msim" data-size="32" data-title="..." data-vars="pf,pv" data-edit>
 *   <script type="text/redcode" data-name="Imp" data-base="4" data-color="t1"> ... </script>
 *   <script type="text/x-cells"> [{"a": 3, "ins": "DAT.F #0, #-9", "label": "dir", "color": "#999", "note": "..."}] </script>
 * </div>
 */
(function () {
  'use strict';
  const RC = window.RC, UI = window.RCUI;
  const PALETTE = { red: '--c-red', t1: '--c-t1', t2: '--c-t2', t3: '--c-t3', t4: '--c-t4', t5: '--c-t5',
    svc: '--c-svc', mail: '--c-mail', vault: '--c-vault' };
  const DEFAULT_COLORS = ['red', 't1', 't3', 't5', 't4'];
  const SPEEDS = [['lento', 700, 1], ['medio', 280, 1], ['veloce', 70, 1], ['turbo', 16, 8]];

  class MicroSim {
    constructor(el) {
      this.el = el;
      this.S = +el.dataset.size || 32;
      this.progs = [];
      el.querySelectorAll('script[type="text/redcode"]').forEach((s, i) => {
        this.progs.push({ name: s.dataset.name || ('P' + (i + 1)), base: +(s.dataset.base || 0),
          color: s.dataset.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length], src: s.textContent.replace(/^\n/, '').replace(/\s+$/, '') });
      });
      const xs = el.querySelector('script[type="text/x-cells"]');
      this.extras = xs ? JSON.parse(xs.textContent) : [];
      this.vars = (el.dataset.vars || '').split(',').map(s => s.trim()).filter(Boolean);
      this.editable = el.hasAttribute('data-edit');
      this.title = el.dataset.title || 'Simulatore';
      this.intro = el.dataset.intro || 'Premi <b>Passo</b> per eseguire la prima istruzione. Passa il mouse sui numeri <span class="fa-t">A</span> e <span class="fb-t">B</span> di una riga per vedere a quale casella puntano.';
      this.build();
      this.load();
    }

    color(i) { return UI.css(PALETTE[this.progs[i].color] || '--c-red') || this.progs[i].color; }

    build() {
      const el = this.el;
      el.classList.add('w');
      el.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'w-head';
      head.innerHTML = '<span class="w-title">' + this.title + '</span><span class="w-sub">core di ' + this.S + ' caselle</span>' +
        '<span class="w-ctl"><button class="btn" data-a="reset" title="Ricomincia da capo">⟲</button>' +
        '<button class="btn" data-a="back" title="Torna indietro di un passo">◀ indietro</button>' +
        '<button class="btn primary" data-a="step">Passo ▶</button>' +
        '<button class="btn" data-a="play">▶▶ avvia</button>' +
        '<select class="btn" data-a="speed">' + SPEEDS.map((s, i) => '<option value="' + i + '"' + (i === 1 ? ' selected' : '') + '>' + s[0] + '</option>').join('') + '</select></span>';
      el.appendChild(head);
      const body = document.createElement('div');
      body.className = 'msim-body';
      this.tape = document.createElement('div');
      this.tape.className = 'tape';
      this.side = document.createElement('div');
      this.side.className = 'msim-side';
      body.appendChild(this.tape);
      body.appendChild(this.side);
      el.appendChild(body);
      this.statEl = document.createElement('div'); this.statEl.className = 'msim-stat';
      this.narrEl = document.createElement('div'); this.narrEl.className = 'narr';
      this.varsEl = document.createElement('div'); this.varsEl.className = 'msim-vars';
      this.side.appendChild(this.statEl);
      this.side.appendChild(this.narrEl);
      if (this.vars.length) this.side.appendChild(this.varsEl);
      if (this.editable) {
        const ed = document.createElement('div');
        ed.innerHTML = '<div style="font-size:13px;color:var(--ink3);margin:4px 0">Modifica il programma <b>' + UI.esc(this.progs[0].name) + '</b> e premi «carica»:</div>' +
          '<textarea class="msim-src" spellcheck="false"></textarea><div style="display:flex;gap:8px;align-items:center;margin-top:6px"><button class="btn" data-a="load">carica</button><span class="msim-err"></span></div>';
        this.side.appendChild(ed);
        this.srcEl = ed.querySelector('textarea');
        this.srcEl.value = this.progs[0].src;
        this.errEl = ed.querySelector('.msim-err');
        this.srcEl.rows = Math.min(14, this.progs[0].src.split('\n').length + 2);
      }
      el.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]');
        if (!a || a.tagName === 'SELECT') return;
        const act = a.dataset.a;
        if (act === 'step') { this.pause(); this.step(); }
        else if (act === 'back') { this.pause(); this.back(); }
        else if (act === 'reset') { this.pause(); this.load(); }
        else if (act === 'play') this.toggle();
        else if (act === 'load') { this.progs[0].src = this.srcEl.value; this.pause(); this.load(); }
      });
      head.querySelector('select').addEventListener('change', (e) => { this.speed = +e.target.value; if (this.timer) { this.pause(); this.toggle(); } });
      this.speed = 1;
      document.addEventListener('rc-theme', () => this.render());
    }

    load() {
      const S = this.S;
      let parsed = [];
      try {
        parsed = this.progs.map(p => RC.parse(p.src));
        if (this.errEl) this.errEl.textContent = '';
      } catch (e) {
        if (this.errEl) { this.errEl.textContent = e.message; return; }
        throw e;
      }
      this.parsed = parsed;
      this.battle = RC.Battle.plainCore(S, this.progs.map((p, i) => ({ name: p.name, prog: parsed[i], base: p.base })), { maxp: 64 });
      const W = this.battle.W;
      this.labels = {};
      this.notes = {};
      this.cellColor = {};
      this.progs.forEach((p, i) => {
        for (const l in parsed[i].labels) {
          const a = RC.pmod(p.base + parsed[i].labels[l], S);
          (this.labels[a] = this.labels[a] || []).push(l);
        }
      });
      for (const x of this.extras) {
        if (x.ins) {
          const pr = RC.parse(x.ins);
          const i = pr.instructions[0];
          W.ins[x.a] = RC.pack(i[0], i[1], i[2], i[4]); W.an[x.a] = i[3]; W.bn[x.a] = i[5]; W.bd[x.a] = 0;
        }
        if (x.label) (this.labels[x.a] = this.labels[x.a] || []).push(x.label);
        if (x.note) this.notes[x.a] = x.note;
        if (x.color) this.cellColor[x.a] = x.color;
      }
      this.turnIdx = 0;
      this.cyc = 1;
      this.history = [];
      this.lastSeg = null;
      this.prev = null;
      this.buildRows();
      this.render();
      this.narrEl.innerHTML = this.intro;
    }

    buildRows() {
      this.tape.innerHTML = '';
      this.rows = [];
      for (let a = 0; a < this.S; a++) {
        const r = document.createElement('div');
        r.className = 'row';
        r.innerHTML = '<span class="gut"></span><span class="addr"></span><span class="own"></span><span class="pcs"></span><span class="lbl"></span><span class="ins"></span>';
        r.dataset.a = a;
        this.tape.appendChild(r);
        this.rows.push(r);
      }
      const wl = document.createElement('div');
      wl.className = 'row wrapline';
      wl.innerHTML = '<span>↻ dopo la casella ' + (this.S - 1) + ' viene di nuovo la casella 0: la memoria è un anello</span>';
      this.tape.appendChild(wl);
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.setAttribute('class', 'arrows');
      this.tape.appendChild(this.svg);
      this.tape.addEventListener('mouseover', (e) => {
        const f = e.target.closest('.fa, .fb');
        const row = e.target.closest('.row');
        if (!f || !row || row.dataset.a === undefined) return;
        const a = +row.dataset.a;
        const side = f.classList.contains('fa') ? 'A' : 'B';
        const st = UI.staticTarget(this.battle.W, this.S, a, side);
        this.hover = { a, side, st };
        f.title = st.imm ? 'immediato: è il numero stesso' : (st.ptr !== undefined ? 'puntatore nella casella ' + st.ptr + ' → casella ' + st.target : '→ casella ' + st.target);
        this.drawArrows();
      });
      this.tape.addEventListener('mouseout', (e) => {
        if (e.target.closest('.fa, .fb')) { this.hover = null; this.drawArrows(); }
      });
    }

    snapshot() {
      const W = this.battle.W;
      return { f: ['ins', 'an', 'bn', 'bd', 'own', 'lw'].map(k => W[k].slice()), q: W.queues.map(q => q.map(p => p.slice())),
        turnIdx: this.turnIdx, cyc: this.cyc, lastSeg: this.lastSeg, work: this.battle.work.slice(), narr: this.narrEl.innerHTML };
    }

    restore(s) {
      const W = this.battle.W;
      ['ins', 'an', 'bn', 'bd', 'own', 'lw'].forEach((k, i) => W[k].set(s.f[i]));
      W.queues = s.q;
      this.turnIdx = s.turnIdx; this.cyc = s.cyc; this.lastSeg = s.lastSeg; this.battle.work = s.work;
      this.narrEl.innerHTML = s.narr;
    }

    alive() { return this.battle.W.queues.some(q => q.length); }

    step() {
      const b = this.battle, W = b.W, n = b.order.length;
      if (!this.alive()) { this.narrEl.innerHTML = '<span class="death">Nessun processo è ancora vivo: non c\'è più niente da eseguire.</span>'; return false; }
      this.history.push(this.snapshot());
      if (this.history.length > 800) this.history.shift();
      this.prev = { an: W.an.slice(), bn: W.bn.slice(), ins: W.ins.slice() };
      for (let tries = 0; tries < n; tries++) {
        const pid = b.order[this.turnIdx];
        this.turnIdx = (this.turnIdx + 1) % n;
        const cycNow = this.cyc;
        if (this.turnIdx === 0) this.cyc++;
        if (!W.queues[pid].length) continue;
        b.trace = [];
        W.t = cycNow;
        b.turn(pid, cycNow);
        this.lastCyc = cycNow;
        this.nSteps = (this.nSteps || 0) + 1;
        const seg = UI.splitTurns(b.trace)[0];
        b.trace = null;
        this.lastSeg = seg;
        this.narrEl.innerHTML = UI.narrate(seg, this.ctx());
        break;
      }
      this.render();
      return true;
    }

    back() {
      const s = this.history.pop();
      if (!s) return;
      this.prev = null;
      this.restore(s);
      this.render();
    }

    toggle() {
      if (this.timer) { this.pause(); return; }
      const [, ms, k] = SPEEDS[this.speed];
      this.el.querySelector('[data-a="play"]').textContent = '⏸ pausa';
      this.timer = setInterval(() => {
        for (let i = 0; i < k; i++) if (!this.step()) { this.pause(); break; }
      }, ms);
    }

    pause() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      const b = this.el.querySelector('[data-a="play"]');
      if (b) b.textContent = '▶▶ avvia';
    }

    ctx() {
      const self = this;
      return {
        S: this.S,
        nameOf: (pid) => self.progs[pid] ? self.progs[pid].name : '?',
        colorOf: (pid) => self.color(pid),
        where: (a) => {
          const l = self.labels[a];
          const n = self.notes[a];
          if (l && l.length) return '(<span class="lbl-t">' + UI.esc(l.join(', ')) + '</span>' + (n ? ', ' + UI.esc(n) : '') + ')';
          if (n) return '(' + UI.esc(n) + ')';
          return '';
        },
        lawText: () => '',
        procCount: (pid) => self.battle.W.queues[pid].length,
      };
    }

    render() {
      const W = this.battle.W, S = this.S;
      const seg = this.lastSeg;
      const pcs = {};
      W.queues.forEach((q, pid) => q.forEach((p, k) => { (pcs[p[0]] = pcs[p[0]] || []).push([pid, k]); }));
      const ex = seg ? seg.find(e => e.k === 'exec') : null;
      const ops = seg ? seg.find(e => e.k === 'ops') : null;
      const ptrs = seg ? seg.filter(e => e.k === 'ptr') : [];
      const empty = RC.DAT00_K;
      for (let a = 0; a < S; a++) {
        const r = this.rows[a];
        const k = W.ins[a];
        const isEmpty = k === empty && W.an[a] === 0 && W.bn[a] === 0 && W.own[a] < 0 && !this.cellColor[a];
        r.className = 'row' + (isEmpty ? ' empty' : '');
        if (ex && ex.pc === a) r.classList.add('exec');
        if (pcs[a]) r.classList.add('nextpc');
        if (ex && ops) {
          const op = ex.ins >> 9;
          const usesA = op !== 0 && op !== 16;
          const usesB = ![0, 16, 7, 11].includes(op);
          if (usesA && ops.ra === a && ex.pc !== a) r.classList.add('tA');
          if (usesB && ops.rb === a && ex.pc !== a) r.classList.add('tB');
          if (ptrs.some(p => p.p === a)) r.classList.add('tP');
        }
        const owner = W.own[a];
        r.children[1].innerHTML = '<b>' + a + '</b>';
        r.children[2].style.background = this.cellColor[a] || (owner >= 0 ? this.color(owner) : 'transparent');
        r.children[4].textContent = (this.labels[a] || []).join(' ');
        const changed = this.prev && (this.prev.an[a] !== W.an[a] || this.prev.bn[a] !== W.bn[a] || this.prev.ins[a] !== W.ins[a]);
        const chA = this.prev && this.prev.an[a] !== W.an[a];
        const chB = this.prev && this.prev.bn[a] !== W.bn[a];
        const chI = this.prev && this.prev.ins[a] !== W.ins[a];
        const op = RC.OPS[k >> 9], md = RC.MODS[(k >> 6) & 7];
        let h = '<span class="op' + (chI ? ' chg' : '') + '">' + op + '</span><span class="mod">.' + md + '</span> ' +
          '<span class="fa' + (chA ? ' chg' : '') + '">' + RC.MODES[(k >> 3) & 7] + W.an[a] + '</span>, ' +
          '<span class="fb' + (chB ? ' chg' : '') + '">' + RC.MODES[k & 7] + W.bn[a] + '</span>';
        r.children[5].innerHTML = h;
        const pcEl = r.children[3];
        if (pcs[a]) {
          pcEl.innerHTML = pcs[a].slice(0, 3).map(([pid]) => '<span class="pc" style="background:' + this.color(pid) + '" title="un processo di ' + UI.esc(this.progs[pid].name) + ' eseguirà questa casella">▶</span>').join('') + (pcs[a].length > 3 ? '<span class="pc" style="background:#555">+' + (pcs[a].length - 3) + '</span>' : '');
        } else pcEl.innerHTML = '';
        let nt = r.querySelector('.note');
        if (this.notes[a]) {
          if (!nt) { nt = document.createElement('span'); nt.className = 'note'; r.appendChild(nt); }
          nt.textContent = this.notes[a];
        } else if (nt) nt.remove();
        if (changed && !this.timer) r.children[5].querySelectorAll('.chg').forEach(x => { x.style.animation = 'none'; void x.offsetWidth; x.style.animation = ''; });
      }
      // status
      const b = this.battle;
      let st = '<span>passo <b>' + (this.history.length) + '</b></span>' + (this.progs.length > 1 ? '<span>ciclo <b>' + (this.lastCyc || 0) + '</b></span>' : '');
      this.progs.forEach((p, i) => {
        const n = W.queues[i].length;
        st += '<span>' + UI.badge(p.name, this.color(i)) + ' ' + (n ? n + (n === 1 ? ' processo' : ' processi') : '💀 morto') + '</span>';
      });
      const nxt = b.order[this.turnIdx];
      if (this.alive()) st += '<span>prossimo turno: <b>' + UI.esc(this.progs[nxt].name) + '</b></span>';
      this.statEl.innerHTML = st;
      if (this.vars.length) {
        const p0 = this.parsed[0], base = this.progs[0].base;
        this.varsEl.innerHTML = '<div style="font-family:var(--font);font-size:11.5px;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">variabili di ' + UI.esc(this.progs[0].name) + '</div>' +
          this.vars.map(v => {
            const off = p0.labels[v];
            if (off === undefined) return '';
            const a = RC.pmod(base + off, S);
            const tgt = RC.pmod(a + W.bn[a], S);
            const tl = this.labels[tgt] ? ' (' + this.labels[tgt].join(', ') + ')' : '';
            return '<div><span><span class="vn">' + v + '</span> <span style="color:var(--ink3)">casella ' + a + '</span></span><span>B = <span class="fb-t">' + W.bn[a] + '</span> → punta alla casella ' + tgt + tl + '</span></div>';
          }).join('');
      }
      this.el.querySelector('[data-a="back"]').disabled = !this.history.length;
      this.drawArrows();
    }

    rowY(a) {
      const r = this.rows[a];
      return r.offsetTop + r.offsetHeight / 2;
    }

    drawArrows() {
      const svg = this.svg;
      const h = this.tape.scrollHeight;
      svg.setAttribute('width', 62);
      svg.setAttribute('height', h);
      svg.style.height = h + 'px';
      const cA = UI.css('--c-a'), cB = UI.css('--c-b'), cP = UI.css('--c-mod');
      let s = '<defs>' + ['a', 'b', 'p'].map((id, i) => '<marker id="m' + id + this.uid() + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + [cA, cB, cP][i] + '"/></marker>').join('') + '</defs>';
      const x = 60;
      const arrow = (from, to, color, mk, dashed, lane) => {
        if (from === to) {
          const y = this.rowY(from);
          return '<path d="M' + x + ' ' + (y - 6) + ' C ' + (x - 26 - lane * 6) + ' ' + (y - 16) + ', ' + (x - 26 - lane * 6) + ' ' + (y + 16) + ', ' + x + ' ' + (y + 6) + '" fill="none" stroke="' + color + '" stroke-width="2"' + (dashed ? ' stroke-dasharray="4 3"' : '') + ' marker-end="url(#m' + mk + this.uid() + ')"/>';
        }
        const y1 = this.rowY(from), y2 = this.rowY(to);
        const d = Math.min(62, 18 + Math.abs(y2 - y1) * 0.12) + lane * 7;
        return '<path d="M' + x + ' ' + y1 + ' C ' + (x - d) + ' ' + y1 + ', ' + (x - d) + ' ' + y2 + ', ' + (x - 2) + ' ' + y2 + '" fill="none" stroke="' + color + '" stroke-width="2"' + (dashed ? ' stroke-dasharray="4 3"' : '') + ' marker-end="url(#m' + mk + this.uid() + ')" opacity=".9"/>';
      };
      const seg = this.lastSeg;
      if (this.hover) {
        const { a, side, st } = this.hover;
        const c = side === 'A' ? cA : cB, mk = side === 'A' ? 'a' : 'b';
        if (!st.imm) {
          if (st.ptr !== undefined) { s += arrow(a, st.ptr, cP, 'p', true, 0); s += arrow(st.ptr, st.target, c, mk, false, 1); }
          else s += arrow(a, st.target, c, mk, false, 0);
        }
      } else if (seg) {
        const ex = seg.find(e => e.k === 'exec');
        const ops = seg.find(e => e.k === 'ops');
        if (ex && ops) {
          const op = ex.ins >> 9;
          const am = (ex.ins >> 3) & 7, bm = ex.ins & 7;
          const usesA = op !== 0 && op !== 16;
          const usesB = ![0, 16, 7, 11].includes(op);
          for (const [side, mode, tgt, uses, c, mk, lane] of [['A', am, ops.ra, usesA, cA, 'a', 0], ['B', bm, ops.rb, usesB, cB, 'b', 2]]) {
            if (mode === 0) continue;
            const ptr = seg.find(e => e.k === 'ptr' && e.side === side);
            if (ptr) { s += arrow(ex.pc, ptr.p, cP, 'p', true, lane); if (uses) s += arrow(ptr.p, tgt, c, mk, false, lane + 1); }
            else if (uses) s += arrow(ex.pc, tgt, c, mk, false, lane);
          }
        }
      }
      svg.innerHTML = s;
    }

    uid() { if (!this._uid) this._uid = Math.random().toString(36).slice(2, 7); return this._uid; }
  }

  window.MicroSim = MicroSim;
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.msim').forEach(el => { el._sim = new MicroSim(el); });
  });
})();
