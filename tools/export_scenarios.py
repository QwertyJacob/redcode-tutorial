"""Export arena battles from the real Landlord War engine for the tutorial's simulator.

For every scenario this script loads the arena exactly as `landlord_war.engine`
does (same placement, same service, same tenants, same random streams), and saves:

* the loaded core and its metadata (only the cells that differ from an empty cell);
* the scalars the battle loop needs (queues, turn order, service addresses, ...);
* the service images that later restarts would load, in order (the random draws
  of placement, layout, canaries and tags happen at each reload);
* labels and Italian comments for every loaded cell, for the viewer;
* the reference results of the Python battle loop for some law switches, so that
  tools/check_engine.mjs can prove the JavaScript loop gives the same numbers.

Run from the tutorial folder, with the landlord_war virtualenv:

    ../landlord_war/.venv/bin/python tools/export_scenarios.py
"""

from __future__ import annotations

import copy
import gzip
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LW = os.environ.get('LANDLORD_WAR', os.path.join(os.path.dirname(ROOT), 'landlord_war'))
sys.path.insert(0, LW)

from landlord_war import arena as A          # noqa: E402
from landlord_war import config as C         # noqa: E402
from landlord_war import engine as E         # noqa: E402
from landlord_war import exploits as X       # noqa: E402
from landlord_war import laws as L           # noqa: E402
from landlord_war import programs as P       # noqa: E402
from landlord_war import redcode as rc       # noqa: E402

OUT = os.path.join(ROOT, 'data', 'scenarios')
CHAMP = os.path.join(LW, 'docs', 'm8_pilot', 'champions')
STATE = ('ins', 'an', 'bn', 'bd', 'own', 'lw', 'lo', 'mtag', 'itag', 'flg', 'region', 'entry',
         'okc', 'cnry', 'sslot', 'spick')
DEFAULT = dict(ins=E.DAT00_K, an=0, bn=0, bd=1, own=-1, lw=-1, lo=-1, flg=0, region=0, entry=-1,
               okc=-1, cnry=-1, sslot=-3, spick=-1)

# ---------------------------------------------------------------------------
# Italian comments for the viewer
# ---------------------------------------------------------------------------

