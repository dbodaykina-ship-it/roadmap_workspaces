#!/usr/bin/env python3
"""Собирает index.html — прототип «с каскадом — 4 колонки» — из файла канваса.

source/Main.dc.html  →  index.html

Запуск: python3 build.py
Шаблон и логика артборда переносятся без изменений, их исполняет
assets/dc-lite.js поверх React 18.
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BOARD = ROOT / "source" / "Main.dc.html"

# картинки, загруженные в канвас (/_blob/<id>) → файлы в репозитории
BLOBS = {"/_blob/05f8c3a32d636b781e992896846c0598": "assets/avatar.jpg"}


def between(s: str, a: str, b: str) -> str:
    i = s.index(a) + len(a)
    return s[i:s.index(b, i)]


def js_string(s: str) -> str:
    return json.dumps(s, ensure_ascii=False).replace("</", "<\\/").replace("<!--", "<\\!--")


def main():
    s = BOARD.read_text(encoding="utf-8")
    for k, v in BLOBS.items():
        s = s.replace(k, v)
    lang = (re.search(r'<html[^>]*\blang="([^"]+)"', s) or [None, "ru"])[1]
    title = between(s, "<title>", "</title>").strip()
    xdc = between(s, "<x-dc>", "</x-dc>")
    helmet = ""
    m = re.search(r"<helmet>([\s\S]*?)</helmet>", xdc)
    if m:
        helmet = m.group(1).strip()
        xdc = xdc[: m.start()] + xdc[m.end():]
    m = re.search(r'<script type="text/x-dc" data-dc-script[^>]*>([\s\S]*?)</script>', s)
    logic = m.group(1) if m else ""
    w = json.loads(html.unescape(re.search(r"data-props='([^']*)'", s).group(1)))["$preview"]["width"]

    out = f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width={w}">
<meta name="robots" content="noindex, nofollow">
<title>{title}</title>
{helmet}
<style>#dc-root{{width:max-content;margin:0 auto}}#dc-root>.sc-host{{position:relative}}</style>
</head>
<body>
<div id="dc-root"></div>
<script src="assets/react.production.min.js"></script>
<script src="assets/react-dom.production.min.js"></script>
<script src="assets/dc-lite.js"></script>
<script type="text/x-dc-logic" id="dc-logic">{logic}</script>
<script>
DCLite.mount(document.getElementById('dc-root'), {{
  name: 'Main',
  template: {js_string(xdc.strip())},
  logic: document.getElementById('dc-logic').textContent
}});
</script>
</body>
</html>
"""
    (ROOT / "index.html").write_text(out, encoding="utf-8")
    print("✓ index.html")


if __name__ == "__main__":
    main()
