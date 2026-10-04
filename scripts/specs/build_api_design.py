#!/usr/bin/env python3
"""Render specs/<module>/api-design/*.md from the endpoint catalog in scripts/specs/endpoints/.

    python3 scripts/specs/build_api_design.py            # every module
    python3 scripts/specs/build_api_design.py devices    # one module

Each endpoint file follows treklink-docs/_docs/02-templates/04-api-endpoint-template.md with
Mermaid diagrams (D-017) and the D-002 envelope; a failure carries `result = { errorCode }`
(specs/platform/requirements.md REQ-UBI-04). The files are generated: edit the catalog, never the
output. Common branches are added for you: 400 VALIDATION_FAILED when the endpoint takes a body or
query, 401 and 403 unless it is public, 404 when the route has an `:id`-style parameter.
"""
import importlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPECS = ROOT / "specs"
sys.path.insert(0, str(Path(__file__).resolve().parent))

COMMON = {
    400: ("VALIDATION_FAILED", "The body or query fails validation", "{field} is required."),
    401: ("UNAUTHENTICATED", "Missing, malformed or expired access token or API key", "Authentication required."),
    403: ("FORBIDDEN", "The caller's role, policy or organization does not allow this action", "You do not have access to this."),
    404: ("NOT_FOUND", "No such record, or it belongs to another organization", "{entity} not found."),
}


def envelope(result, ok=True, status=200, message=""):
    return json.dumps({"result": result, "isSuccess": ok, "statusCode": status, "message": message},
                      indent=2, ensure_ascii=False)


