#!/usr/bin/env python3
"""Scaffold one screen-design file per page task of specs/frontend/tasks.md (D-052, D-053).

Reads the page tasks of Phases 2 to 9, writes specs/frontend/ui-design/<task>-<slug>.md from the
template in ui-design/README.md, and rewrites the assignment table in the README between its
markers. An existing screen file is never overwritten, so the script is safe to re-run after
members have started.

Usage:
    python3 scripts/specs/scaffold_ui_design.py [--deadline 2026-10-23] [--assigned 2026-10-21]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TASKS = ROOT / "specs/frontend/tasks.md"
OUT = ROOT / "specs/frontend/ui-design"
README = OUT / "README.md"
PAGE_PHASES = range(2, 10)
START, END = "<!-- assignments:start -->", "<!-- assignments:end -->"

TASK_RE = re.compile(r"^- \[[ x]\] (\d+)\.(\d+) (.+?) \(owner (\w+)\)\s*$")


def slug(name: str) -> str:
    s = re.sub(r"`", "", name).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return "-".join(s.split("-")[:6])


def parse_tasks() -> list[dict]:
    tasks, cur = [], None
    for line in TASKS.read_text().splitlines():
        m = TASK_RE.match(line)
        if m:
            phase, num, name, owner = int(m.group(1)), int(m.group(2)), m.group(3), m.group(4)
            cur = {"id": f"{phase}.{num}", "phase": phase, "name": name, "owner": owner,
                   "do": "", "stories": "", "reqs": ""} if phase in PAGE_PHASES else None
            if cur:
                tasks.append(cur)
            continue
        if not cur:
            continue
        stripped = line.strip()
        if stripped.startswith("- **Do**:"):
            cur["do"] = stripped[len("- **Do**:"):].strip()
        elif stripped.startswith("- _Story:"):
            cur["stories"] = stripped[len("- _Story:"):].strip(" _")
        elif stripped.startswith("- _Requirements:"):
            cur["reqs"] = stripped[len("- _Requirements:"):].strip(" _")
        elif stripped.startswith("## "):
            cur = None
    return tasks


def screen_file(t: dict, assigned: str, deadline: str) -> str:
    stem = f"{t['id'].replace('.', '-')}-{slug(t['name'])}"
    return f"""# {t['name']}

| | |
|---|---|
| Owner | {t['owner']} |
| Task | `specs/frontend/tasks.md` {t['id']} |
| Assigned, due | {assigned}, {deadline} |
| Status | Not started |
| Routes | <from `specs/frontend/design.md` §2> |
| Roles | <roles; what each sees> |
| Use case, FRs, story | <UC-nn>; <FR-...>; {t['stories'] or '<US-UCnn>'} |
| Requirements | {t['reqs'] or '<REQ-... from the module requirements.md>'} |
| Wireframe | ![{t['name'].replace('`', '')}]({stem}.png) |

Scope from the task: {t['do'] or '<see tasks.md>'}

## Data

| Shown | Source (api-design file, property) |
|---|---|
| | |

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| | | | |

## States

| State | What the user sees |
|---|---|
| Loading | |
| Empty | |
| Error `<CODE>` | MSGnn |
| Not found or forbidden | MSG26 |

## Form fields (if any)

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| | | | | |

## Mobile, accessibility, live data

- 360 px layout:
- Tab order and focus after each action:
- WebSocket events and invalidated query keys:

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.
""", f"{stem}.md"


def main(argv: list[str]) -> int:
    opts = dict(zip(argv[::2], argv[1::2]))
    assigned = opts.get("--assigned", "2026-10-21")
    deadline = opts.get("--deadline", "2026-10-23")
    tasks = parse_tasks()
    rows, created = [], 0
    for t in tasks:
        text, name = screen_file(t, assigned, deadline)
        path = OUT / name
        if not path.exists():
            path.write_text(text)
            created += 1
        rows.append(f"| {t['id']} | [{t['name']}]({name}) | {t['owner']} | {t['stories'] or ''} | {deadline} |")

    counts: dict[str, int] = {}
    for t in tasks:
        counts[t["owner"]] = counts.get(t["owner"], 0) + 1
    table = "\n".join([
        START,
        f"Assigned {assigned}, due {deadline}. Owners follow `specs/frontend/tasks.md` (D-053); "
        "the leader may reassign in this table. Per owner: "
        + ", ".join(f"{o} {n}" for o, n in sorted(counts.items())) + ".",
        "",
        "| Task | Screen file | Owner | Stories | Due |",
        "|---|---|---|---|---|",
        *rows,
        END,
    ])
    readme = README.read_text()
    if START in readme:
        readme = re.sub(re.escape(START) + ".*?" + re.escape(END), lambda _: table, readme, flags=re.S)
    else:
        readme = readme.replace("## Template", table + "\n\n## Template", 1)
    README.write_text(readme)
    print(f"{len(tasks)} page tasks, {created} screen files created, README table rewritten")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
