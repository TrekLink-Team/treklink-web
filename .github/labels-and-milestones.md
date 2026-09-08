# GitHub Labels & Milestones — Setup

Run once against `treklink-web` after creation (the single active app repo — see Decision D-004). Requires [GitHub CLI](https://cli.github.com/) authenticated (`gh auth login`) with write access to `TrekLink-Team`.

## 1. Label taxonomy

### Effort points (mirrors `Git_Lab_Guide.pdf` §2.1's 1/2/3/5/8/13 scale)
| Label | Color |
|---|---|
| `points: 1` | `6699cc` |
| `points: 2` | `99cc66` |
| `points: 3` | `ffcc66` |
| `points: 5` | `ff9966` |
| `points: 8` | `ff6666` |
| `points: 13` | `cc3366` |

### Type
| Label | Color |
|---|---|
| `type:epic` | `5319e7` |
| `type:story` | `0e8a16` |
| `type:task` | `1d76db` |
| `type:bug` | `d73a4a` |
| `type:spec` | `fbca04` |
| `type:chore` | `c5def5` |

### Module
| Label | Color |
|---|---|
| `module:auth` | `bfd4f2` |
| `module:devices` | `bfd4f2` |
| `module:rentals` | `bfd4f2` |
| `module:trips` | `bfd4f2` |
| `module:gateway-sync` | `d4c5f9` |
| `module:incidents` | `f9c5c5` |
| `module:monitoring` | `f9c5c5` |
| `module:billing` | `c5f9d4` |
| `module:frontend` | `fef2c0` |
| `module:devops` | `e0e0e0` |
| `module:docs` | `e0e0e0` |

### Review tracking
| Label | Color |
|---|---|
| `review-1` | `b60205` |
| `review-2` | `b60205` |
| `review-3` | `b60205` |

## 2. Bulk-create script

```bash
#!/usr/bin/env bash
# Run from inside the target repo (gh infers owner/repo from the current git remote),
# or pass --repo TrekLink-Team/{repo-name} to every call.

REPO_FLAG=""   # set to "--repo TrekLink-Team/treklink-web" if not run inside the repo

declare -A LABELS=(
  ["points: 1"]="6699cc" ["points: 2"]="99cc66" ["points: 3"]="ffcc66"
  ["points: 5"]="ff9966" ["points: 8"]="ff6666" ["points: 13"]="cc3366"
  ["type:epic"]="5319e7" ["type:story"]="0e8a16" ["type:task"]="1d76db"
  ["type:bug"]="d73a4a" ["type:spec"]="fbca04" ["type:chore"]="c5def5"
  ["module:auth"]="bfd4f2" ["module:devices"]="bfd4f2" ["module:rentals"]="bfd4f2"
  ["module:trips"]="bfd4f2" ["module:gateway-sync"]="d4c5f9" ["module:incidents"]="f9c5c5"
  ["module:monitoring"]="f9c5c5" ["module:billing"]="c5f9d4" ["module:frontend"]="fef2c0"
  ["module:devops"]="e0e0e0" ["module:docs"]="e0e0e0"
  ["review-1"]="b60205" ["review-2"]="b60205" ["review-3"]="b60205"
)

for name in "${!LABELS[@]}"; do
  gh label create "$name" --color "${LABELS[$name]}" --force $REPO_FLAG
done
```

## 3. Milestones (sprints)

Create one Milestone per sprint from `00-project-context/02-roadmap-and-milestones.md` §2/§3. Example for the first three:

```bash
gh api repos/TrekLink-Team/{repo-name}/milestones -f title="Sprint 1 (Wk1-2)" \
  -f description="Sep 7 - Sep 20, 2026 — TP1 kickoff: charter, EARS pass, architecture draft" \
  -f due_on="2026-09-20T23:59:59Z"

gh api repos/TrekLink-Team/{repo-name}/milestones -f title="Sprint 2 (Wk3-4)" \
  -f description="Sep 21 - Oct 4, 2026 — TP1 close / TP2-TP3 ramp / Review 1 in this sprint" \
  -f due_on="2026-10-04T23:59:59Z"

gh api repos/TrekLink-Team/{repo-name}/milestones -f title="Sprint 3 (Wk5-6)" \
  -f description="Oct 5 - Oct 18, 2026 — TP2 close, TP3, TP4 start / Review 1 deadline in this sprint" \
  -f due_on="2026-10-18T23:59:59Z"
```
Continue the pattern through Sprint 7/8 using the calendar table in the roadmap doc.

## 4. GitHub Project (board)

Create one org-level Project (`TrekLink Operations Platform`), views:
- **Board**: grouped by Status (`Backlog`/`Ready`/`In Progress`/`In Review`/`Done`), filtered by Milestone = current sprint.
- **Table**: all fields visible (Module, Points, Priority) for backlog grooming.

Link issues from all three active repos into the same Project so cross-repo sprint planning (e.g. Gateway + Backend work in the same sprint) is visible in one board.
