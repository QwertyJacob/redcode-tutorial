"""Write the Python parser's output for many Redcode sources, for tools/check_parser.mjs."""
import glob, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
LW = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'landlord_war')
sys.path.insert(0, LW)
from landlord_war import programs as P, redcode as rc, exploits as X
out = []
defs = rc.default_environment()
defs['SCRATCH'] = 2500
for n, s in P.TENANT_SOURCES.items():
    out.append((n, s, defs))
for n in ['vault_store', 'injection', 'crash_call', 'linear_fill', 'stack_smash', 'leak_read']:
    out.append((n, X.ALL[n](0), {}))
out.append(('bomb', X.bomb_code(6, 40), {}))
out.append(('reuse', X.code_reuse(-216), {}))
out.append(('service', P.generate_service(6, -40).source, {}))
for f in sorted(glob.glob(os.path.join(LW, 'docs/m8_pilot/champions/red_*.red'))):
    out.append((os.path.basename(f), open(f).read(), {}))
for f in sorted(glob.glob(os.path.join(LW, 'warriors/*/*.red'))):
    out.append((os.path.basename(f), open(f, encoding='latin1').read(), defs))
res = []
for name, src, d in out:
    try:
        p = rc.parse(src, d)
        res.append(dict(name=name, src=src, defs=d, ins=[list(i) for i in p.instructions], start=p.start))
    except Exception as e:
        res.append(dict(name=name, src=src, defs=d, error=str(e)))
json.dump(res, open(sys.argv[1], 'w'))
print(len(res), 'sources')