def table(rows, head):
    out = ["| " + " | ".join(head) + " |", "| " + " | ".join("---" for _ in head) + " |"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def errors_for(ep):
    errs = []
    if ep.get("body") or ep.get("query"):
        errs.append((400,) + COMMON[400])
    if ep.get("permission", "").lower() not in ("public", "n/a"):
        errs.append((401,) + COMMON[401])
        errs.append((403,) + COMMON[403])
    if re.search(r"/:\w+", ep["url"]) and not ep.get("no404"):
        code, desc, msg = COMMON[404]
        errs.append((404, code, desc, msg.replace("{entity}", ep.get("entity", "Record"))))
    for e in ep.get("errors", []):
        errs.append(e)
    return errs


def activity(ep, errs):
    """Guards in order (each a yes-branch to its error), then the happy-path steps."""
    public = ep.get("permission", "").lower() in ("public", "n/a")
    lines = ["flowchart TB", "    S((Start))",
             f'    A0["{"Accept request" if public else "Check token, policy and organization scope"}"]', "    S --> A0"]
    prev, edge = "A0", ""
    n = 0
    for status, code, desc, _ in errs:
        if status in (401, 403):
            continue
        n += 1
        label = desc.replace('"', "'")
        lines += [f'    D{n}{{"{label}?"}}', f"    {prev} -->{edge} D{n}",
                  f'    E{n}["Return {status} {code}"]', f"    D{n} -->|yes| E{n}", f"    E{n} --> X{n}((End))"]
        prev, edge = f"D{n}", "|no|"
    for i, step in enumerate(ep.get("steps", [])):
        label = step.replace('"', "'")
        lines += [f'    P{i}["{label}"]', f"    {prev} -->{edge} P{i}"]
        prev, edge = f"P{i}", ""
    lines += [f'    OK["Return {ep.get("status", 200)}"]', f"    {prev} -->{edge} OK", "    OK --> Z((End))"]
    return "\n".join(lines)


def sequence(ep):
    actor = ep.get("actor", "Client")
    ctrl = ep.get("controller", "Controller")
    svc = ep.get("service", "Service")
    lines = ["sequenceDiagram", "    autonumber", f"    actor C as {actor}",
             f"    participant Ctl as {ctrl}", f"    participant Svc as {svc}", "    participant DB as Postgres"]
    extra = ep.get("participants", [])
    for p in extra:
        lines.append(f"    participant {p[0]} as {p[1]}")
    lines.append(f"    C->>Ctl: {ep['method']} {ep['url']}")
    lines.append(f"    Ctl->>Svc: {ep.get('call', 'handle(dto, caller)')}")
    for s in ep.get("seq", []):
        lines.append("    " + s.replace(";", ","))  # ";" ends a Mermaid statement
    lines.append("    Svc-->>Ctl: result")
    lines.append(f"    Ctl-->>C: {ep.get('status', 200)} envelope")
    return "\n".join(lines)


def render(module, ep):
    errs = errors_for(ep)
    op = f" op {ep['op']}" if ep.get("op") else ""
    out = [f"# {ep['method']} {ep['url']}{op}: {ep['title']}", "",
           f"> Module `{module}`. Generated from `scripts/specs/endpoints/{module.replace('-', '_')}.py` by "
           "`scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: "
           "`02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.", "",
           "[TOC]", "", "---", "## Overview", "", ep["overview"], "", "## API Specification", "",
           table([[ep["method"], ep["url"]], ["Permission", ep["permission"]]]
                 + ([["Operation", f'`op: "{ep["op"]}"` (D-027)']] if ep.get("op") else [])
                 + [["Traces", ep.get("traces", "")]]
                 + ([["Notes", ep["notes"]]] if ep.get("notes") else []), ["API", "URL"])]
    if ep.get("path"):
        out += ["", "### Path parameters", "", table(ep["path"], ["Field", "Description", "Data Type", "Examples"])]
    if ep.get("query"):
        out += ["", "### Query parameters", "", table(ep["query"], ["Field", "Description", "Data Type", "Required", "Examples"])]
    if ep.get("body"):
        out += ["", "## Request sample", "", "```json", json.dumps(ep["sample"], indent=2, ensure_ascii=False), "```", "",
                table(ep["body"], ["Field", "Description", "Data Type", "Required", "Examples"])]
    else:
        out += ["", "## Request sample", "", "No body."]
    out += ["", "## Response sample", "", "```json",
            envelope(ep.get("response"), True, ep.get("status", 200), ep.get("message", "OK")), "```"]
    if ep.get("fields"):
        out += ["", table(ep["fields"], ["Field", "Description", "Data Type", "Examples"])]
    out += ["", "## Validation", "", "<table>", "    <th>Status code</th>", "    <th>Description</th>",
            "    <th>Examples</th>", "    <tbody>"]
    for status, code, desc, msg in errs:
        out += ["        <tr>", f"            <td>{status}</td>", f"            <td>{desc} (<code>{code}</code>)</td>",
                "<td>", "", "```json", envelope({"errorCode": code}, False, status, msg), "```", "</td>", "        </tr>"]
    out += ["    </tbody>", "</table>", "", "## Activity Diagram", "", "```mermaid", activity(ep, errs), "```", "",
            "## Sequence Diagram", "", "```mermaid", sequence(ep), "```", ""]
    return "\n".join(out)


def build(module):
    cat = importlib.import_module("endpoints." + module.replace("-", "_"))
    target = SPECS / module / "api-design"
    target.mkdir(parents=True, exist_ok=True)
    for old in target.glob("[0-9][0-9]-*.md"):
        if old.name != "00-api-testing-guide.md":
            old.unlink()
    rows = []
    for i, ep in enumerate(cat.ENDPOINTS, 1):
        stem = slug(ep['url'].replace('/api/', '').replace(':', ''))
        if ep.get("op"):
            stem += "-op-" + slug(re.sub(r"(?<!^)([A-Z])", r"-\1", ep["op"]))
        name = f"{i:02d}-{ep['method'].lower()}-{stem}.md"
        (target / name).write_text(render(module, ep))
        route = f"`{ep['url']}`" + (f" op `{ep['op']}`" if ep.get("op") else "")
        rows.append([f"{i:02d}", ep["method"], route, ep["permission"], f"[{name}]({name})"])
    index = [f"# API Design Index: {module}", "",
             f"> Generated from `scripts/specs/endpoints/{module.replace('-', '_')}.py`. Contract: D-002 envelope; "
             "on failure `result = { errorCode }` (`specs/platform/requirements.md` REQ-UBI-04). "
             "Organization members and API keys only ever see their own organization's records (FR-AUTH-11).", "",
             table(rows, ["#", "Method", "Route", "Permission", "Spec File"]), ""]
    if getattr(cat, "NOTES", None):
        index += [cat.NOTES, ""]
    for extra in sorted(target.glob("[a-z]*.md")):
        if extra.name != "README.md":
            index.append(f"- Hand-written contract: [{extra.name}]({extra.name})")
    index += ["", "Manual testing: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).", ""]
    (target / "README.md").write_text("\n".join(index))
    print(f"{module}: {len(cat.ENDPOINTS)} endpoints")


def main():
    mods = sys.argv[1:] or sorted(p.stem.replace("_", "-") for p in (Path(__file__).parent / "endpoints").glob("*.py")
                                  if not p.stem.startswith("_"))
    for m in mods:
        build(m)


if __name__ == "__main__":
    main()
