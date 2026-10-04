#!/usr/bin/env python3
"""Render every ```mermaid block under specs/ with mermaid-cli and report the ones that fail.

    MMDC=/path/to/mmdc CHROME=/path/to/chrome python3 scripts/specs/check_mermaid.py [path ...]

MMDC defaults to ../scripts/srs/node_modules/.bin/mmdc in the capstone workspace (Mermaid pinned at
12.0.0, D-017). Exit status 1 when any block fails to parse.
"""
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MMDC = os.environ.get("MMDC", str(ROOT.parent / "scripts/srs/node_modules/.bin/mmdc"))
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
BLOCK = re.compile(r"```mermaid\n(.*?)```", re.S)


def main():
    targets = [Path(p) for p in sys.argv[1:]] or [ROOT / "specs"]
    files = [f for t in targets for f in (t.rglob("*.md") if t.is_dir() else [t])]
    failures, count = [], 0
    with tempfile.TemporaryDirectory() as tmp:
        cfg = Path(tmp) / "p.json"
        cfg.write_text('{"executablePath": "%s", "args": ["--no-sandbox"]}' % CHROME)
        for f in sorted(files):
            for i, m in enumerate(BLOCK.finditer(f.read_text())):
                count += 1
                src = Path(tmp) / "d.mmd"
                src.write_text(m.group(1))
                r = subprocess.run([MMDC, "-q", "-p", str(cfg), "-i", str(src), "-o", str(Path(tmp) / "d.svg")],
                                   capture_output=True, text=True)
                if r.returncode != 0:
                    failures.append((f.relative_to(ROOT), i + 1, (r.stderr or r.stdout).strip().splitlines()[:3]))
    for f, i, err in failures:
        print(f"FAIL {f} block {i}: {' | '.join(err)}")
    print(f"{count} blocks, {len(failures)} failed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
