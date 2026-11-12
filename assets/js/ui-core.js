/* Redcode tutorial — page chrome, code colouring, quizzes, and the Italian narrator
 * that turns what the engine did into sentences. Shared by msim.js and arena.js. */
(function () {
  'use strict';
  const RC = window.RC;

  // ------------------------------------------------------------------ chapters
  const CHAPTERS = [
    { part: 'I · Le basi di Core War' },
    { f: '01-memoria.html', t: 'La memoria e il processo', lvl: '−10000' },
    { f: '02-distanze.html', t: 'Distanze, non indirizzi', lvl: '−5000' },
    { f: '03-modi.html', t: 'I modi di indirizzamento', lvl: '−2000' },
    { f: '04-istruzioni.html', t: 'Modificatori e istruzioni', lvl: '−1000' },
    { f: '05-guerrieri.html', t: 'Primi guerrieri', lvl: '−500' },
    { part: "II · L'arena di Landlord War" },
    { f: '06-arena.html', t: "La mappa dell'arena", lvl: '0' },
    { f: '07-casella.html', t: 'La casella postale e il prelude', lvl: '100' },
    { f: '08-servizio.html', t: 'Dentro il servizio', lvl: '300' },
    { part: 'III · Gli attacchi di Red' },
    { f: '09-stadio0.html', t: 'Stadio 0: bombe e cassaforte', lvl: '500' },
    { f: '10-attacchi-casella.html', t: 'Attacchi attraverso la casella', lvl: '1000' },
    { part: 'IV · Le difese di Blue' },
    { f: '11-leggi.html', t: 'Le leggi della macchina', lvl: '2000' },
    { f: '12-difese.html', t: 'Le difese, una per una', lvl: '3000' },
    { f: '13-arbitro.html', t: "L'arbitro e il punteggio", lvl: '4000' },
    { part: 'V · Evoluzione e pilot' },
    { f: '14-evoluzione.html', t: 'Come evolvono Red e Blue', lvl: '6000' },
    { f: '15-pilot.html', t: 'Il pilot, round per round', lvl: '8000' },
    { f: '16-lineage.html', t: 'Rileggere il lineage', lvl: 'HERO' },
    { part: 'Appendice' },
    { f: 'glossario.html', t: 'Glossario', lvl: '' },
  ];

  function curFile() {
    const p = location.pathname.split('/').pop();
    return p || 'index.html';
  }

  function buildChrome() {
    const side = document.getElementById('side');
    const cur = curFile();
    if (side) {
      let h = '<a class="brand" href="index.html">Redcode <span>da −10000 a eroe</span></a>' +
        '<div class="sub">Core War e Landlord War, passo per passo</div><ol>';
      let n = 0;
      for (const c of CHAPTERS) {
        if (c.part) { h += '</ol><h4>' + c.part + '</h4><ol>'; continue; }
        const num = c.f.match(/^(\d+)/) ? String(++n) : '·';
        h += '<li><a href="' + c.f + '"' + (c.f === cur ? ' class="cur"' : '') + '><span class="n">' + num +
          '</span><span>' + c.t + '</span>' + (c.lvl ? '<span class="lvl">' + c.lvl + '</span>' : '') + '</a></li>';
      }
      h += '</ol><button class="theme-btn" id="themebtn">☾ / ☀ tema</button>';
      side.innerHTML = h;
      const tb = document.getElementById('themebtn');
      tb.addEventListener('click', () => {
        const r = document.documentElement;
        const dark = r.dataset.theme ? r.dataset.theme === 'dark'
          : window.matchMedia('(prefers-color-scheme: dark)').matches;
        r.dataset.theme = dark ? 'light' : 'dark';
        try { localStorage.setItem('rc-theme', r.dataset.theme); } catch (e) { /* no storage */ }
        document.dispatchEvent(new Event('rc-theme'));
      });
    }
    const top = document.getElementById('topbar');
    if (top) {
      top.innerHTML = '<a href="index.html"><b>Redcode</b> da −10000 a eroe</a><button id="menubtn">☰ capitoli</button>';
      document.getElementById('menubtn').addEventListener('click', () => side.classList.toggle('open'));
    }
    const nav = document.getElementById('chapnav');
    if (nav) {
      const pages = CHAPTERS.filter(c => c.f);
      const i = pages.findIndex(c => c.f === cur);
      let h = '';
      if (i > 0) h += '<a class="prev" href="' + pages[i - 1].f + '"><small>← indietro</small>' + pages[i - 1].t + '</a>';
      else if (cur !== 'index.html') h += '<a class="prev" href="index.html"><small>← indietro</small>Inizio</a>';
      if (i >= 0 && i < pages.length - 1) h += '<a class="next" href="' + pages[i + 1].f + '"><small>avanti →</small>' + pages[i + 1].t + '</a>';
      else if (cur === 'index.html') h += '<a class="next" href="' + pages[0].f + '"><small>comincia →</small>' + pages[0].t + '</a>';
      nav.innerHTML = h;
    }
  }
  try {
    const t = localStorage.getItem('rc-theme');
    if (t) document.documentElement.dataset.theme = t;
  } catch (e) { /* no storage */ }

  // ------------------------------------------------------------------ colours
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* colour one line of Redcode source */
  function colorLine(line) {
    let code = line, cm = '';
    const k = line.indexOf(';');
    if (k >= 0) { code = line.slice(0, k); cm = line.slice(k); }
    if (!code.trim()) return esc(code) + (cm ? '<span class="cm">' + esc(cm) + '</span>' : '');
    const lead = code.match(/^\s*/)[0];
    let rest = code.slice(lead.length);
    let out = esc(lead);
    if (/^(END|ORG)\b/i.test(rest)) return out + '<span class="op">' + esc(rest.split(/\s/)[0]) + '</span>' + esc(rest.slice(3)) + (cm ? '<span class="cm">' + esc(cm) + '</span>' : '');
    const eq = rest.match(/^([A-Za-z_]\w*)(\s+)(EQU)(\s+)(.*)$/i);
    if (eq) return out + '<span class="lbl">' + esc(eq[1]) + '</span>' + eq[2] + '<span class="op">EQU</span>' + eq[4] + esc(eq[5]) + (cm ? '<span class="cm">' + esc(cm) + '</span>' : '');
    // labels
    for (;;) {
      const m = rest.match(/^([A-Za-z_]\w*)(\s+)(.*)$/);
      if (m && !(m[1].toUpperCase() in RC.OPCODE)) { out += '<span class="lbl">' + esc(m[1]) + '</span>' + m[2]; rest = m[3]; continue; }
      break;
    }
    const m = rest.match(/^([A-Za-z]{3})(\s*\.\s*[A-Za-z]{1,2})?(\s*)([^,]*)(,?)(.*)$/);
    if (!m || !(m[1].toUpperCase() in RC.OPCODE)) return out + esc(rest) + (cm ? '<span class="cm">' + esc(cm) + '</span>' : '');
    out += '<span class="op">' + esc(m[1]) + '</span>';
    if (m[2]) out += '<span class="mod">' + esc(m[2]) + '</span>';
    out += m[3];
    const aTxt = m[4];
    const aTrim = aTxt.replace(/\s+$/, '');
    if (aTrim) out += '<span class="fa">' + esc(aTrim) + '</span>' + esc(aTxt.slice(aTrim.length));
    else out += esc(aTxt);
    out += m[5];
    const bTxt = m[6];
    const bTrim = bTxt.trim();
    if (bTrim) {
      const i0 = bTxt.indexOf(bTrim);
      out += esc(bTxt.slice(0, i0)) + '<span class="fb">' + esc(bTrim) + '</span>' + esc(bTxt.slice(i0 + bTrim.length));
    } else out += esc(bTxt);
    return out + (cm ? '<span class="cm">' + esc(cm) + '</span>' : '');
  }

  function colorLaw(line) {
    let code = line, cm = '';
    const k = line.indexOf('#');
    if (k >= 0) { code = line.slice(0, k); cm = line.slice(k); }
    let h = esc(code)
      .replace(/\b(ON|IF|THEN|AND|OR|NOT)\b/g, '<span class="law-kw">$1</span>')
      .replace(/\b(write|read|exec|jump|spawn|tick)\b/g, '<span class="fa">$1</span>')
      .replace(/\b(allow|block|kill|restart_service)\b/g, '<span class="fb">$1</span>');
    return h + (cm ? '<span class="cm">' + esc(cm) + '</span>' : '');
  }

  function colorBlocks(root) {
    (root || document).querySelectorAll('pre.rc:not([data-done])').forEach(pre => {
      pre.dataset.done = '1';
      const src = pre.textContent.replace(/^\n/, '').replace(/\s+$/, '');
      pre.dataset.src = src;
      const hl = (pre.dataset.hl || '').split(',').filter(Boolean).map(Number);
      const dim = (pre.dataset.dim || '').split(',').filter(Boolean).map(Number);
      pre.innerHTML = src.split('\n').map((l, i) => {
        let h = colorLine(l);
        if (hl.includes(i + 1)) h = '<span class="hlline">' + h + '</span>';
        else if (dim.includes(i + 1)) h = '<span class="dim">' + h + '</span>';
        return h;
      }).join('\n');
      if (pre.hasAttribute('data-numbers')) addNumberToggle(pre, src);
    });
    (root || document).querySelectorAll('pre.law:not([data-done])').forEach(pre => {
      pre.dataset.done = '1';
      pre.classList.add('rc');
      const src = pre.textContent.replace(/^\n/, '').replace(/\s+$/, '');
      pre.innerHTML = src.split('\n').map(colorLaw).join('\n');
    });
  }

  /* a button that swaps labels for the numbers the assembler writes */
  function addNumberToggle(pre, src) {
    let parsed;
    try { parsed = RC.parse(src, pre.dataset.defs ? JSON.parse(pre.dataset.defs) : {}); } catch (e) { return; }
    const lines = src.split('\n');
    const numLines = lines.slice();
    parsed.lines.forEach((ln, k) => {
      const i = parsed.instructions[k];
      const line = lines[ln];
      const sc = line.indexOf(';');
      const cm = sc >= 0 ? line.slice(sc) : '';
      const lab = line.match(/^(\s*)([A-Za-z_]\w*)\s+/);
      let labTxt = '';
      if (lab && !(lab[2].toUpperCase() in RC.OPCODE)) labTxt = lab[2];
      const instr = RC.OPS[i[0]] + '.' + RC.MODS[i[1]] + ' ' + RC.MODES[i[2]] + i[3] + ', ' + RC.MODES[i[4]] + i[5];
      const width = Math.max(8, (line.match(/^\s*[A-Za-z_]\w*\s+/) || [''])[0].length);
      let s = (labTxt ? labTxt : '').padEnd(labTxt ? width : width, ' ') + instr;
      if (cm) s = s.padEnd(Math.max(s.length + 2, sc), ' ') + cm;
      numLines[ln] = s;
    });
    const wrap = document.createElement('div');
    wrap.className = 'lbltoggle';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    const btn = document.createElement('button');
    btn.className = 'btn tg';
    btn.textContent = 'mostra i numeri';
    wrap.appendChild(btn);
    let showing = false;
    const labHtml = pre.innerHTML;
    const numHtml = numLines.map(colorLine).join('\n');
    btn.addEventListener('click', () => {
      showing = !showing;
      pre.innerHTML = showing ? numHtml : labHtml;
      btn.textContent = showing ? 'mostra le etichette' : 'mostra i numeri';
      btn.classList.toggle('on', showing);
    });
  }

  // ------------------------------------------------------------------ quizzes
  function quizzes() {
    document.querySelectorAll('.quiz').forEach(q => {
      q.querySelectorAll('button.opt').forEach(b => {
        b.addEventListener('click', () => {
          q.querySelectorAll('button.opt').forEach(x => {
            if (x.hasAttribute('data-right')) x.classList.add('right');
          });
          if (!b.hasAttribute('data-right')) b.classList.add('wrong');
          q.classList.add('done');
        });
      });
    });
  }

  // ------------------------------------------------------------------ narration
  const FIELD_IT = { A: 'campo A', B: 'campo B' };
  const MOD_COPY = {
    A: 'il campo A della sorgente nel campo A della destinazione',
    B: 'il campo B della sorgente nel campo B della destinazione',
    AB: 'il campo A della sorgente nel campo B della destinazione',
    BA: 'il campo B della sorgente nel campo A della destinazione',
    F: 'A nel campo A e B nel campo B',
    X: 'A nel campo B e B nel campo A (incrociati)',
    I: "l'intera cella (istruzione e numeri)",
  };
  const ARITH_SYM = { 2: '+', 3: '−', 4: '×', 5: '÷', 6: 'mod' };
  const ARITH_WORD = { 2: 'somma', 3: 'sottrae', 4: 'moltiplica', 5: 'divide', 6: 'calcola il resto' };

  function insHtml(k, a, b) {
    return '<code class="ins"><span class="op">' + RC.OPS[k >> 9] + '</span><span class="mod">.' + RC.MODS[(k >> 6) & 7] +
      '</span> <span class="fa">' + RC.MODES[(k >> 3) & 7] + a + '</span>, <span class="fb">' + RC.MODES[k & 7] + b + '</span></code>';
  }

  function badge(name, color) {
    return '<span class="pc" style="background:' + color + ';display:inline-block;color:#fff;border-radius:4px;padding:0 5px;font-size:12px;font-weight:800">' + esc(name) + '</span>';
  }

  /* ctx: {S, nameOf(pid), colorOf(pid), where(addr) -> html, lawText(i), procCount(pid)} */
  function narrate(seg, ctx) {
    if (!seg || !seg.length) return '<span class="empty-n">Nessuna istruzione eseguita.</span>';
    const ex = seg.find(e => e.k === 'exec');
    const st = seg.find(e => e.k === 'stall');
    if (st && !ex) return badge(ctx.nameOf(st.pid), ctx.colorOf(st.pid)) + ' salta il turno: paga 1 ciclo di ritardo, il prezzo dei controlli fatti dalle leggi.';
    if (!ex) return '';
    const { pid, pc } = ex;
    const k = ex.ins, op = k >> 9, mod = RC.MODS[(k >> 6) & 7], am = (k >> 3) & 7, bm = k & 7;
    const S = ctx.S;
    const opsIdx = seg.findIndex(e => e.k === 'ops');
    const pre = seg.slice(0, opsIdx < 0 ? seg.length : opsIdx);
    const post = opsIdx < 0 ? [] : seg.slice(opsIdx + 1);
    const opsE = opsIdx >= 0 ? seg[opsIdx] : null;
    const end = seg.find(e => e.k === 'end');
    const W = (a) => ctx.where(a);
    const out = [];
    out.push(badge(ctx.nameOf(pid), ctx.colorOf(pid)) + ' esegue la casella <b>' + pc + '</b> ' + W(pc) + ': ' + insHtml(k, ex.an, ex.bn));
    const li = [];
    if (seg.find(e => e.k === 'ok')) li.push('✔ è la riga <code>ok</code>: l\'arbitro conta <b>un lavoro fatto</b>.');
    const pk = seg.find(e => e.k === 'pickup');
    if (pk) li.push('Qui il servizio prende in carico la richiesta del posto ' + pk.slot + ' (l\'ha scritta ' + esc(ctx.nameOf(pk.origin)) + ').');
    const lawsBefore = pre.filter(e => e.k === 'law' && e.ev === 'exec');
    for (const l of lawsBefore) li.push(lawLine(l, ctx));
    if (lawsBefore.length && lawsBefore[0].act === RC.BLOCK) {
      li.push('L\'istruzione viene saltata. Prossima: casella ' + (end ? end.next : (pc + 1) % S) + '.');
      out.push('<ul><li>' + li.join('</li><li>') + '</li></ul>');
      return out.join('');
    }
    // operands
    const usesA = op !== RC.OPCODE.DAT && op !== RC.OPCODE.NOP;
    const usesB = ![RC.OPCODE.DAT, RC.OPCODE.NOP, RC.OPCODE.JMP, RC.OPCODE.SPL].includes(op);
    const opText = (side) => {
      const mode = side === 'A' ? am : bm;
      const n = side === 'A' ? ex.an : ex.bn;
      const ms = RC.MODES[mode];
      const cls = side === 'A' ? 'fa' : 'fb';
      const tag = '<code><span class="' + cls + '">' + ms + n + '</span></code>';
      const ptr = pre.find(e => e.k === 'ptr' && e.side === side);
      const sets = pre.filter(e => e.k === 'set');
      if (mode === 0) return side + ' = ' + tag + ': il numero ' + n + ' stesso (immediato).';
      const p = RC.pmod(pc + n, S);
      if (mode === 1) return side + ' = ' + tag + ': la casella ' + pc + ' ' + sgn(n) + ' = <b>' + p + '</b> ' + W(p) + '.';
      if (!ptr) return side + ' = ' + tag + '.';
      const fld = mode >= 5 ? 'A' : 'B';
      const preDec = mode === 3 || mode === 6;
      const postInc = mode === 4 || mode === 7;
      let s = side + ' = ' + tag + ': la casella ' + pc + ' ' + sgn(n) + ' = ' + ptr.p + ' ' + W(ptr.p) + ' fa da <b>puntatore</b>. ';
      if (preDec) {
        const d = sets.find(e => e.addr === ptr.p && e.f === fld && e.v === e.old - 1);
        s += d ? 'Prima ne abbassa di 1 il ' + FIELD_IT[fld] + ' (' + d.old + ' → ' + d.v + '), poi ' : 'Prima ne abbassa di 1 il ' + FIELD_IT[fld] + ' (scrittura bloccata da una legge), poi ';
      }
      s += 'il suo ' + FIELD_IT[fld] + ' vale ' + ptr.off + ', quindi si arriva a ' + ptr.p + ' ' + sgn(ptr.off) + ' = <b>' + ptr.target + '</b> ' + W(ptr.target) + '.';
      if (postInc) {
        const d = seg.find(e => e.k === 'set' && e.addr === ptr.p && e.f === fld && e.v === e.old + 1);
        s += d ? ' Poi alza di 1 il ' + FIELD_IT[fld] + ' del puntatore (' + d.old + ' → ' + d.v + ').' : ' Poi alzerebbe di 1 il campo del puntatore (bloccato da una legge).';
      }
      return s;
    };
    if (usesA || am >= 2) li.push(opText('A'));
    if (usesB || bm >= 2) li.push(opText('B'));
    for (const l of pre.filter(e => e.k === 'law' && e.ev !== 'exec')) li.push(lawLine(l, ctx));
    const ra = opsE ? opsE.ra : pc, rb = opsE ? opsE.rb : pc;
    const lawsPost = post.filter(e => e.k === 'law');
    const opName = RC.OPS[op];
    if (op === RC.OPCODE.DAT) {
      li.push('<span class="death">È un DAT: un dato, non un\'istruzione. Il processo che lo esegue muore.</span>');
    } else if (op === RC.OPCODE.MOV) {
      const si = post.find(e => e.k === 'setI');
      const sets = post.filter(e => e.k === 'set');
      if (lawsPost.length) for (const l of lawsPost) li.push(lawLine(l, ctx));
      if (si) li.push('<code>.I</code>: copia ' + MOD_COPY.I + ' dalla casella ' + ra + ' alla casella ' + rb + '. Prima c\'era ' + insHtml(si.old[0], si.old[1], si.old[2]) + ', ora c\'è ' + insHtml(si.v[0], si.v[1], si.v[2]) + '.');
      else if (sets.length) li.push('<code>.' + mod + '</code>: copia ' + MOD_COPY[mod] + '. ' + sets.map(e => FIELD_IT[e.f] + ' della casella ' + e.addr + ': ' + e.old + ' → <b>' + e.v + '</b>').join('; ') + '.');
      else if (!lawsPost.length) li.push('Nessuna scrittura.');
    } else if (op >= RC.OPCODE.ADD && op <= RC.OPCODE.MOD) {
      const sets = post.filter(e => e.k === 'set');
      for (const l of lawsPost) li.push(lawLine(l, ctx));
      const ar = post.find(e => e.k === 'arith');
      const srcField = { A: { A: 'A' }, B: { B: 'B' }, AB: { B: 'A' }, BA: { A: 'B' }, F: { A: 'A', B: 'B' }, X: { B: 'A', A: 'B' }, I: { A: 'A', B: 'B' } }[mod];
      if (sets.length) li.push('<code>.' + mod + '</code>: ' + ARITH_WORD[op] + ' ' + (mod === 'F' || mod === 'I' ? 'campo per campo' : MOD_COPY[mod].replace('il campo', 'il campo').replace(' nel ', ' al ')) + '. ' + sets.map(e => {
        const sf = srcField[e.f];
        const sv = ar ? (sf === 'A' ? ar.a[0] : ar.a[1]) : '?';
        const exact = (op === RC.OPCODE.ADD || op === RC.OPCODE.SUB) ? '' : '';
        return FIELD_IT[e.f] + ' della casella ' + e.addr + ': ' + e.old + ' ' + ARITH_SYM[op] + ' ' + (sv < 0 ? '(' + sv + ')' : sv) + ' = <b>' + e.v + '</b>' + exact;
      }).join('; ') + '.');
      if (post.find(e => e.k === 'div0')) li.push('<span class="death">Divisione per zero: il processo muore.</span>');
    } else if (op === RC.OPCODE.JMP) {
      if (post.find(e => e.k === 'jumpblocked')) { for (const l of lawsPost) li.push(lawLine(l, ctx)); li.push('Il salto non avviene: si prosegue con la cella dopo.'); }
      else li.push('Salta: la prossima istruzione di questo processo sarà la casella <b>' + ra + '</b>.');
    } else if (op === RC.OPCODE.JMZ || op === RC.OPCODE.JMN || op === RC.OPCODE.DJN) {
      const te = post.find(e => e.k === 'test');
      const sets = post.filter(e => e.k === 'set');
      const fldName = (mod === 'A' || mod === 'BA') ? 'A' : (mod === 'B' || mod === 'AB') ? 'B' : 'A e B';
      const v = te ? (fldName === 'A' ? te.ba : fldName === 'B' ? te.bb : te.ba + ' e ' + te.bb) : '?';
      if (op === RC.OPCODE.DJN) li.push('Abbassa di 1 il ' + (fldName === 'A e B' ? 'campo A e il campo B' : 'campo ' + fldName) + ' della casella ' + rb + (sets.length ? ' (' + sets.map(e => e.old + ' → ' + e.v).join(', ') + ')' : '') + '.');
      const cond = op === RC.OPCODE.JMZ ? 'è zero' : 'non è zero';
      li.push('Controlla: il ' + (fldName === 'A e B' ? 'campo A e B' : 'campo ' + fldName) + ' della casella ' + rb + ' vale ' + v + '. ' + (te && te.c ? 'Sì, ' + cond + ' → <b>salta</b> alla casella ' + ra + '.' : 'No, non ' + (op === RC.OPCODE.JMZ ? 'è zero' : 'è diverso da zero') + ' → prosegue con la cella dopo.'));
      if (post.find(e => e.k === 'jumpblocked')) { for (const l of lawsPost) li.push(lawLine(l, ctx)); li.push('Il salto è bloccato: si prosegue con la cella dopo.'); }
    } else if (op === RC.OPCODE.SPL) {
      if (end && end.child >= 0) li.push('Crea un <b>nuovo processo</b> che partirà dalla casella ' + end.child + '. Questo processo intanto prosegue con la cella dopo.');
      else if (post.find(e => e.k === 'spawnblocked')) { for (const l of lawsPost) li.push(lawLine(l, ctx)); li.push('La creazione del processo è bloccata.'); }
      else li.push('Vorrebbe creare un processo alla casella ' + ra + ', ma il programma ne ha già il massimo (64).');
    } else if (op >= RC.OPCODE.SLT && op <= RC.OPCODE.SNE) {
      const c = post.find(e => e.k === 'cmp');
      const word = op === RC.OPCODE.SLT ? 'è minore di' : op === RC.OPCODE.SNE ? 'è diverso da' : 'è uguale a';
      let what;
      if (mod === 'I') what = 'la cella ' + ra + ' ' + word + ' la cella ' + rb + ' (intere)';
      else {
        const pick = (arr, f) => f === 'A' ? arr[1] : arr[2];
        const pairs = { A: [['A', 'A']], B: [['B', 'B']], AB: [['A', 'B']], BA: [['B', 'A']], F: [['A', 'A'], ['B', 'B']], X: [['A', 'B'], ['B', 'A']] }[mod];
        what = pairs.map(([fa, fb]) => (c ? pick(c.a, fa) : '?') + ' (campo ' + fa + ' di ' + ra + ') ' + word + ' ' + (c ? pick(c.b, fb) : '?') + ' (campo ' + fb + ' di ' + rb + ')').join(' e ');
      }
      li.push('Confronta: ' + what + '? ' + (c && c.skip ? 'Sì → <b>salta la riga dopo</b> (passa alla casella ' + RC.pmod(pc + 2, S) + ').' : 'No → prosegue con la riga dopo.'));
    } else if (op === RC.OPCODE.NOP) {
      li.push('NOP: non fa niente.');
    }
    if (end) {
      if (end.next < 0) {
        if (op !== RC.OPCODE.DAT && !post.find(e => e.k === 'div0')) {
          const kl = seg.find(e => e.k === 'law' && e.act === RC.KILL);
          if (kl) li.push('<span class="death">La legge uccide il processo.</span>');
        }
        const left = ctx.procCount(pid);
        li.push(left ? 'Restano ' + left + ' processi di ' + esc(ctx.nameOf(pid)) + '.' : '<span class="death">💀 ' + esc(ctx.nameOf(pid)) + ' non ha più processi.</span>');
      } else li.push('Prossima istruzione di questo processo: casella <b>' + end.next + '</b>.');
    }
    out.push('<ul><li>' + li.join('</li><li>') + '</li></ul>');
    return out.join('');
  }

  const ACT_IT = { 0: 'permette', 1: '<b>blocca</b>', 2: '<b>uccide il processo</b>', 3: '<b>riavvia il servizio</b>' };
  const EV_IT = { write: 'scrittura', read: 'lettura', exec: 'esecuzione', jump: 'salto', spawn: 'creazione di processo' };
  function lawLine(l, ctx) {
    return '<span class="law">⚖ La legge ' + (l.law + 1) + ' <code>' + esc(ctx.lawText(l.law)) + '</code> ' + ACT_IT[l.act] + ' questa ' + EV_IT[l.ev] + ' (bersaglio: casella ' + l.tgt + ' ' + ctx.where(l.tgt) + ').</span>';
  }

  function sgn(n) { return n < 0 ? '− ' + (-n) : '+ ' + n; }

  /* split a trace into turns (one per 'exec' or 'stall') */
  function splitTurns(trace) {
    const turns = [];
    let cur = null;
    for (const e of trace) {
      if (e.k === 'exec' || e.k === 'stall') { cur = [e]; turns.push(cur); }
      else if (cur) cur.push(e);
    }
    return turns;
  }

  /* static target of an operand (no side effects): for hover arrows */
  function staticTarget(W, S, pc, side) {
    const k = W.ins[pc];
    const mode = side === 'A' ? (k >> 3) & 7 : k & 7;
    const n = side === 'A' ? W.an[pc] : W.bn[pc];
    if (mode === 0) return { target: pc, imm: true };
    const p = RC.pmod(pc + n, S);
    if (mode === 1) return { target: p };
    const fld = mode >= 5 ? W.an[p] : W.bn[p];
    const dec = (mode === 3 || mode === 6) ? -1 : 0;
    return { ptr: p, target: RC.pmod(p + fld + dec, S) };
  }

  window.RCUI = { CHAPTERS, buildChrome, colorLine, colorLaw, colorBlocks, esc, css, narrate, splitTurns,
    insHtml, badge, staticTarget, sgn };

  document.addEventListener('DOMContentLoaded', () => {
    buildChrome();
    colorBlocks();
    quizzes();
  });
})();
