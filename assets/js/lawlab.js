/* Redcode tutorial — the law laboratory: a parser for Blue's laws and an evaluator
 * that shows, atom by atom, what a law decides about one event.
 *
 * <div class="lawtable" data-laws="code_lock,fence,..." data-events="bomb,vault_store,..."></div>
 * <div class="lawlab" data-law="ON write IF target_in(service_code) THEN block"></div>
 *
 * The events here are described by hand (who acts, on what): they are examples for
 * reading laws, not a simulation. The arena viewer runs the real thing.
 */
(function () {
  'use strict';
  const UI = window.RCUI;

  const EVENTS = {
    bomb: { t: 'Red scrive un DAT nel codice del servizio (la bomba di R0.1)', ev: 'write', actor: 'Red', region: 'service_code', own: false, tag: false, dist: 1500, entry: false },
    vault_direct: { t: 'Red scrive la cassaforte con un suo MOV (R0.2)', ev: 'write', actor: 'Red', region: 'service_data', own: false, tag: false, dist: 1500 },
    vault_store: { t: 'Il servizio scrive la cassaforte per una STORE(17) di Red (R0.3)', ev: 'write', actor: 'servizio', svc: true, region: 'service_data', own: true, tag: false, dist: 40 },
    store_ok: { t: 'Il servizio scrive work[5] per una STORE onesta di T1', ev: 'write', actor: 'servizio', svc: true, region: 'service_data', own: true, tag: true, dist: 40 },
    progress: { t: 'Il servizio aggiunge 1 al suo contatore progress', ev: 'write', actor: 'servizio', svc: true, region: 'service_data', own: true, tag: true, dist: 200 },
    flag_t1: { t: 'T1 mette FLAG = 1 nel suo posto della casella postale', ev: 'write', actor: 'T1', region: 'mailbox', own: false, tag: false, dist: 900 },
    flag_red: { t: 'Red mette FLAG = 1 nel proprio posto della casella postale', ev: 'write', actor: 'Red', region: 'mailbox', own: false, tag: false, dist: 2000 },
    jit_write: { t: 'T3 scrive il suo codice generato nelle celle libere dopo di sé', ev: 'write', actor: 'T3', region: 'free', free: true, own: false, tag: false, dist: 14 },
    jit_exec: { t: 'T3 esegue il codice che ha appena scritto (flag 0 acceso dalla scrittura, se c\'è una legge che lo accende)', ev: 'exec', actor: 'T3', region: 'own_region', own: true, tag: true, dist: 0, flags: [0] },
    t3_jump: { t: 'T3 salta nel suo buffer JIT (non è una destinazione del suo codice caricato)', ev: 'jump', actor: 'T3', region: 'own_region', own: true, tag: true, dist: 14, entry: false },
    far_t4: { t: 'T4 scrive nella sua zona lontana, a più di 2000 celle', ev: 'write', actor: 'T4', region: 'own_region', own: true, tag: true, dist: 2400 },
    spl_t5: { t: 'T5 crea un processo con SPL, come fa di continuo', ev: 'spawn', actor: 'T5', region: 'own_region', own: true, tag: true, dist: 3, rates: { spawn: 40 } },
    call_ok: { t: 'Il servizio salta a un gestore di CALL (normale)', ev: 'jump', actor: 'servizio', svc: true, region: 'service_code', own: true, tag: true, dist: 60, entry: true },
    jump_inj: { t: 'Il servizio salta in work[15] per una CALL(19) di Red (R2.4)', ev: 'jump', actor: 'servizio', svc: true, region: 'service_data', own: true, tag: false, dist: 70, entry: false },
    jump_reuse: { t: 'Il servizio salta nel mezzo del proprio codice (R2.5)', ev: 'jump', actor: 'servizio', svc: true, region: 'service_code', own: true, tag: true, dist: 216, entry: false },
    exec_inj: { t: 'Il servizio esegue la cella work[15] scritta da Red', ev: 'exec', actor: 'servizio', svc: true, region: 'service_data', own: true, tag: false, dist: 0 },
    red_read: { t: 'Red legge la cassaforte con un suo MOV', ev: 'read', actor: 'Red', region: 'service_data', own: false, tag: false, dist: 1500 },
    red_reads_self: { t: 'Red legge la propria riga di partenza (il replicatore del round 1)', ev: 'read', actor: 'Red', region: 'own_region', own: true, tag: true, dist: 1, entry: true },
  };

  const LAWS = {
    code_lock: ['Code lock', 'ON write IF target_in(service_code) THEN block'],
    fence: ['Recinto del servizio', 'ON write IF NOT actor_is_service AND target_in(service_data) THEN block'],
    isolation: ['Isolamento', 'ON write IF NOT (owner_eq OR target_in(mailbox) OR target_in(free)) THEN kill'],
    shut_mailbox: ['Isolamento grezzo (trappola)', 'ON write IF NOT owner_eq THEN kill'],
    distance: ['Limite di distanza', 'ON write IF distance_gt(300) THEN block'],
    cfi_crude: ['CFI grezzo', 'ON jump IF NOT is_entry THEN block'],
    cfi: ['CFI solo per il servizio', 'ON jump IF NOT is_entry AND actor_is_service THEN block'],
    dep: ['DEP per regioni', 'ON exec IF actor_is_service AND NOT target_in(service_code) THEN kill'],
    wx: ['W^X, seconda metà', 'ON exec IF flag(0) THEN kill'],
    tags: ['Tag degli oggetti', 'ON write IF NOT tag_eq(4) AND target_in(service_data) THEN block'],
    tags_trap: ['Tag senza eccezioni (trappola)', 'ON write IF NOT tag_eq(4) THEN block'],
    spawn_limit: ['Limite alle nascite', 'ON spawn IF rate_gt(spawn, 4, 100) THEN block'],
    read_iso: ['Isolamento delle letture', 'ON read IF NOT actor_is_service AND target_in(service_data) THEN block'],
    read_trap: ['Trappola di lettura (pilot)', 'ON read IF is_entry AND NOT actor_is_service THEN kill'],
  };

  // ------------------------------------------------------------ parser
  function tokenize(s) {
    const t = s.match(/\(|\)|,|[A-Za-z_]\w*|-?\d+/g);
    return t || [];
  }
  function parseLaw(text) {
    const toks = tokenize(text);
    let i = 0;
    const peek = () => toks[i];
    const take = (want) => {
      const t = toks[i++];
      if (want && (!t || t.toUpperCase() !== want)) throw new Error('mi aspettavo ' + want + (t ? ', trovo ' + t : ''));
      return t;
    };
    take('ON');
    const event = (take() || '').toLowerCase();
    if (!['write', 'read', 'exec', 'jump', 'spawn', 'tick'].includes(event)) throw new Error('evento sconosciuto: ' + event);
    let T = null;
    if (event === 'tick') { take('('); T = +take(); take(')'); }
    let cond = null;
    if (peek() && peek().toUpperCase() === 'IF') { take(); cond = pOr(); }
    take('THEN');
    const action = (take() || '').toLowerCase();
    if (!['allow', 'block', 'kill', 'restart_service'].includes(action)) throw new Error('azione sconosciuta: ' + action);
    const effects = [];
    while (peek() === ',') {
      take();
      const name = take();
      const args = [];
      if (peek() === '(') { take(); while (peek() !== ')') { args.push(take()); if (peek() === ',') take(); } take(')'); }
      effects.push([name].concat(args));
    }
    if (i < toks.length) throw new Error('testo in più: ' + toks.slice(i).join(' '));
    return { event, T, cond, action, effects };
    function pOr() { let x = pAnd(); while (peek() && peek().toUpperCase() === 'OR') { take(); x = ['or', x, pAnd()]; } return x; }
    function pAnd() { let x = pNot(); while (peek() && peek().toUpperCase() === 'AND') { take(); x = ['and', x, pNot()]; } return x; }
    function pNot() {
      if (peek() && peek().toUpperCase() === 'NOT') { take(); return ['not', pNot()]; }
      if (peek() === '(') { take(); const x = pOr(); take(')'); return x; }
      const name = take();
      if (!name) throw new Error('condizione incompleta');
      const args = [];
      if (peek() === '(') { take(); while (peek() !== ')') { if (peek() === undefined) throw new Error('manca )'); args.push(take()); if (peek() === ',') take(); } take(')'); }
      return ['atom', name].concat(args);
    }
  }

  // ------------------------------------------------------------ evaluation on facts
  function atomVal(a, f) {
    const name = a[1];
    switch (name) {
      case 'actor_is_service': return [!!f.svc, 'chi agisce è ' + f.actor];
      case 'target_in': {
        const R = a[2];
        const v = R === 'own_region' ? !!f.own : R === 'free' ? !!f.free : f.region === R;
        const where = { service_code: 'codice del servizio', service_data: 'dati del servizio', mailbox: 'casella postale', own_region: 'celle di chi agisce', free: 'celle libere' }[R] || R;
        return [v, 'il bersaglio ' + (v ? 'sta' : 'non sta') + ' in ' + where];
      }
      case 'owner_eq': return [!!f.own, f.own ? 'il bersaglio è di chi agisce' : 'il bersaglio non è di chi agisce'];
      case 'tag_eq': return [!!f.tag, f.tag ? 'il tag dell\'istruzione e quello della cella coincidono' : 'il tag dell\'istruzione è diverso da quello della cella'];
      case 'flag': { const v = (f.flags || []).includes(+a[2]); return [v, 'flag ' + a[2] + (v ? ' acceso' : ' spento') + ' sul bersaglio']; }
      case 'distance_gt': return [f.dist > +a[2], 'distanza ' + f.dist + (f.dist > +a[2] ? ' > ' : ' ≤ ') + a[2]];
      case 'is_entry': return [!!f.entry, f.entry ? 'il bersaglio è una destinazione prevista dal codice di chi agisce' : 'il bersaglio non è una destinazione prevista'];
      case 'rate_gt': {
        const r = ((f.rates || {})[a[2]] || 0) * (+a[4]) / 100;
        return [r > +a[3], 'circa ' + Math.round(r) + ' eventi ' + a[2] + ' negli ultimi ' + a[4] + ' cicli'];
      }
      case 'canaries_intact': return [f.canaries !== false, 'canary intatti'];
      case 'service_stalled': return [(f.stalled || 0) >= +a[2], 'servizio fermo da ' + (f.stalled || 0) + ' cicli'];
      default: return [false, 'atomo sconosciuto'];
    }
  }

  function fmtCond(c, f, out) {
    if (c[0] === 'atom') {
      const [v, why] = atomVal(c, f);
      const txt = c[1] + (c.length > 2 ? '(' + c.slice(2).join(', ') + ')' : '');
      out.push({ txt, v, why });
      return v;
    }
    if (c[0] === 'not') return !fmtCond(c[1], f, out);
    const x = fmtCond(c[1], f, out);
    const y = fmtCond(c[2], f, out);
    return c[0] === 'and' ? x && y : x || y;
  }

  function evaluate(law, f) {
    if (law.event !== f.ev) return { res: 'none', atoms: [], cond: null };
    const atoms = [];
    const cond = law.cond ? fmtCond(law.cond, f, atoms) : true;
    return { res: cond ? law.action : 'allow', atoms, cond, fired: cond };
  }

  const RES_IT = { block: 'blocca', kill: 'uccide', allow: 'permette', restart_service: 'riavvia', none: '—' };
  const RES_CLS = { block: 'block', kill: 'kill', allow: 'allow', restart_service: 'restart', none: '' };

  function chip(r) {
    if (r.res === 'none') return '<span style="color:var(--ink3)">—</span>';
    return '<span class="res ' + RES_CLS[r.res] + '">' + RES_IT[r.res] + '</span>';
  }

  function explain(law, r, ev) {
    if (r.res === 'none') return 'Questa legge ascolta gli eventi <b>' + law.event + '</b>, e questo è un evento <b>' + ev.ev + '</b>: non la riguarda.';
    let h = '';
    if (!law.cond) h += 'La legge non ha condizione: scatta sempre. ';
    else {
      h += '<div>' + r.atoms.map(a => '<div class="atomrow">' + UI.esc(a.txt) + ' <span class="tv ' + (a.v ? 't' : 'f') + '">' + (a.v ? 'vero' : 'falso') + '</span> <span style="font-family:var(--font);color:var(--ink3);font-size:12.5px">— ' + UI.esc(a.why) + '</span></div>').join('') + '</div>';
      h += '<div style="margin-top:4px">Con NOT, AND e OR la condizione intera è <b>' + (r.cond ? 'vera' : 'falsa') + '</b>. ';
    }
    h += r.fired ? (law.action === 'allow' ? 'L\'azione è <b>allow</b>: l\'operazione avviene (e si guardano le leggi dopo).' : 'Quindi la legge <b>' + RES_IT[law.action] + '</b>.') : 'Quindi la legge non scatta e l\'operazione avviene.';
    return h + '</div>';
  }

  // ------------------------------------------------------------ widgets
  function lawTable(el) {
    const laws = (el.dataset.laws || '').split(',').map(s => s.trim()).filter(Boolean);
    const evs = (el.dataset.events || '').split(',').map(s => s.trim()).filter(Boolean);
    const parsed = laws.map(k => parseLaw(LAWS[k][1]));
    el.classList.add('w');
    let h = '<div class="w-head"><span class="w-title">' + (el.dataset.title || 'Che cosa decide ogni legge') + '</span><span class="w-sub">clicca un risultato per vedere perché</span></div><div style="overflow-x:auto;padding:4px 10px"><table class="truth"><tr><th>evento</th>' +
      laws.map(k => '<th title="' + UI.esc(LAWS[k][1]) + '">' + LAWS[k][0] + '</th>').join('') + '</tr>';
    evs.forEach((e, ei) => {
      const ev = EVENTS[e];
      h += '<tr><td>' + ev.t + '</td>' + parsed.map((law, li) => '<td><span data-c="' + ei + ',' + li + '">' + chip(evaluate(law, ev)) + '</span></td>').join('') + '</tr>';
    });
    h += '</table></div><div class="w-foot why">Le leggi, per esteso: ' + laws.map(k => '<div><b>' + LAWS[k][0] + ':</b> <code>' + UI.esc(LAWS[k][1]) + '</code></div>').join('') + '</div>';
    el.innerHTML = h;
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-c]');
      if (!c) return;
      const [ei, li] = c.dataset.c.split(',').map(Number);
      const ev = EVENTS[evs[ei]], law = parsed[li];
      el.querySelector('.why').innerHTML = '<div style="color:var(--ink)"><b>' + LAWS[laws[li]][0] + '</b> <code>' + UI.esc(LAWS[laws[li]][1]) + '</code><br>su: <i>' + ev.t + '</i></div><div style="margin-top:6px;color:var(--ink)">' + explain(law, evaluate(law, ev), ev) + '</div>';
    });
  }

  function lawLab(el) {
    const evs = (el.dataset.events || Object.keys(EVENTS).join(',')).split(',').map(s => s.trim());
    el.classList.add('w');
    el.innerHTML = '<div class="w-head"><span class="w-title">Laboratorio: scrivi una legge</span><span class="w-sub">la legge viene provata su ogni evento della lista</span></div>' +
      '<div class="lawgrid"><div class="col1"><input type="text" spellcheck="false" value="' + UI.esc(el.dataset.law || LAWS.code_lock[1]) + '"><div class="err msim-err" style="margin:4px 0"></div>' +
      '<div style="font-size:12.5px;color:var(--ink3);margin-bottom:4px">Prova anche: ' + ['fence', 'cfi', 'tags', 'tags_trap', 'distance'].map(k => '<a href="#" data-l="' + k + '">' + LAWS[k][0] + '</a>').join(' · ') + '</div>' +
      '<div class="evs"></div></div><div class="col2 detail"></div></div>';
    const inp = el.querySelector('input');
    const evBox = el.querySelector('.evs');
    let sel = 0;
    const draw = () => {
      let law;
      try { law = parseLaw(inp.value); el.querySelector('.err').textContent = ''; }
      catch (e) { el.querySelector('.err').textContent = e.message; return; }
      evBox.innerHTML = evs.map((k, i) => '<div class="evcard' + (i === sel ? ' sel' : '') + '" data-e="' + i + '">' + chip(evaluate(law, EVENTS[k])) + ' ' + EVENTS[k].t + '</div>').join('');
      const ev = EVENTS[evs[sel]];
      el.querySelector('.detail').innerHTML = '<div style="font-weight:650;margin-bottom:6px">' + ev.t + '</div><div style="font-size:13px;color:var(--ink3);margin-bottom:8px">evento <b>' + ev.ev + '</b> · chi agisce: ' + ev.actor + '</div>' + explain(law, evaluate(law, ev), ev);
    };
    inp.addEventListener('input', draw);
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-e]');
      if (c) { sel = +c.dataset.e; draw(); }
      const l = e.target.closest('[data-l]');
      if (l) { e.preventDefault(); inp.value = LAWS[l.dataset.l][1]; draw(); }
    });
    draw();
  }

  window.RCLaw = { parseLaw, evaluate, EVENTS, LAWS };
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.lawtable').forEach(lawTable);
    document.querySelectorAll('.lawlab').forEach(lawLab);
  });
})();