SERVICE_IT = [
    (r'main loop: one more pass', 'ciclo principale: un giro in più, quindi progress + 1 (il segno di vita)'),
    (r'slot (\d): no request', r'posto \1: nessuna richiesta (FLAG = 0)? allora guarda il posto dopo'),
    (r'save the return address: handlers come back to (d\d)', r'salva in ret l\'indirizzo di ritorno: i gestori tornano a \1'),
    (r'OP minus 1; if it was not 1', 'OP − 1; se OP non era 1 (STORE), prova FILL'),
    (r'STORE: turn i into a pointer', 'STORE: trasforma i in un puntatore da ARG1 a work[i]'),
    (r'STORE: copy the whole cell v', 'STORE: copia la cella intera v da ARG2 in work[i] (bug: i non è controllato)'),
    (r'reply 1: done', 'risposta 1: fatto'),
    (r'return through ret', 'ritorna saltando dove dice ret'),
    (r'was OP 2 \(FILL\)', 'OP era 2 (FILL)? se no, prova READ'),
    (r'FILL: is n larger than fill_max', 'FILL: n è più grande di fill_max (32)?'),
    (r'no: keep n', 'no: tieni n'),
    (r'yes: cut n down', 'sì: taglia n a 32'),
    (r'turn i into a pointer from ARG1 to work\[i\]', 'trasforma i in un puntatore da ARG1 a work[i]'),
    (r'is n at least 1', 'n è almeno 1?'),
    (r'no: nothing to write, return', 'no: niente da scrivere, ritorna'),
    (r'write v into the next cell', 'scrive v nella cella puntata, poi sposta il puntatore (bug: può uscire da work)'),
    (r'one cell less to write', 'una cella in meno da scrivere; ripete finché n = 0'),
    (r'was OP 3 \(READ\)', 'OP era 3 (READ)? se no, prova CALL'),
    (r'READ: turn i into a pointer', 'READ: trasforma i in un puntatore a work[i]'),
    (r'READ: reply with a copy', 'READ: risponde con una copia di work[i] (bug: i non è controllato)'),
    (r'was OP 4 \(CALL\)', 'OP era 4 (CALL)? se no, è una richiesta sbagliata'),
    (r'CALL returns to (dc\d)', r'CALL: i gestori torneranno a \1, che copia la risposta'),
    (r'turn k into a pointer to table', 'trasforma k in un puntatore a table[k]'),
    (r'fetch table\[k\]', 'prende table[k]: la distanza del gestore da table[0] (bug: k non è controllato)'),
    (r'make it a pointer from ARG3', 'la trasforma in un puntatore da ARG3 al gestore'),
    (r'jump to the handler', 'salta al gestore'),
    (r'bad request: reply -1', 'richiesta sbagliata: risposta −1'),
    (r'clear the flag$', 'azzera FLAG'),
    (r'back to the main loop \(an error', 'torna al ciclo principale (un errore non conta come richiesta servita)'),
    (r"reply with the CALL handler's answer", 'risponde con la risposta del gestore CALL (campo A di ret)'),
    (r'clear the flag: the request is answered', 'azzera FLAG: la richiesta ha una risposta'),
    (r'ok: one request served', 'ok: una richiesta servita (il contatore del lavoro); torna al ciclo, posto dopo'),
    (r"CALL handler (\d): leave the answer (\d+)", r'gestore CALL \1: lascia la risposta \2 nel campo A di ret'),
    (r'table\[(\d)\]: where CALL handler', r'table[\1]: dove sta il gestore \1, come distanza da table[0]'),
    (r'work\[(\d+)\]: buffer', r'work[\1]: il buffer che i clienti scrivono e leggono'),
    (r'ret: return cell', 'ret: la cella di ritorno (B = dove tornano i gestori, A = risposta di CALL)'),
    (r'vault: a secret', 'vault: la cassaforte, non deve mai cambiare'),
    (r'progress: liveness counter', 'progress: contatore di vita, sale a ogni giro'),
    (r'canary: a secret value', 'canary: valore segreto, non deve mai cambiare'),
    (r'secret: two random numbers', 'secret: due numeri casuali, rubati se arrivano nella memoria di Red'),
]

