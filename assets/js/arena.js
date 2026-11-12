/* Redcode tutorial — the arena viewer: a whole Landlord War battle (8000 cells, the
 * service, the mailbox, five tenants, Red and Blue's laws) exported from the real
 * engine and run here by the same loop (engine.js).
 *
 * <div class="arena" data-scenario="bomba" data-mask="0" data-zoom="red" data-follow="red"></div>
 *   data-mask: which laws are on at the start (bits; default: all)
 *   data-zoom: what the listing shows first (red, svc, data, mail, T1..T5)
 *   data-follow: whose instruction the single step explains (red, service, T1..T5)
 */
(function () {
  'use strict';
  const RC = window.RC, UI = window.RCUI;
  const COLS = 100, CELL = 7;
  const SLOT_FIELDS = ['FLAG', 'OP', 'ARG1', 'ARG2', 'ARG3', 'REPLY'];
  const OBJ_COLOR = { table: '--c-table', work: '--c-work', ret: '--c-ret', vault: '--c-vault', progress: '--c-progress', canary: '--c-canary', secret: '--c-vault' };
  const PROG_COLOR = { service: '--c-svc', T1: '--c-t1', T2: '--c-t2', T3: '--c-t3', T4: '--c-t4', T5: '--c-t5', red: '--c-red' };
  const NAME_IT = { service: 'servizio', red: 'Red' };
  const SPEEDS = [['lento', 0.25], ['1×', 1], ['10×', 10], ['100×', 100], ['1000×', 1000]];
  const PAUSE_KINDS = ['svcdead', 'vault', 'inj', 'injl', 'dev', 'restart'];

  function loadScenario(id, cb) {
    window.RCDATA = window.RCDATA || {};
    if (window.RCDATA[id]) { cb(window.RCDATA[id]); return; }
    const waiting = (loadScenario.wait[id] = loadScenario.wait[id] || []);
    waiting.push(cb);
    if (waiting.length > 1) return;
    const s = document.createElement('script');
    s.src = 'data/scenarios/' + id + '.js';
    s.onload = () => { for (const f of waiting) f(window.RCDATA[id]); };
    s.onerror = () => { for (const f of waiting) f(null); };
    document.head.appendChild(s);
  }
  loadScenario.wait = {};

  class ArenaView {
    constructor(el) {
      this.el = el;
      this.id = el.dataset.scenario;
      el.classList.add('w');
      el.innerHTML = '<div class="w-head"><span class="w-title">Carico la battaglia…</span></div>';
      loadScenario(this.id, (sc) => {
        if (!sc) { el.innerHTML = '<div class="w-head"><span class="w-title">Scenario ' + UI.esc(this.id) + ' non trovato</span></div>'; return; }
        this.sc = sc;
        const n = sc.laws.length;
        const m = el.dataset.mask !== undefined ? +el.dataset.mask : (1 << n) - 1;
        this.enabled = sc.laws.map((_, i) => ((m >> i) & 1) === 1);
        this.zoomMode = el.dataset.zoom || (sc.red >= 0 ? 'red' : 'svc');
        this.followName = el.dataset.follow || (sc.red >= 0 ? 'red' : 'service');
        this.speed = +(el.dataset.speed || 3);
        this.mapMode = 'chi';
        this.pauseOnEvents = el.dataset.nopause === undefined;
        this.build();
        this.reset();
      });
    }

    pidOf(name) { return this.sc.names.indexOf(name); }
    nameIt(pid) { const n = this.sc.names[pid]; return NAME_IT[n] || n || '?'; }
    colorOf(pid) { return this.colors[pid] || '#888'; }

    build() {
      const sc = this.sc, el = this.el;
      this.colors = sc.names.map(n => UI.css(PROG_COLOR[n] || '--c-red'));
      const title = el.dataset.title || sc.title;
      el.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'w-head';
      head.innerHTML = '<span class="w-title">' + UI.esc(title) + '</span>' +
        '<span class="w-ctl"><button class="btn" data-a="reset" title="Ricomincia da capo">⟲</button>' +
        '<button class="btn" data-a="prev" title="Un ciclo indietro (rifà la battaglia fino al ciclo prima)">◀ 1</button>' +
        '<button class="btn" data-a="step" title="Un ciclo avanti, con la spiegazione">1 ciclo ▶</button>' +
        '<button class="btn primary" data-a="play">▶ avvia</button>' +
        '<select class="btn" data-a="speed" title="Cicli per fotogramma">' + SPEEDS.map((s, i) => '<option value="' + i + '"' + (i === this.speed ? ' selected' : '') + '>' + s[0] + '</option>').join('') + '</select>' +
        '<button class="btn" data-a="end" title="Fino alla fine della battaglia">fine ⏭</button></span>';
      el.appendChild(head);
      if (sc.note || el.dataset.note) {
        const nt = document.createElement('div');
        nt.className = 'w-foot';
        nt.style.borderTop = '0';
        nt.style.borderBottom = '1px solid var(--line)';
        nt.innerHTML = el.dataset.note || sc.note;
        el.appendChild(nt);
      }
      const body = document.createElement('div');
      body.className = 'arena-body';
      body.innerHTML = '<div class="map-wrap"><div class="cyc" style="display:flex;justify-content:space-between;font-size:13px;color:var(--ink3);margin-bottom:6px"><span class="cyctxt"></span><span class="maptip"></span></div>' +
        '<div style="position:relative"><canvas class="map"></canvas></div>' +
        '<div class="map-modes"><span>colori:</span><button class="btn on" data-m="chi">di chi è la cella</button><button class="btn" data-m="scritto">chi l\'ha scritta per ultimo</button>' +
        '<label style="margin-left:auto;display:flex;gap:4px;align-items:center"><input type="checkbox" class="pausechk"' + (this.pauseOnEvents ? ' checked' : '') + '> pausa agli eventi</label></div>' +
        '<div class="legend lg"></div>' +
        '<div class="timeline"><canvas class="tl"></canvas><div class="legend" style="margin-top:4px">' +
        '<span><i class="sw" style="background:var(--c-down)"></i>servizio fermo</span><span><i class="sw" style="background:var(--c-inj)"></i>iniezione</span>' +
        '<span><i class="sw" style="background:var(--c-injlw)"></i>iniezione, regola del pilot</span><span><i class="sw" style="background:var(--c-dev)"></i>deviazione</span>' +
        '<span><i class="sw" style="background:var(--c-vault)"></i>cassaforte cambiata</span><span><i class="sw" style="background:var(--ink)"></i>riavvio</span></div></div></div>' +
        '<div class="arena-side">' +
        '<div class="panel"><h5>lavoro fatto</h5><div class="kpis"></div></div>' +
        '<div class="panel"><h5>l\'arbitro: frazione del tempo in uno stato cattivo</h5><div class="bars"></div></div>' +
        '<div class="panel"><h5>casella postale (campo B di ogni cella)</h5><table class="mailbox"></table></div>' +
        '<div class="panel"><h5>dati del servizio (campo B)</h5><div class="objs"></div></div>' +
        '<div class="panel laws"><h5>leggi di Blue</h5><div class="lawlist"></div></div>' +
        '<div class="panel"><h5>cronaca</h5><div class="evlog"></div></div>' +
        '<div class="ref"></div></div>';
      el.appendChild(body);
      const zoom = document.createElement('div');
      zoom.className = 'zoom';
      const zbtn = [['red', 'Red'], ['svc', 'codice del servizio'], ['data', 'dati del servizio'], ['mail', 'casella postale'], ['T1', 'T1'], ['T2', 'T2'], ['T3', 'T3'], ['T4', 'T4'], ['T5', 'T5']]
        .filter(([k]) => k !== 'red' || sc.red >= 0);
      const fbtn = sc.names.map((n, i) => '<option value="' + n + '"' + (n === this.followName ? ' selected' : '') + '>' + this.nameIt(i) + '</option>').join('');
      zoom.innerHTML = '<div class="zoom-head"><b>Lente:</b>' + zbtn.map(([k, t]) => '<button class="btn' + (k === this.zoomMode ? ' on' : '') + '" data-z="' + k + '">' + t + '</button>').join('') +
        '<span style="margin-left:auto">spiega le istruzioni di <select class="btn followsel">' + fbtn + '</select></span></div>' +
        '<div class="zoom-body"><div class="tape ztape"></div><div class="narr znarr"></div></div>';
      el.appendChild(zoom);
      this.$ = (s) => el.querySelector(s);
      this.canvas = this.$('canvas.map');
      this.tl = this.$('canvas.tl');
      this.setupCanvas();
      // events
      el.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]');
        if (a && a.tagName !== 'SELECT') {
          const act = a.dataset.a;
          if (act === 'reset') { this.pause(); this.reset(); }
          else if (act === 'step') { this.pause(); this.stepNarrated(); }
          else if (act === 'prev') { this.pause(); this.goto(Math.max(0, this.b.t - 1)); }
          else if (act === 'play') this.toggle();
          else if (act === 'end') { this.pause(); this.runTo(this.b.cycles); }
          return;
        }
        const m = e.target.closest('[data-m]');
        if (m) {
          this.mapMode = m.dataset.m;
          el.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === m));
          this.drawMap();
          return;
        }
        const z = e.target.closest('[data-z]');
        if (z) {
          this.zoomMode = z.dataset.z; this.zoomAddr = null;
          el.querySelectorAll('[data-z]').forEach(x => x.classList.toggle('on', x === z));
          this.renderZoom();
        }
      });
      this.$('select[data-a="speed"]').addEventListener('change', (e) => { this.speed = +e.target.value; });
      this.$('.followsel').addEventListener('change', (e) => { this.followName = e.target.value; this.renderZoom(); });
      this.$('.pausechk').addEventListener('change', (e) => { this.pauseOnEvents = e.target.checked; });
      this.canvas.addEventListener('mousemove', (e) => this.hoverMap(e));
      this.canvas.addEventListener('mouseleave', () => { this.$('.maptip').textContent = ''; });
      this.canvas.addEventListener('click', (e) => {
        const a = this.addrAt(e);
        if (a === null) return;
        this.zoomMode = 'addr'; this.zoomAddr = a;
        el.querySelectorAll('[data-z]').forEach(x => x.classList.remove('on'));
        this.renderZoom();
      });
      this.tl.addEventListener('click', (e) => {
        const r = this.tl.getBoundingClientRect();
        const c = Math.round((e.clientX - r.left) / r.width * this.sc.cycles);
        this.pause();
        this.goto(Math.max(0, Math.min(this.sc.cycles, c)));
      });
      document.addEventListener('rc-theme', () => { this.colors = sc.names.map(n => UI.css(PROG_COLOR[n] || '--c-red')); this.renderAll(); });
      this.buildLegend();
      this.buildLaws();
    }

    setupCanvas() {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      this.dpr = dpr;
      const rows = Math.ceil(this.sc.S / COLS);
      this.canvas.width = COLS * CELL * dpr; this.canvas.height = rows * CELL * dpr;
      this.canvas.style.aspectRatio = COLS + ' / ' + rows;
      this.tl.width = COLS * CELL * dpr; this.tl.height = 44 * dpr;
      this.tl.style.width = '100%';
    }

    buildLegend() {
      const items = [['--c-svc', 'codice del servizio'], ['--c-work', 'work'], ['--c-table', 'table'], ['--c-ret', 'ret'], ['--c-vault', 'cassaforte'], ['--c-progress', 'progress']];
      if (this.sc.params.canaries) items.push(['--c-canary', 'canary']);
      items.push(['--c-mail', 'casella postale']);
      ['T1', 'T2', 'T3', 'T4', 'T5'].forEach(n => { if (this.pidOf(n) >= 0) items.push([PROG_COLOR[n], n]); });
      if (this.sc.red >= 0) items.push(['--c-red', 'Red']);
      this.$('.lg').innerHTML = items.map(([c, t]) => '<span><i class="sw" style="background:var(' + c + ')"></i>' + t + '</span>').join('') +
        (this.sc.red >= 0 ? '<span><i class="sw" style="background:var(--c-empty);box-shadow:inset 0 0 0 3px var(--c-red)"></i>scritta da Red in casa d\'altri</span>' : '') +
        '<span><i class="sw" style="background:var(--c-red);opacity:.33"></i>cella libera presa da chi l\'ha scritta per primo</span>' +
        '<span>● processo</span>';
    }

    buildLaws() {
      const sc = this.sc;
      const p = sc.params;
      let h = '<div class="params">parametri di caricamento: place_bits = ' + p.place_bits + ' · shuffle_layout = ' + (p.shuffle_layout ? 'on' : 'off') + ' · canaries = ' + p.canaries + '</div>';
      if (!sc.laws.length) h += '<div style="color:var(--ink3)">Nessuna legge: anarchia.</div>';
      sc.laws_text.forEach((t, i) => {
        h += '<label class="law' + (this.enabled[i] ? '' : ' off') + '" data-li="' + i + '"><input type="checkbox"' + (this.enabled[i] ? ' checked' : '') + '>' +
          '<span class="txt">' + UI.colorLaw(t) + '</span><span class="cnt"></span></label>';
      });
      if (sc.laws.length) h += '<div style="font-size:12px;color:var(--ink3);margin-top:4px">Togli o rimetti una legge: la battaglia ricomincia da capo con le nuove leggi.</div>';
      const box = this.$('.lawlist');
      box.innerHTML = h;
      box.querySelectorAll('input[type=checkbox]').forEach((cb) => {
        cb.addEventListener('change', () => {
          const i = +cb.closest('[data-li]').dataset.li;
          this.enabled[i] = cb.checked;
          cb.closest('.law').classList.toggle('off', !cb.checked);
          this.pause();
          this.reset();
        });
      });
    }

    mask() { return this.enabled.reduce((m, on, i) => m | (on ? 1 << i : 0), 0); }

    computeHome() {
      const S = this.sc.S, home = new Uint8Array(S);
      for (const p of this.sc.programs) {
        home[p.dir] = 1;
        for (let o = 0; o < p.len; o++) home[RC.pmod(p.base + o, S)] = 1;
        if (p.scratch) for (let o = 0; o < p.scratch[1]; o++) home[RC.pmod(p.scratch[0] + o, S)] = 1;
      }
      this.home = home;
    }

    reset() {
      if (!this.home) this.computeHome();
      this.b = RC.Battle.fromScenario(this.sc, { enabled: this.enabled.slice() });
      this.flags = new Uint8Array(this.sc.cycles + 2);
      this.logSeen = 0;
      this.lastTurns = null;
      this.prevCore = null;
      this.$('.evlog').innerHTML = '';
      this.$('.znarr').innerHTML = 'Premi <b>1 ciclo ▶</b> per eseguire un ciclo e leggere che cosa ha fatto ogni programma, oppure <b>▶ avvia</b> per vedere la battaglia scorrere. Clicca sulla mappa per guardare una cella da vicino.';
      this.renderAll();
    }

    recordFlags() {
      const b = this.b, gt = b.gt, t = b.t;
      let f = 0;
      if (b.down) f |= 1;
      if (gt.inj >= 0) f |= 2;
      if (gt.injl >= 0) f |= 4;
      if (gt.dev >= 0) f |= 8;
      if (gt.vault >= 0) f |= 16;
      if (b.restarts.length && b.restarts[b.restarts.length - 1] === t) f |= 32;
      this.flags[t] = f;
    }

    advance(n) {
      const b = this.b;
      let paused = false;
      for (let i = 0; i < n; i++) {
        if (!b.cycle()) { this.pause(); break; }
        this.recordFlags();
        if (this.pauseOnEvents && this.timer && b.log.length > this.logSeen) {
          for (let k = this.logSeen; k < b.log.length; k++) {
            if (PAUSE_KINDS.includes(b.log[k].k)) { paused = true; break; }
          }
          if (paused) { this.pause(); break; }
        }
      }
      return paused;
    }

    goto(c) {
      this.b = RC.Battle.fromScenario(this.sc, { enabled: this.enabled.slice() });
      this.flags = new Uint8Array(this.sc.cycles + 2);
      this.logSeen = 0;
      this.$('.evlog').innerHTML = '';
      this.lastTurns = null;
      for (let i = 0; i < c; i++) { this.b.cycle(); this.recordFlags(); }
      this.prevCore = null;
      this.renderAll();
    }

    runTo(c) {
      while (this.b.t < c) { if (!this.b.cycle()) break; this.recordFlags(); }
      this.renderAll();
    }

    stepNarrated() {
      const b = this.b;
      if (b.t >= b.cycles) return;
      this.prevCore = { an: b.W.an.slice(), bn: b.W.bn.slice(), ins: b.W.ins.slice() };
      b.trace = [];
      b.cycle();
      this.recordFlags();
      const turns = UI.splitTurns(b.trace);
      b.trace = null;
      this.lastTurns = turns;
      this.narrateTurns(turns);
      this.renderAll(true);
    }

    narrateTurns(turns) {
      const fp = this.pidOf(this.followName);
      const ctx = this.ctx();
      const mine = turns.find(t => t[0].pid === fp);
      let h = '<div style="font-size:12.5px;color:var(--ink3);margin-bottom:6px">Ciclo ' + this.b.t + ': ogni programma vivo ha eseguito un\'istruzione, nell\'ordine dei turni.</div>';
      if (mine) h += UI.narrate(mine, ctx);
      else h += '<p>' + UI.badge(this.nameIt(fp), this.colorOf(fp)) + ' non ha eseguito niente in questo ciclo' + (this.b.W.queues[fp].length ? '.' : ': non ha processi vivi.') + '</p>';
      const others = turns.filter(t => t[0].pid !== fp);
      if (others.length) {
        h += '<div style="margin-top:8px;font-size:13px;color:var(--ink3)">Gli altri, nello stesso ciclo:</div><div style="font-size:13px">' + others.map(t => {
          const e = t[0];
          if (e.k === 'stall') return '<div>' + UI.badge(this.nameIt(e.pid), this.colorOf(e.pid)) + ' salta il turno (ritardo dei controlli)</div>';
          return '<div>' + UI.badge(this.nameIt(e.pid), this.colorOf(e.pid)) + ' casella ' + e.pc + ' ' + UI.insHtml(e.ins, e.an, e.bn) + ' <span style="color:var(--ink3)">' + this.whereShort(e.pc) + '</span></div>';
        }).join('') + '</div>';
      }
      this.$('.znarr').innerHTML = h;
    }

    toggle() {
      if (this.timer) { this.pause(); return; }
      if (this.b.t >= this.b.cycles) this.reset();
      this.$('[data-a="play"]').textContent = '⏸ pausa';
      this.logSeen = this.b.log.length;
      let acc = 0;
      const tick = () => {
        if (!this.timer) return;
        acc += SPEEDS[this.speed][1];
        const n = Math.floor(acc);
        acc -= n;
        if (n > 0) {
          this.prevCore = { an: this.b.W.an.slice(), bn: this.b.W.bn.slice(), ins: this.b.W.ins.slice() };
          this.advance(n);
          this.renderAll();
        }
        if (this.timer) this.timer = requestAnimationFrame(tick);
      };
      this.timer = requestAnimationFrame(tick);
    }

    pause() {
      if (this.timer) cancelAnimationFrame(this.timer);
      this.timer = null;
      const p = this.$('[data-a="play"]');
      if (p) p.textContent = '▶ avvia';
    }

    // ------------------------------------------------------------ describing cells
    svcOff(a) {
      const b = this.b, d = b.svc_desc;
      const off = RC.pmod(a - b.svc_base, b.S);
      return off < d.len ? off : -1;
    }

    describe(a) {
      /* {kind, owner, label, comment, obj} for one address */
      const b = this.b, sc = this.sc, S = b.S;
      const mo = RC.pmod(a - sc.mb_base, S);
      if (mo < sc.mb_len) {
        const j = Math.floor(mo / 6), f = SLOT_FIELDS[mo % 6];
        let who = '?';
        for (const k in b.slot_of) if (b.slot_of[k] === j) who = this.nameIt(+k);
        if (who === '?' && j === sc.n_slots - 1) who = 'Red';
        return { kind: 'mail', label: f + '·' + j, short: f + ' del posto ' + j + ' (' + who + ')', comment: 'casella postale, posto ' + j + ' di ' + who + ': ' + f };
      }
      const off = this.svcOff(a);
      if (off >= 0) {
        const ln = b.svc_desc.lines[off];
        const inCode = off >= b.svc_desc.code[0] && off < b.svc_desc.code[1];
        if (inCode) return { kind: 'code', label: ln[1], short: 'codice del servizio' + (ln[1] ? ', riga ' + ln[1] : ', offset ' + off), comment: ln[3] };
        return { kind: 'data', label: ln[2], obj: ln[2], short: ln[2] + ' del servizio', comment: ln[3] };
      }
      for (const p of sc.programs) {
        const name = NAME_IT[p.name] || p.name;
        if (a === p.dir) return { kind: 'dir', label: 'dir', short: 'directory cell di ' + name, comment: 'directory cell di ' + name + ': B = distanza dal suo FLAG' };
        const o = RC.pmod(a - p.base, S);
        if (o < p.len) {
          const ln = p.lines[o];
          return { kind: 'prog', label: ln[1], short: name + (ln[1] ? ', riga ' + ln[1] : ', riga ' + o), comment: ln[2] };
        }
        if (p.scratch && RC.pmod(a - p.scratch[0], S) < p.scratch[1]) return { kind: 'scratch', label: '', short: 'zona lontana di ' + name, comment: 'zona di lavoro lontana di ' + name };
      }
      const own = b.W.own[a];
      return { kind: 'free', label: '', short: own >= 0 ? 'cella libera, ora di ' + this.nameIt(own) : 'cella vuota', comment: '' };
    }

    whereShort(a) { return '(' + UI.esc(this.describe(a).short) + ')'; }

    ctx() {
      const self = this;
      return {
        S: this.b.S,
        nameOf: (pid) => self.nameIt(pid),
        colorOf: (pid) => self.colorOf(pid),
        where: (a) => '(' + UI.esc(self.describe(a).short) + ')',
        lawText: (i) => self.sc.laws_text[i] || '',
        procCount: (pid) => self.b.W.queues[pid].length,
      };
    }

    cellColor(a) {
      const b = this.b, W = b.W, sc = this.sc;
      if (this.mapMode === 'scritto') {
        const lw = W.lw[a];
        return lw >= 0 ? this.colors[lw] : this.cEmpty;
      }
      const r = W.region[a];
      if (r === RC.R_CODE) return this.cSvc;
      if (r === RC.R_DATA) {
        const off = this.svcOff(a);
        const obj = off >= 0 ? (b.svc_desc.lines[off][2] || '').replace(/\[.*$/, '') : '';
        return this.cObj[obj] || this.cSvc;
      }
      if (r === RC.R_MAILBOX) return this.cMail;
      const own = W.own[a];
      if (own >= 0) return this.colors[own];
      return this.cEmpty;
    }

    drawMap() {
      const ctx = this.canvas.getContext('2d');
      const b = this.b, W = b.W, S = b.S, dpr = this.dpr;
      this.cEmpty = UI.css('--c-empty'); this.cSvc = UI.css('--c-svc'); this.cMail = UI.css('--c-mail');
      this.cObj = {};
      for (const k in OBJ_COLOR) this.cObj[k] = UI.css(OBJ_COLOR[k]);
      const bg = UI.css('--panel');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, COLS * CELL, Math.ceil(S / COLS) * CELL);
      const RED = W.red;
      const redC = this.colors[RED];
      const pc = this.prevCore;
      for (let a = 0; a < S; a++) {
        const x = (a % COLS) * CELL, y = Math.floor(a / COLS) * CELL;
        ctx.fillStyle = this.cellColor(a);
        const claimed = this.mapMode === 'chi' && W.region[a] === RC.R_NONE && W.own[a] >= 0 && !this.home[a];
        if (claimed) ctx.globalAlpha = 0.33;
        ctx.fillRect(x, y, CELL - 1, CELL - 1);
        ctx.globalAlpha = 1;
        if (this.mapMode === 'chi' && RED >= 0 && W.lw[a] === RED && W.own[a] !== RED) {
          ctx.fillStyle = redC;
          ctx.fillRect(x + 1.5, y + 1.5, CELL - 4, CELL - 4);
        }
        if (pc && (pc.ins[a] !== W.ins[a] || pc.an[a] !== W.an[a] || pc.bn[a] !== W.bn[a])) {
          ctx.strokeStyle = '#ffd400';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x - 0.5, y - 0.5, CELL, CELL);
        }
      }
      // processes
      W.queues.forEach((q, pid) => {
        ctx.fillStyle = this.colors[pid];
        for (const p of q) {
          const a = p[0];
          const x = (a % COLS) * CELL + CELL / 2 - 0.5, y = Math.floor(a / COLS) * CELL + CELL / 2 - 0.5;
          ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2);
          ctx.fillStyle = '#fff'; ctx.fill();
          ctx.beginPath(); ctx.arc(x, y, 2.3, 0, Math.PI * 2);
          ctx.fillStyle = this.colors[pid]; ctx.fill();
        }
      });
      // where the lens is looking
      const zr = this.zoomRange;
      if (zr) {
        ctx.strokeStyle = UI.css('--ink');
        ctx.lineWidth = 1;
        for (let a = zr[0]; a < zr[0] + zr[1]; a++) {
          const aa = RC.pmod(a, S);
          const x = (aa % COLS) * CELL, y = Math.floor(aa / COLS) * CELL;
          ctx.beginPath(); ctx.moveTo(x, y + CELL - 0.5); ctx.lineTo(x + CELL - 1, y + CELL - 0.5); ctx.stroke();
        }
      }
    }

    drawTimeline() {
      const ctx = this.tl.getContext('2d');
      const dpr = this.dpr, Wd = COLS * CELL, H = 44, C = this.sc.cycles, t = this.b.t;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = UI.css('--bg2');
      ctx.fillRect(0, 0, Wd, H);
      const cols = [[1, UI.css('--c-down'), 0], [2, UI.css('--c-inj'), 1], [4, UI.css('--c-injlw'), 1], [8, UI.css('--c-dev'), 2], [16, UI.css('--c-vault'), 3]];
      const rowH = 9;
      for (let x = 0; x < Wd; x++) {
        const c0 = Math.floor(x * C / Wd) + 1, c1 = Math.min(t, Math.floor((x + 1) * C / Wd));
        if (c0 > t) break;
        let f = 0;
        for (let c = c0; c <= c1; c++) f |= this.flags[c];
        for (const [bit, col, row] of cols) {
          if (f & bit) {
            if (bit === 4 && (f & 2)) continue;
            ctx.fillStyle = col;
            ctx.fillRect(x, 2 + row * (rowH + 1), 1, rowH);
          }
        }
        if (f & 32) { ctx.fillStyle = UI.css('--ink'); ctx.fillRect(x, 0, 1.2, H); }
      }
      ctx.fillStyle = UI.css('--accent');
      ctx.fillRect(Math.min(Wd - 2, t / C * Wd), 0, 2, H);
    }

    hoverMap(e) {
      const a = this.addrAt(e);
      if (a === null) return;
      const d = this.describe(a);
      const W = this.b.W;
      const lw = W.lw[a];
      this.$('.maptip').innerHTML = 'casella <b>' + a + '</b> · ' + UI.esc(d.short) + ' · <code>' + RC.fmtShort(W.ins[a], W.an[a], W.bn[a]) + '</code>' + (lw >= 0 ? ' · scritta per ultimo da ' + this.nameIt(lw) : '');
    }

    addrAt(e) {
      const r = this.canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / r.width * COLS);
      const y = Math.floor((e.clientY - r.top) / r.height * Math.ceil(this.sc.S / COLS));
      const a = y * COLS + x;
      return a >= 0 && a < this.sc.S ? a : null;
    }

    // ------------------------------------------------------------ panels
    renderAll(keepNarr) {
      const b = this.b;
      this.$('.cyctxt').innerHTML = 'ciclo <b>' + b.t + '</b> di ' + b.cycles;
      this.renderZoom();
      this.drawMap();
      this.drawTimeline();
      this.renderKpis();
      this.renderBars();
      this.renderMailbox();
      this.renderObjs();
      this.renderLawCounts();
      this.renderLog();
      this.renderRef();
      if (!keepNarr && this.lastTurns && b.t !== this.lastTurnsT) { /* keep the last explanation */ }
    }

    renderKpis() {
      const b = this.b, W = b.W, sc = this.sc;
      let h = '';
      const svc = this.pidOf('service');
      h += '<div class="kpi' + (b.down ? ' bad' : '') + '"><div class="v">' + b.work[svc] + '</div><div class="l">richieste servite' + (b.down ? ' · <b>fermo</b>' : '') + '</div></div>';
      for (const n of ['T1', 'T2', 'T3', 'T4', 'T5']) {
        const p = this.pidOf(n);
        if (p < 0) continue;
        h += '<div class="kpi"><div class="v" style="color:' + this.colorOf(p) + '">' + b.work[p] + '</div><div class="l">lavori di ' + n + (W.queues[p].length ? '' : ' · 💀') + '</div></div>';
      }
      if (sc.red >= 0) {
        const n = W.queues[sc.red].length;
        h += '<div class="kpi"><div class="v" style="color:' + this.colorOf(sc.red) + '">' + n + '</div><div class="l">processi di Red' + (n ? '' : ' · 💀') + '</div></div>';
      }
      h += '<div class="kpi"><div class="v">' + b.restarts.length + '</div><div class="l">riavvii</div></div>';
      this.$('.kpis').innerHTML = h;
    }

    renderBars() {
      const d = this.b.damage();
      const w = this.sc.weights;
      const tot = (w.down * d.downtime + w.inject * d.injection + w.dev * d.deviation + w.vault * d.vault) / (w.down + w.inject + w.dev + w.vault);
      const totLw = (w.down * d.downtime + w.inject * d.injection_lw + w.dev * d.deviation_lw + w.vault * d.vault) / (w.down + w.inject + w.dev + w.vault);
      const rows = [['fermo', d.downtime, '--c-down'], ['iniezione', d.injection, '--c-inj'], ['iniez. (pilot)', d.injection_lw, '--c-injlw'],
        ['deviazione', d.deviation, '--c-dev'], ['cassaforte', d.vault, '--c-vault'], ['<b>danno</b>', tot, '--ink'], ['danno (pilot)', totLw, '--ink3']];
      this.$('.bars').innerHTML = rows.map(([l, v, c]) => '<div class="bar"><span>' + l + '</span><span class="track"><span class="fill" style="display:block;width:' + (v * 100).toFixed(1) + '%;background:var(' + c + ')"></span></span><span class="num">' + v.toFixed(3) + '</span></div>').join('');
    }

    renderMailbox() {
      const b = this.b, W = b.W, sc = this.sc, S = b.S;
      let h = '<tr><th></th>' + SLOT_FIELDS.map(f => '<th>' + f + '</th>').join('') + '</tr>';
      const pc = this.prevCore;
      for (let j = 0; j < sc.n_slots; j++) {
        let who = '—', pid = -1;
        for (const k in b.slot_of) if (b.slot_of[k] === j) { pid = +k; who = this.nameIt(pid); }
        const fa = (sc.mb_base + j * 6) % S;
        h += '<tr class="' + (W.bn[fa] !== 0 ? 'busy' : '') + '"><td class="who" style="color:' + (pid >= 0 ? this.colorOf(pid) : 'inherit') + '">' + who + '</td>';
        for (let f = 0; f < 6; f++) {
          const a = (fa + f) % S;
          const ch = pc && (pc.bn[a] !== W.bn[a] || pc.an[a] !== W.an[a] || pc.ins[a] !== W.ins[a]);
          h += '<td' + (ch ? ' class="chg"' : '') + ' title="' + RC.fmtShort(W.ins[a], W.an[a], W.bn[a]) + '">' + W.bn[a] + '</td>';
        }
        h += '</tr>';
      }
      this.$('.mailbox').innerHTML = h;
    }

    renderObjs() {
      const b = this.b, W = b.W, S = b.S, d = b.svc_desc;
      let h = '';
      const objs = Object.entries(d.objects).sort((x, y) => x[1][0] - y[1][0]);
      for (const [name, [o0, o1]] of objs) {
        for (let o = o0; o < o1; o++) {
          const a = RC.pmod(b.svc_base + o, S);
          const lbl = o1 - o0 > 1 ? name + '[' + (o - o0) + ']' : name;
          let v = W.bn[a];
          let bad = false;
          if (name === 'vault') { v = W.an[a] + ',' + W.bn[a]; bad = W.ins[a] !== b.vault_orig[0] || W.an[a] !== b.vault_orig[1] || W.bn[a] !== b.vault_orig[2]; }
          h += '<span class="o' + (bad ? ' bad' : '') + '" style="border-top:3px solid var(' + (OBJ_COLOR[name] || '--c-svc') + ')" title="casella ' + a + ': ' + RC.fmtShort(W.ins[a], W.an[a], W.bn[a]) + '"><small>' + lbl + '</small>' + v + '</span>';
        }
      }
      this.$('.objs').innerHTML = h;
    }

    renderLawCounts() {
      const L = this.b.LAW;
      this.el.querySelectorAll('.lawlist [data-li]').forEach(row => {
        const i = +row.dataset.li;
        const c = row.querySelector('.cnt');
        if (!L || !this.enabled[i]) { c.textContent = ''; row.classList.remove('hot'); return; }
        const f = L.fired[i], a = L.acted[i];
        const act = this.sc.laws[i].action;
        c.textContent = f ? (act === 'allow' ? 'vera ' + f + '×' : 'ha agito ' + a + '×') : 'mai scattata';
        row.classList.toggle('hot', act !== 'allow' && a > 0);
      });
    }

    renderLog() {
      const b = this.b;
      const box = this.$('.evlog');
      const ctx = this.ctx();
      const lines = [];
      const start = Math.max(0, b.log.length - 200);
      for (let k = start; k < b.log.length; k++) {
        const e = b.log[k];
        let t = '', cls = '';
        switch (e.k) {
          case 'restart': t = '🔁 riavvio del servizio' + (e.law >= 0 ? ' (legge ' + (e.law + 1) + ')' : ''); cls = 'good'; break;
          case 'resume': t = '▶ il servizio riparte dopo il riavvio'; cls = 'good'; break;
          case 'svcdead': t = '💀 il servizio non ha più processi: l\'ultimo è morto alla casella ' + e.pc + ' ' + ctx.where(e.pc); cls = 'bad'; break;
          case 'down': t = '⏸ il servizio è fermo'; cls = 'bad'; break;
          case 'up': t = 'il servizio è di nuovo attivo'; cls = 'good'; break;
          case 'inj': t = '☠ iniezione: il servizio esegue una cella che Red ha cambiato, alla casella ' + e.pc + ' ' + ctx.where(e.pc); cls = 'bad'; break;
          case 'injl': t = '☠ iniezione secondo la regola del pilot: il servizio esegue una cella scritta per ultimo da Red, alla casella ' + e.pc + ' ' + ctx.where(e.pc); cls = 'bad'; break;
          case 'dev': t = '↪ deviazione: il servizio salta dalla casella ' + e.from + ' alla ' + e.to + ' ' + ctx.where(e.to) + ', un punto che il suo codice non prevede'; cls = 'bad'; break;
          case 'vault': t = '🔓 la cassaforte è cambiata'; cls = 'bad'; break;
          case 'vaultok': t = '🔒 la cassaforte ha di nuovo il valore originale'; cls = 'good'; break;
          default: t = e.k;
        }
        lines.push('<div class="' + cls + '"><span class="tt">' + e.t + '</span>' + t + '</div>');
      }
      if (!lines.length) lines.push('<div style="color:var(--ink3)">Ancora niente di notevole.</div>');
      box.innerHTML = lines.join('');
      box.scrollTop = box.scrollHeight;
      this.logSeen = b.log.length;
    }

    renderRef() {
      const ref = this.sc.refs.find(r => r.mask === this.mask());
      const el = this.$('.ref');
      if (!ref) { el.innerHTML = 'Per questa combinazione di leggi non ho un risultato del motore Python da confrontare: il motore qui è lo stesso, riga per riga.'; el.className = 'ref'; return; }
      const b = this.b;
      if (b.t < b.cycles) {
        el.className = 'ref';
        el.innerHTML = 'A fine battaglia il motore Python di Landlord War dà: richieste servite <b>' + ref.work.service + '</b>, fermo ' + ref.damage.downtime.toFixed(3) + ', iniezione ' + ref.damage.injection.toFixed(3) + ' (pilot ' + ref.damage.injection_lw.toFixed(3) + '), deviazione ' + ref.damage.deviation.toFixed(3) + ', cassaforte ' + ref.damage.vault.toFixed(3) + ', riavvii ' + ref.restarts.length + '.';
        return;
      }
      const d = b.damage();
      const same = b.work[this.pidOf('service')] === ref.work.service && ['downtime', 'injection', 'injection_lw', 'deviation', 'vault'].every(k => Math.abs(d[k] - ref.damage[k]) < 1e-12) && b.coreHash() === ref.core_hash;
      el.className = 'ref' + (same ? ' ok' : '');
      el.innerHTML = same ? '✓ Identico al motore Python di Landlord War: stesse richieste servite, stessi danni, stesso contenuto finale di tutte le ' + b.S + ' celle.' : 'Differisce dal motore Python (non dovrebbe succedere): richieste ' + ref.work.service + ' attese.';
    }

    // ------------------------------------------------------------ the lens
    zoomWindow() {
      const b = this.b, sc = this.sc, S = b.S, W = b.W;
      const N = 26;
      let start;
      const m = this.zoomMode;
      if (m === 'addr') start = this.zoomAddr - 8;
      else if (m === 'svc') {
        const fp = this.pidOf('service');
        const q = W.queues[fp];
        start = q.length && this.followName === 'service' ? q[0][0] - 8 : b.svc_code[0] - 2;
      } else if (m === 'data') { const objs = Object.values(b.svc_desc.objects).map(v => v[0]); start = b.svc_base + Math.min(...objs) - 1; }
      else if (m === 'mail') start = sc.mb_base - 1;
      else {
        const name = m === 'red' ? 'red' : m;
        const pid = this.pidOf(name);
        const p = sc.programs.find(x => x.name === name);
        const q = pid >= 0 ? W.queues[pid] : [];
        if (q.length && this.followName === name) {
          const pc = q[0][0];
          start = (p && RC.pmod(pc - p.base, S) < p.len + 4) ? p.dir : pc - 8;
          if (p && p.len > N - 2) start = pc - 8;
        } else start = p ? p.dir : 0;
      }
      return [RC.pmod(start, S), N];
    }

    renderZoom() {
      const b = this.b, W = b.W, S = b.S;
      const [start, N] = this.zoomWindow();
      this.zoomRange = [start, N];
      const tape = this.$('.ztape');
      const pcs = {};
      W.queues.forEach((q, pid) => q.forEach(p => { (pcs[p[0]] = pcs[p[0]] || []).push(pid); }));
      const pc = this.prevCore;
      let lastEx = {};
      if (this.lastTurns) for (const t of this.lastTurns) { const e = t[0]; if (e.k === 'exec') lastEx[e.pc] = e.pid; }
      let h = '';
      for (let i = 0; i < N; i++) {
        const a = RC.pmod(start + i, S);
        const d = this.describe(a);
        const k = W.ins[a];
        const own = W.own[a];
        const empty = k === RC.DAT00_K && W.an[a] === 0 && W.bn[a] === 0 && own < 0;
        const chA = pc && pc.an[a] !== W.an[a], chB = pc && pc.bn[a] !== W.bn[a], chI = pc && pc.ins[a] !== W.ins[a];
        let colr = 'transparent';
        if (W.region[a] === RC.R_CODE) colr = 'var(--c-svc)';
        else if (W.region[a] === RC.R_DATA) colr = 'var(' + (OBJ_COLOR[(d.obj || '').replace(/\[.*$/, '')] || '--c-svcdata') + ')';
        else if (W.region[a] === RC.R_MAILBOX) colr = 'var(--c-mail)';
        else if (own >= 0) colr = this.colorOf(own);
        const lwRed = W.red >= 0 && W.lw[a] === W.red && own !== W.red;
        h += '<div class="row' + (empty ? ' empty' : '') + (lastEx[a] !== undefined ? ' exec' : '') + (pcs[a] ? ' nextpc' : '') + '">' +
          '<span class="gut"></span><span class="addr"><b>' + a + '</b></span><span class="own" style="background:' + colr + '"></span>' +
          '<span class="pcs">' + (pcs[a] ? pcs[a].slice(0, 3).map(p => '<span class="pc" style="background:' + this.colorOf(p) + '" title="un processo di ' + this.nameIt(p) + '">▶</span>').join('') + (pcs[a].length > 3 ? '<span class="pc" style="background:#555">+' + (pcs[a].length - 3) + '</span>' : '') : '') + '</span>' +
          '<span class="lbl">' + UI.esc(d.label || '') + '</span>' +
          '<span style="display:flex;align-items:center;min-width:0"><span class="ins"' + (lwRed ? ' style="box-shadow:inset 3px 0 0 var(--c-red)" title="scritta per ultimo da Red"' : '') + '><span class="op' + (chI ? ' chg' : '') + '">' + RC.OPS[k >> 9] + '</span><span class="mod">.' + RC.MODS[(k >> 6) & 7] + '</span> ' +
          '<span class="fa' + (chA ? ' chg' : '') + '">' + RC.MODES[(k >> 3) & 7] + W.an[a] + '</span>, <span class="fb' + (chB ? ' chg' : '') + '">' + RC.MODES[k & 7] + W.bn[a] + '</span></span>' +
          '<span class="zoom-row-cmt" title="' + UI.esc(d.comment || '') + '">' + UI.esc(d.comment || '') + '</span></span></div>';
      }
      tape.innerHTML = h;
    }
  }


  /* <div class="ringmap" data-scenario="bomba"></div>: where the loader put everything */
  function ringMap(el) {
    loadScenario(el.dataset.scenario, (sc) => {
      if (!sc) return;
      const S = sc.S, cx = 450, cy = 230, R = 150;
      const ang = (a) => (a / S) * Math.PI * 2 - Math.PI / 2;
      const pt = (a, r) => [cx + r * Math.cos(ang(a)), cy + r * Math.sin(ang(a))];
      const regs = [];
      regs.push({ a0: sc.mb_base, n: sc.mb_len, c: '--c-mail', t: 'casella postale (' + sc.mb_len + ' celle)' });
      regs.push({ a0: sc.svc0.svc_base, n: sc.svc0.desc.len, c: '--c-svc', t: 'servizio (' + sc.svc0.desc.len + ' celle)' });
      for (const p of sc.programs) {
        const name = NAME_IT[p.name] || p.name;
        regs.push({ a0: p.dir, n: p.len + 1, c: PROG_COLOR[p.name] || '--c-red', t: name + ' (' + p.len + ' istruzioni)' });
        if (p.scratch) regs.push({ a0: p.scratch[0], n: p.scratch[1], c: PROG_COLOR[p.name], t: 'zona lontana di ' + name, dash: true });
      }
      let h = '<svg viewBox="0 0 900 460" role="img" aria-label="Dove il caricatore ha messo i programmi"><circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke="var(--c-empty)" stroke-width="26"/>';
      for (const [a, t] of [[0, '0'], [2000, '2000'], [4000, '4000'], [6000, '6000']]) {
        const [x, y] = pt(a, R - 34);
        h += '<text x="' + x + '" y="' + (y + 4) + '" text-anchor="middle" font-size="11" fill="var(--ink3)" font-family="var(--mono)">' + t + '</text>';
      }
      const sorted = regs.slice().sort((x, y) => x.a0 - y.a0);
      let lastY = { l: -999, r: -999 };
      sorted.forEach((g) => {
        const minN = S * 0.006;
        const mid = g.a0 + g.n / 2;
        const a0 = mid - Math.max(g.n, minN) / 2, a1 = mid + Math.max(g.n, minN) / 2;
        const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R);
        h += '<path d="M' + x0 + ' ' + y0 + ' A ' + R + ' ' + R + ' 0 0 1 ' + x1 + ' ' + y1 + '" fill="none" stroke="var(' + g.c + ')" stroke-width="26"' + (g.dash ? ' stroke-dasharray="3 2" opacity=".6"' : '') + '/>';
        const [lx, ly] = pt(mid, R + 16);
        let [tx, ty] = pt(mid, R + 52);
        const right = tx >= cx;
        const side = right ? 'r' : 'l';
        if (Math.abs(ty - lastY[side]) < 17) ty = lastY[side] + 17;
        lastY[side] = ty;
        const ex = right ? tx + 6 : tx - 6;
        h += '<path d="M' + lx + ' ' + ly + ' L ' + tx + ' ' + ty + ' L ' + ex + ' ' + ty + '" fill="none" stroke="var(--ink3)" stroke-width="1"/>';
        h += '<text x="' + (right ? ex + 4 : ex - 4) + '" y="' + (ty + 4) + '" font-size="12.5" fill="var(--ink)" text-anchor="' + (right ? 'start' : 'end') + '">' + UI.esc(g.t) + ' <tspan fill="var(--ink3)" font-family="var(--mono)" font-size="11">@' + g.a0 + '</tspan></text>';
      });
      h += '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" font-size="16" font-weight="700" fill="var(--ink)">core</text><text x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle" font-size="12" fill="var(--ink3)">8000 celle, seme ' + sc.seed + '</text></svg>';
      el.innerHTML = h + '<div class="cap">Le zone colorate sono ingrandite: in scala vera la casella postale (36 celle) sarebbe un trattino di 1,6 gradi. Il numero dopo @ è la prima cella di ciascuna zona.</div>';
    });
  }

  window.ArenaView = ArenaView;
  window.RCArena = { loadScenario };
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.arena').forEach(el => { el._view = new ArenaView(el); });
    document.querySelectorAll('.ringmap').forEach(ringMap);
    document.querySelectorAll('[data-arena-goto]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [id, c] = btn.dataset.arenaGoto.split('@');
        const el = document.getElementById(id);
        if (el && el._view && el._view.b) { el._view.pause(); el._view.goto(+c); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      });
    });
  });
})();
