"""Wrap every page body in src/ into the site template and write it to the site root.

Each file in src/ starts with one comment line:  <!-- title: ... | description: ... -->
Run:  python3 tools/build_pages.py
"""
import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TEMPLATE = """<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3' fill='%23dc2b2b'/><rect x='3' y='3' width='4' height='4' fill='%23fff'/><rect x='9' y='9' width='4' height='4' fill='%23fff'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/style.css">
<script src="assets/js/engine.js"></script>
<script src="assets/js/ui-core.js"></script>
<script src="assets/js/msim.js"></script>
<script src="assets/js/arena.js"></script>
<script src="assets/js/lawlab.js"></script>
</head>
<body>
<div class="topbar" id="topbar"></div>
<div class="site">
<aside class="side" id="side"></aside>
<main>
{body}
<div class="col"><nav class="chapnav" id="chapnav"></nav>
<p style="font-size:13px;color:var(--ink3);margin-top:30px">Tutorial per il progetto <code>cyber_kickoff</code> (LIUC). Il simulatore di queste pagine è il motore di Landlord War tradotto in JavaScript: dà gli stessi risultati, cella per cella.</p></div>
</main>
</div>
</body>
</html>
"""


def main():
    for path in sorted(glob.glob(os.path.join(ROOT, 'src', '*.html'))):
        with open(path, encoding='utf-8') as f:
            text = f.read()
        m = re.match(r'<!--\s*title:\s*(.*?)\s*\|\s*description:\s*(.*?)\s*-->\n', text)
        if not m:
            raise SystemExit('missing title line in ' + path)
        body = text[m.end():]
        out = TEMPLATE.format(title=m.group(1), desc=m.group(2).replace('"', '&quot;'), body=body)
        name = os.path.basename(path)
        with open(os.path.join(ROOT, name), 'w', encoding='utf-8') as f:
            f.write(out)
        print('wrote', name)


if __name__ == '__main__':
    main()