PROGRAM_IT = {
    # prelude and pointers (T1, T2, exploits)
    'pf.B <- distance from my directory cell to my FLAG cell': 'pf.B ← distanza dalla mia directory cell al mio FLAG',
    '... plus the distance from pf back to the directory cell: pf now points at FLAG': '... più la distanza da pf alla directory cell: ora pf punta a FLAG',
    '... plus the distance from pf back to the directory cell: pf points at FLAG': '... più la distanza da pf alla directory cell: ora pf punta a FLAG',
    'po starts as a copy of pf ...': 'po parte come copia di pf ...',
    'po <- a copy of pf ...': 'po ← copia di pf ...',
    'p1 starts as a copy of pf ...': 'p1 parte come copia di pf ...',
    'p1 <- a copy of pf ...': 'p1 ← copia di pf ...',
    'p2 starts as a copy of pf ...': 'p2 parte come copia di pf ...',
    'p2 <- a copy of pf ...': 'p2 ← copia di pf ...',
    'p3 <- a copy of pf ...': 'p3 ← copia di pf ...',
    'pr starts as a copy of pf ...': 'pr parte come copia di pf ...',
    'pr <- a copy of pf ...': 'pr ← copia di pf ...',
    '... adjusted to point at OP (FLAG + 1)': '... corretto per puntare a OP (FLAG + 1)',
    '... adjusted to point at ARG1 (FLAG + 2)': '... corretto per puntare a ARG1 (FLAG + 2)',
    '... adjusted to point at ARG2 (FLAG + 3)': '... corretto per puntare a ARG2 (FLAG + 3)',
    '... adjusted to point at REPLY (FLAG + 5)': '... corretto per puntare a REPLY (FLAG + 5)',
    '... adjusted to point at OP': '... corretto per puntare a OP',
    '... adjusted to point at ARG1': '... corretto per puntare a ARG1',
    '... adjusted to point at REPLY': '... corretto per puntare a REPLY',
    '... moved to point at OP': '... spostato su OP',
    '... moved to point at ARG1': '... spostato su ARG1',
    '... moved to point at ARG2': '... spostato su ARG2',
    '... moved to point at ARG3': '... spostato su ARG3',
    '... moved to point at REPLY': '... spostato su REPLY',
    'pointer to FLAG': 'puntatore a FLAG',
    'pointer to my FLAG': 'puntatore al mio FLAG',
    'pointer to OP': 'puntatore a OP',
    'pointer to my OP': 'puntatore al mio OP',
    'pointer to ARG1': 'puntatore a ARG1',
    'pointer to my ARG1': 'puntatore al mio ARG1',
    'pointer to ARG2': 'puntatore a ARG2',
    'pointer to my ARG2': 'puntatore al mio ARG2',
    'pointer to my ARG3': 'puntatore al mio ARG3',
    'pointer to REPLY': 'puntatore a REPLY',
    'pointer to my REPLY': 'puntatore al mio REPLY',
    # T1
    'next index i ...': 'prossimo indice i ...',
    '... kept in 0..15': '... tenuto fra 0 e 15',
    'change the value v we will store, so the check means something': 'cambia il valore v da salvare, così il controllo ha senso',
    'OP <- 1 (STORE)': 'OP ← 1 (STORE)',
    'ARG1 <- i': 'ARG1 ← i',
    'ARG2 <- v (the whole cell)': 'ARG2 ← v (la cella intera)',
    'FLAG <- 1: the request is ready': 'FLAG ← 1: la richiesta è pronta',
    'wait until the service clears FLAG': 'aspetta finché il servizio azzera FLAG',
    'OP <- 3 (READ)': 'OP ← 3 (READ)',
    'ARG1 <- i again (the service changed it)': 'ARG1 ← i di nuovo (il servizio l\'ha cambiato)',
    'FLAG <- 1': 'FLAG ← 1',
    'wait for the answer': 'aspetta la risposta',
    'is REPLY exactly v? then skip the next line': 'REPLY è esattamente v? allora salta la riga dopo',
    'no: this unit of work failed, try again': 'no: questo lavoro è fallito, riprova',
    'ok: one STORE/READ checked; go again': 'ok: una STORE/READ controllata; ancora',
    'the index i': 'l\'indice i',
    'the value v': 'il valore v',
    'how v changes each time': 'di quanto cambia v ogni volta',
    # T2
    'next handler number k ...': 'prossimo numero di gestore k ...',
    '... kept in 0..3': '... tenuto fra 0 e 3',
    'OP <- 4 (CALL)': 'OP ← 4 (CALL)',
    'ARG1 <- k': 'ARG1 ← k',
    'the answer we expect is k ...': 'la risposta attesa è k ...',
    '... plus 100': '... più 100',
    'is REPLY different from what we expect? then skip the ok': 'REPLY è diverso da quello atteso? allora salta l\'ok',
    'ok: one CALL checked; go again': 'ok: una CALL controllata; ancora',
    'failed: try again': 'fallito: riprova',
    'the handler number k': 'il numero di gestore k',
    'the answer we expect': 'la risposta attesa',
    # T3
    'the JIT buffer: the first free cells after my code': 'il buffer JIT: le prime celle libere dopo il mio codice',
    'write the first generated instruction into the buffer': 'scrive la prima istruzione generata nel buffer',
    'write the second one': 'scrive la seconda',
    'remember acc before running the generated code': 'ricorda acc prima di eseguire il codice generato',
    'run the code we just wrote': 'esegue il codice appena scritto',
    'acc - before: how much the generated code added ...': 'acc − before: quanto ha aggiunto il codice generato ...',
    '... was it exactly 7? then skip the next line': '... era esattamente 7? allora salta la riga dopo',
    'no: failed': 'no: fallito',
    'ok: the generated code ran correctly; clear acc': 'ok: il codice generato ha funzionato; azzera acc',
    'and go again': 'e ricomincia',
    'failed: clear acc ...': 'fallito: azzera acc ...',
    '... and try again': '... e riprova',
    'template: (when run from the buffer) add 7 to acc': 'modello: (eseguito dal buffer) aggiunge 7 ad acc',
    'template: (when run from the buffer) jump back to `back`': 'modello: (eseguito dal buffer) torna a `back`',
    'accumulator the generated code adds to': 'accumulatore a cui il codice generato aggiunge',
    'acc before the generated code ran': 'acc prima che girasse il codice generato',
    'last cell of my code': 'ultima cella del mio codice',
    # T4
    'ptr <- pointer to the first scratch cell': 'ptr ← puntatore alla prima cella della zona lontana',
    'change the value, so the check means something': 'cambia il valore, così il controllo ha senso',
    'write it into the current scratch cell (far away)': 'lo scrive nella cella lontana attuale',
    'read it back: is it the same? then skip the next line': 'lo rilegge: è uguale? allora salta la riga dopo',
    'no: the write did not happen; failed': 'no: la scrittura non è avvenuta; fallito',
    'ok: one far write checked': 'ok: una scrittura lontana controllata',
    'move to the next scratch cell ...': 'passa alla cella lontana dopo ...',
    '... and count': '... e conta',
    'past the 16th cell? then skip the next line': 'oltre la sedicesima cella? allora salta la riga dopo',
    'no: keep going': 'no: continua',
    'yes: back to the first cell': 'sì: torna alla prima cella',
    'ptr back by 16': 'ptr indietro di 16',
    'and keep going': 'e continua',
    'pointer into the scratch region': 'puntatore nella zona lontana',
    'which scratch cell we are at': 'a quale cella lontana siamo',
    'the value we write': 'il valore che scriviamo',
    'how the value changes each time': 'di quanto cambia il valore ogni volta',
    # T5
    'split: now 2 processes, both go on to the next line': 'split: ora 2 processi, tutti e due vanno alla riga dopo',
    'split again: 4 processes': 'split di nuovo: 4 processi',
    'and again: 8 processes': 'e ancora: 8 processi',
    'small work: add 1 to the counter': 'piccolo lavoro: +1 al contatore',
    'ok: one unit of work done': 'ok: un lavoro fatto',
    'start a fresh worker at `work` ...': 'avvia un nuovo lavoratore su `work` ...',
    '... and end this one, so the pool stays at 8': '... e termina questo, così restano 8',
    'the counter': 'il contatore',
    # exploits
    'attack done: wait here forever': 'attacco finito: resta qui per sempre',
    'the value Red wants in the vault': 'il valore che Red vuole nella cassaforte',
    "Red's instruction (a loop); B = distance table[0] -> work[15]": "l'istruzione di Red (un ciclo); B = distanza table[0] → work[15]",
    'where the service should jump, from table[0]': 'dove deve saltare il servizio, contato da table[0]',
    'run by the service: a loop; B = offset from ret to work[14]': 'eseguita dal servizio: un ciclo; B = distanza da ret a work[14]',
    'what Red learned': 'quello che Red ha scoperto',
    'the bomb: a process that runs it dies': 'la bomba: il processo che la esegue muore',
    'how many cells to bomb': 'quante celle bombardare',
    "pointer into the service's code": 'puntatore nel codice del servizio',
    "pv <- a copy of pf (points at my FLAG) ...": 'pv ← copia di pf (punta al mio FLAG) ...',
    "... moved to point at the service's first instruction": '... spostato sulla prima istruzione del servizio',
    'drop a DAT on the cell pv points at, then move pv on': 'lascia un DAT dove punta pv, poi pv + 1',
    'until n cells are bombed': 'finché n celle sono bombardate',
    'the value written over and past work': 'il valore scritto su work e oltre',
    'pointer to the vault': 'puntatore alla cassaforte',
    'overwrite the vault': 'sovrascrive la cassaforte',
    'pv <- pointer to my FLAG ...': 'pv ← puntatore al mio FLAG ...',
    '... moved onto the vault': '... spostato sulla cassaforte',
    'the value Red wants there': 'il valore che Red vuole lì',
    'copy the vault into loot': 'copia la cassaforte in loot',
}


