#!/usr/bin/env python3
"""Check that the module task lists cover the specs and the SRS.

    python3 scripts/specs/check_tasks.py            # report, exit 1 on any gap
    python3 scripts/specs/check_tasks.py --verbose  # also list what each module covers

Checks, per module under specs/ (frontend excluded from 1 and 2, it has no api-design):
  1. every requirement ID of requirements.md (REQ-*, AC-*) appears in tasks.md;
  2. every api-design endpoint number is named in tasks.md ("api-design 01", "01 to 17");
  3. every task line carries an owner, written "(owner NAME)".
Across modules:
  4. every SRS FR (capstone/scripts/srs/srs_data.py) is covered: named in a tasks.md, or cited
     by a requirement whose ID that module's tasks.md names;
  5. every backlog story US-UCnn is named in some tasks.md.

Set TREKLINK_SRS when srs_data.py is not at ../scripts/srs relative to the capstone root.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPECS = ROOT / "specs"
SRS = Path(os.environ.get("TREKLINK_SRS", ROOT.parent / "scripts" / "srs"))
sys.path.insert(0, str(SRS))
try:
    import srs_data  # noqa: E402
except ImportError:
    sys.exit(f"!! srs_data.py not found in {SRS}; set TREKLINK_SRS")

REQ_RE = re.compile(r"\*\*((?:REQ-[A-Z]+-\d+)|(?:AC-\d+))\*\*")
FR_RE = re.compile(r"FR-[A-Z]+-\d+")
TASK_RE = re.compile(r"^- \[[ x]\] (\d+\.\d+) (.*)$")


def expand(ids_text: str, prefix: str) -> set[str]:
    """Expand 'REQ-EVT-03 to REQ-EVT-05' and plain lists into IDs."""
    out = set(re.findall(prefix + r"\d+", ids_text))
    for a, b in re.findall(rf"({prefix}\d+) to ({prefix}\d+)", ids_text):
        lo, hi = int(a[len(prefix):]), int(b[len(prefix):])
        width = len(a) - len(prefix)
        out |= {f"{prefix}{n:0{width}d}" for n in range(lo, hi + 1)}
    return out


def ids_in(text: str) -> set[str]:
    found: set[str] = set()
    for kind in ("UBI", "EVT", "STA", "ERR", "OPT"):
        found |= expand(text, f"REQ-{kind}-")
    found |= expand(text, "AC-")
    return found


def endpoint_numbers(text: str) -> set[int]:
    nums: set[int] = set()
    for m in re.finditer(r"api-design ((?:\d{2}(?:, | and | to |, and )?)+)", text):
        part = m.group(1)
        for a, b in re.findall(r"(\d{2}) to (\d{2})", part):
            nums |= set(range(int(a), int(b) + 1))
        nums |= {int(n) for n in re.findall(r"\d{2}", part)}
    return nums


def main() -> int:
    verbose = "--verbose" in sys.argv
    gaps: list[str] = []
    fr_covered: set[str] = set()
    stories: set[str] = set()
    for mod in sorted(p for p in SPECS.iterdir() if p.is_dir()):
        req_path, tasks_path = mod / "requirements.md", mod / "tasks.md"
        if not tasks_path.exists():
            gaps.append(f"{mod.name}: no tasks.md")
            continue
        tasks = tasks_path.read_text(encoding="utf-8")
        stories |= set(re.findall(r"US-UC\d{2}", tasks))
        fr_covered |= set(FR_RE.findall(tasks))
        named = ids_in(tasks)
        if req_path.exists():
            reqs = req_path.read_text(encoding="utf-8")
            req_ids = set(REQ_RE.findall(reqs))
            if mod.name != "frontend":
                for missing in sorted(req_ids - named):
                    gaps.append(f"{mod.name}: {missing} not in tasks.md")
            for line in reqs.splitlines():
                m = REQ_RE.search(line)
                if m and m.group(1) in named:
                    fr_covered |= set(FR_RE.findall(line))
        api = mod / "api-design"
        if api.is_dir() and mod.name != "frontend":
            files = sorted(f for f in api.glob("[0-9][0-9]-*.md") if not f.name.startswith("00-"))
            have = endpoint_numbers(tasks)
            for f in files:
                if int(f.name[:2]) not in have:
                    gaps.append(f"{mod.name}: api-design {f.name} not named in tasks.md")
        for line in tasks.splitlines():
            m = TASK_RE.match(line)
            if m and "(owner " not in m.group(2):
                gaps.append(f"{mod.name}: task {m.group(1)} has no owner")
        if verbose:
            print(f"{mod.name}: {len(named)} requirement IDs named")
    for fr in srs_data.FR:
        if fr[0] not in fr_covered:
            gaps.append(f"SRS: {fr[0]} not covered by any tasks.md")
    for uc in srs_data.UC:
        if f"US-UC{uc:02d}" not in stories:
            gaps.append(f"backlog: US-UC{uc:02d} not named in any tasks.md")
    for g in gaps:
        print(g)
    print(f"{len(gaps)} gap(s)")
    return 1 if gaps else 0


if __name__ == "__main__":
    raise SystemExit(main())
