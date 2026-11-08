"""Stamp the game's own scripts and stylesheet in index.html with a new version (?v=...).

GitHub Pages lets browsers keep a file for 10 minutes (phones sometimes longer), so after an update a player could get
the new page with old scripts. A new ?v= on every link makes a reload fetch the files that changed; sw.js (the offline
copy) gets the same version. Run before every push:  python tools/bump.py
"""
import re, time, pathlib

page = pathlib.Path(__file__).resolve().parent.parent / 'index.html'
html = page.read_text(encoding='utf-8')
stamp = time.strftime('%Y%m%d%H%M')
new, n = re.subn(r'(src|href)="((?:js|css)/[\w.-]+\.(?:js|css))(?:\?v=\w+)?"', lambda m: f'{m.group(1)}="{m.group(2)}?v={stamp}"', html)
page.write_text(new, encoding='utf-8')
sw = page.parent / 'sw.js'
if sw.exists():
    sw.write_text(re.sub(r"const VERSION = '\w+';", f"const VERSION = '{stamp}';", sw.read_text(encoding='utf-8'), count=1), encoding='utf-8')
print(f'{n} links stamped v={stamp}')