def it_service(comment: str) -> str:
    c = comment.replace(';@obj', '').strip()
    c = re.sub(r'^\w+\s+', '', c) if comment.startswith(';@obj') else c
    for pat, rep in SERVICE_IT:
        if re.search(pat, c):
            m = re.search(pat, c)
            return m.expand(rep) if '\\' in rep else rep
    return c


def it_program(comment: str) -> str:
    c = comment.strip()
    if c in PROGRAM_IT:
        return PROGRAM_IT[c]
    m = re.match(r'^(OP|ARG\d) <- (-?\d+)(.*)$', c)
    if m:
        return '%s ← %s%s' % (m.group(1), m.group(2), m.group(3))
    m = re.match(r'^ARG(\d) <- the whole cell `(\w+)`$', c)
    if m:
        return 'ARG%s ← la cella intera `%s`' % (m.group(1), m.group(2))
    return c


# ---------------------------------------------------------------------------
# Programs
# ---------------------------------------------------------------------------

def svc_labels(c=0):
    img = P.generate_service(6, -40, canaries=c, canary_values=[1] * 64)
    return img.program.labels


def exploit_src(name, c=0):
    lab = svc_labels(c)
    if name == 'bomb_code':
        return X.bomb_code(P.SLOT_SIZE + lab['m0'], 40)
    if name in ('direct_vault', 'direct_read'):
        return X.ALL[name](P.SLOT_SIZE + lab['vault'])
    if name == 'code_reuse':
        return X.code_reuse(lab['k0'] - lab['table'], c)
    return X.ALL[name](c)


def champion_red(r):
    with open(os.path.join(CHAMP, 'red_r%03d.red' % r)) as f:
        return f.read()


def champion_blue(r):
    with open(os.path.join(CHAMP, 'blue_r%03d.json' % r)) as f:
        return L.LawSet.from_json(json.load(f)['lawset'])


def lawset(lines, **params):
    p = {'place_bits': 0, 'shuffle_layout': False, 'canaries': 0}
    p.update(params)
    return L.lawset_from_text(lines, **p)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def cell_state(W, a, fields=STATE):
    return [getattr(W, f)[a] for f in fields]


def instr_text(k, a, b):
    i = E.unpack(k, a, b)
    return rc.format_instr(i)


def describe_programs(b):
    """Labels, comments and source lines of every loaded program, per absolute cell."""
    S = b.S
    W = b.W
    out = []
    for pid, p in enumerate(b.progs):
        if p['role'] == 'service':
            continue
        prog = p.get('program')
        if prog is None:
            continue
        base = p['base']
        inv = {}
        for lbl, off in prog.labels.items():
            inv.setdefault(off, []).append(lbl)
        lines = []
        for off in range(len(prog)):
            lines.append([off, ' '.join(sorted(inv.get(off, []))), it_program(prog.comments.get(off, ''))])
        entry = dict(pid=pid, name=p['name'], role=p['role'], base=base, len=len(prog), start=prog.start,
                     slot=p.get('slot'), dir=(base - 1) % S, lines=lines)
        if p.get('scratch'):
            entry['scratch'] = list(p['scratch'])
        out.append(entry)
    return out


def service_desc(b):
    """Labels and Italian comments of the current service image, by offset."""
    img = b.svc_image
    prog = img.program
    inv = {}
    for lbl, off in prog.labels.items():
        inv.setdefault(off, []).append(lbl)
    obj_of = {}
    for name, (o0, o1) in img.objects.items():
        for o in range(o0, o1):
            obj_of[o] = '%s[%d]' % (name, o - o0) if o1 - o0 > 1 else name
    for o in img.canary_offsets:
        obj_of[o] = 'canary'
    lines = []
    for off in range(len(prog)):
        lbl = ' '.join(sorted(l for l in inv.get(off, []) if l not in ('top',)))
        lines.append([off, lbl, obj_of.get(off, ''), it_service(prog.comments.get(off, ''))])
    return dict(base=b.svc_base, len=len(prog), code=list(img.code_range),
                objects={k: list(v) for k, v in img.objects.items()},
                canaries=list(img.canary_offsets), lines=lines, order=list(b.layout['order']),
                place_offset=b.layout['place_offset'])


def svc_scalars(b):
    W = b.W
    return dict(svc_base=b.svc_base, svc_entry=b.svc_entry, svc_code=list(b.svc_code),
                prog_addr=b.prog_addr, vault_addr=b.vault_addr, ret_addr=b.ret_addr,
                work_addr=b.work_addr, table_addr=b.table_addr, vault_orig=list(b.vault_orig),
                canary_addr=list(W.canary_addr),
                canary_vals=[list(x) for x in W.canary_vals], mb_tag=b.mb_tag,
                desc=service_desc(b))


def tag_roles(b):
    """For every cell of the window: which tag its memory tag and its instruction tag take."""
    img = b.svc_image
    prog = img.program
    cfirst, cend = img.code_range
    canset = set(img.canary_offsets)
    obj_of = {}
    for name, (o0, o1) in img.objects.items():
        for o in range(o0, o1):
            obj_of[o] = name
    off0 = (b.svc_base - b.win_base) % b.S
    roles = []
    for x in range(b.window_len):
        off = x - off0
        if off < 0 or off >= len(prog):
            roles.append(['free', 'free'])
        elif cfirst <= off < cend:
            mark = prog.obj_marks.get(off)
            roles.append(['code', mark if mark else 'code'])
        elif off in canset:
            roles.append(['canary', 'canary'])
        else:
            roles.append([obj_of[off], obj_of[off]])
    return roles


def window_state(b):
    W = b.W
    cells = []
    for x in range(b.window_len):
        a = (b.win_base + x) % b.S
        cells.append(cell_state(W, a))
    return cells


def reload_images(b0, n):
    """The service images n successive restarts load: a few templates (one per place and
    order) plus, per restart, the canary values and tags drawn at that load."""
    br = copy.deepcopy(b0)
    templates, keys, loads = [], {}, []
    for _ in range(n):
        br._load_service()
        key = (br.layout['place_offset'], tuple(br.layout['order']))
        if key not in keys:
            keys[key] = len(templates)
            sc = svc_scalars(br)
            templates.append(dict(window=window_state(br), roles=tag_roles(br),
                                  canary_offsets=list(br.svc_image.canary_offsets), **sc))
        cv = [br.W.an[a] for a in br.W.canary_addr]
        loads.append(dict(t=keys[key], cvals=cv, tags=dict(br.obj_tags), mb_tag=br.mb_tag))
    return templates, loads


def law_json(ls):
    return [l.to_json() for l in ls.laws] if ls is not None else []


def subset(ls, mask):
    """The law set with only the laws whose bit is set (same params)."""
    out = L.LawSet([L.Law.from_json(l.to_json()) for i, l in enumerate(ls.laws) if mask >> i & 1],
                   dict(ls.params))
    return out


def reference(b0, ls, mask):
    b = copy.deepcopy(b0)
    b.laws = subset(ls, mask) if ls is not None else None
    b.compiled = None
    res = b._loop()
    S = b.S
    W = b.W
    h = 2166136261
    for a in range(S):
        for v in (W.ins[a], W.an[a], W.bn[a]):
            h = ((h ^ (v & 0xffffffff)) * 16777619) & 0xffffffff
    dmg = {k: v for k, v in res.damage.items()}
    return dict(mask=mask, work=res.work, alive=res.alive, damage=dmg, restarts=res.restarts,
                served_red=res.served_red, instructions=res.instructions,
                events=res.events, alarms=sum(res.alarm_counts.values()), core_hash=h)


def export(sid, title, red_src=None, ls=None, seed=11, masks=None, n_reloads=None, cfg=None, note=''):
    cfg = cfg or C.default_config()
    red = rc.parse(red_src) if red_src else None
    specs = A.arena_programs(cfg, red)
    b = E._Battle(specs, ls, cfg, seed, trace=False, final_core=False, track_coverage=False,
                  track_red=True, laws_compiled=None)
    b._load_arena()
    b0 = copy.deepcopy(b)
    W = b.W
    S = b.S
    # sparse core
    cells = []
    for a in range(S):
        st = cell_state(W, a)
        d = [st[i] != DEFAULT[f] for i, f in enumerate(STATE) if f in DEFAULT]
        if any(d) or W.mtag[a] != b.free_tag or W.itag[a] != b.free_tag:
            cells.append([a] + st)
    # reload images
    deterministic = (b.place_bits == 0 and not b.shuffle and b.n_canaries == 0 and b.tag_bits == 0
                     and not b.secret_on)
    want = 1 if deterministic else (n_reloads or 40)
    templates, loads = reload_images(b0, want)
    # reference runs
    nl = len(ls.laws) if ls is not None else 0
    if masks is None:
        masks = sorted({0, (1 << nl) - 1} | {1 << i for i in range(nl)})
    refs = [reference(b0, ls, m) for m in masks]
    names = [p['name'] for p in b.progs]
    data = dict(
        id=sid, title=title, note=note, seed=seed,
        S=S, cycles=b.cycles, maxp=b.maxp, names=names, roles=[p['role'] for p in b.progs],
        red=W.red, svc=W.svc, order=list(b.order),
        queues=[[pc for pc, _ in q] for q in W.queues],
        mb_base=b.mb_base, mb_len=b.mb_len, n_slots=b.n_slots,
        slot_of={str(k): v for k, v in b.slot_of.items()},
        win_base=b.win_base, window_len=b.window_len,
        free_tag=b.free_tag, ptag=list(b.ptag), tag_bits=b.tag_bits,
        params=dict(place_bits=b.place_bits, shuffle_layout=b.shuffle, canaries=b.n_canaries),
        fill_max=b.fill_max,
        cost=dict(check_cycles=float(cfg['cost']['check_cycles']),
                  restart_downtime=int(cfg['cost']['restart_downtime'])),
        stall_window=int(cfg['scoring']['stall_window']),
        weights=cfg['scoring']['weights'],
        events_on=cfg['events'],
        fields=list(STATE), cells=cells,
        svc0=svc_scalars(b),
        templates=templates, loads=loads, reloads_deterministic=deterministic,
        programs=describe_programs(b),
        laws=law_json(ls), laws_text=[L.format_law(l) for l in ls.laws] if ls is not None else [],
        red_source=red_src or '',
        refs=refs,
    )
    # a script, not a .json file, so that the pages also work opened from disk (file://)
    path = os.path.join(OUT, sid + '.js')
    with open(path, 'w') as f:
        f.write('(window.RCDATA = window.RCDATA || {})[%s] = ' % json.dumps(sid))
        json.dump(data, f, separators=(',', ':'))
        f.write(';\n')
    r = refs[-1]
    print('%-22s %6.1f KB  restarts=%-3d served=%-5d dmg=%s' % (
        sid, os.path.getsize(path) / 1024, len(r['restarts']), r['work']['service'],
        {k: round(v, 3) for k, v in r['damage'].items() if k in ('downtime', 'injection', 'injection_lw',
                                                                 'deviation', 'vault')}))


def main():
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])

    def go(sid, *a, **k):
        if not only or sid in only:
            export(sid, *a, **k)

    # costs: no Red, laws that break the tenants
    go('quiete', 'Il servizio e gli inquilini, senza Red', None,
       lawset(['ON write IF target_in(service_code) THEN block',
               'ON write THEN allow, set_flag(0)', 'ON exec IF flag(0) THEN kill',
               'ON write IF distance_gt(300) THEN block',
               'ON spawn IF rate_gt(spawn, 4, 100) THEN block',
               'ON write IF NOT owner_eq THEN kill']),
       masks=[0, 1, 6, 8, 16, 32])
    go('bomba', 'R0.1: bombardare il codice del servizio', exploit_src('bomb_code'),
       lawset(['ON write IF target_in(service_code) THEN block',
               'ON tick(100) IF service_stalled(500) THEN restart_service']))
    go('vault-diretto', 'R0.2: scrivere la cassaforte direttamente', exploit_src('direct_vault'),
       lawset(['ON write IF NOT actor_is_service AND target_in(service_data) THEN block']))
    go('vault-store', 'R0.3: STORE(17): il servizio scrive la cassaforte per Red', exploit_src('vault_store'),
       lawset(['ON write IF NOT actor_is_service AND target_in(service_data) THEN block',
               'ON write IF target_in(service_code) THEN block']))
    go('vault-store-tag', 'B5.1: i tag fermano il vice confuso', exploit_src('vault_store'),
       lawset(['ON write IF NOT tag_eq(4) AND target_in(service_data) THEN block',
               'ON write IF NOT actor_is_service AND target_in(service_data) THEN block']),
       masks=[0, 1, 2, 3])
    go('crash', 'R2.3: CALL(4) manda il servizio su un DAT', exploit_src('crash_call'),
       lawset(['ON tick(100) IF service_stalled(500) THEN restart_service',
               'ON jump IF NOT is_entry AND actor_is_service THEN block']))
    go('smash', 'R2.2: stack smash con FILL', exploit_src('stack_smash'),
       lawset(['ON jump IF NOT is_entry AND actor_is_service THEN block',
               'ON tick(100) IF service_stalled(500) THEN restart_service']))
    go('smash-canary', 'B3.3: canary contro lo stack smash', exploit_src('stack_smash', 1),
       lawset(['ON tick(200) IF NOT canaries_intact THEN restart_service, alarm'], canaries=1),
       n_reloads=60)
    go('injection', "R2.4: iniezione: il servizio esegue un'istruzione di Red", exploit_src('injection'),
       lawset(['ON jump IF NOT is_entry AND actor_is_service THEN block',
               'ON exec IF actor_is_service AND NOT target_in(service_code) THEN kill',
               'ON tick(100) IF service_stalled(500) THEN restart_service']),
       masks=[0, 1, 2, 6, 7])
    go('reuse', 'R2.5: code reuse: il servizio salta nel proprio codice', exploit_src('code_reuse'),
       lawset(['ON jump IF NOT is_entry AND actor_is_service THEN block']))
    # the pilot
    b1 = champion_blue(1)
    go('p-r01', 'Pilot, round 1: il replicatore contro la trappola di lettura', champion_red(1), b1,
       n_reloads=40)
    b7 = champion_blue(7)
    go('p-r02', 'Pilot, round 2: il bombardiere contro il riavvio del round 7', champion_red(2), b7,
       n_reloads=16)
    go('p-r28', 'Pilot, round 28: lo scrittore silenzioso', champion_red(28),
       lawset(['ON tick(500) IF service_stalled(100) THEN restart_service']))
    b27 = champion_blue(27)
    go('p-r26', 'Pilot, round 26 contro il Blue del round 27: il blocco dei salti', champion_red(26), b27,
       n_reloads=80, masks=[0, 128, 255])
    go('p-r27', 'Pilot, round 27 contro il Blue del round 27: Red scappa', champion_red(27), b27,
       n_reloads=80, masks=[0, 128, 255])
    b42 = champion_blue(42)
    extra = lawset([L.format_law(l) for l in b42.laws] +
                   ['ON jump IF rate_gt(write, 64, 50) THEN restart_service',
                    'ON read IF is_entry AND NOT actor_is_service THEN kill'],
                   **b42.params)
    extra.laws = extra.laws[:10]
    go('p-r42', 'Pilot, round 42: un attacco vero torna', champion_red(42), extra,
       n_reloads=80, masks=[0, 255, 255 | 256, 255 | 512])


if __name__ == '__main__':
    main()
