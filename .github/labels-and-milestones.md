# GitHub Labels — Setup

> **Conventions v2.** Jira is the single work tracker. GitHub Issues hold **daily reports** and
> **standalone bugs/blockers** only — see
> [`../01-conventions/10-jira-tracking-and-workflow.md`](../01-conventions/10-jira-tracking-and-workflow.md).
>
> **Milestones are no longer used.** Sprints live in Jira. The `gh api .../milestones` setup that
> previously lived in this file has been removed; any milestones already created can be closed.

Run once per repository. Requires [GitHub CLI](https://cli.github.com/) authenticated
(`gh auth login`) with write access to `TrekLink-Team`.

---

## 1. What the labels are still for

| Group | Purpose | Applies to |
|---|---|---|
| `type:*` | What kind of issue this is | Daily reports, bugs, chores |
| `module:*` | Which part of the system a bug touches | Bug reports |
| `severity:*` | Triage priority for a defect | Bug reports |
| `review-*` | Marks anything a specific capstone review depends on | Any issue |

> [!NOTE]
> **Story points are no longer GitHub labels.** The old `points: 1/2/3/5/8/13` taxonomy is
> retired — points are set in Jira on the card, on the project's base-5 scale
> (1, 2, 3, 5, 10, 15, 20, 25, 30). Delete the `points:*` labels if they already exist.

---

## 2. Label taxonomy

### Type
| Label | Color |
|---|---|
| `type:daily-report` | `0e8a16` |
| `type:bug` | `d73a4a` |
| `type:blocker` | `b60205` |
| `type:chore` | `c5def5` |
| `type:docs` | `e0e0e0` |

### Severity
| Label | Color |
|---|---|
| `severity:critical` | `b60205` |
| `severity:medium` | `fbca04` |
| `severity:low` | `c5def5` |

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
| `module:firmware` | `d4c5f9` |
| `module:devops` | `e0e0e0` |
| `module:docs` | `e0e0e0` |

### Review tracking
| Label | Color |
|---|---|
| `review-1` | `b60205` |
| `review-2` | `b60205` |
| `review-3` | `b60205` |

---

## 3. Bulk-create script

```bash
#!/usr/bin/env bash
set -euo pipefail
# Run from inside the target repo (gh infers owner/repo from the git remote),
# or set REPO_FLAG below.

REPO_FLAG=""   # e.g. "--repo TrekLink-Team/treklink-docs"

declare -A LABELS=(
  ["type:daily-report"]="0e8a16" ["type:bug"]="d73a4a" ["type:blocker"]="b60205"
  ["type:chore"]="c5def5"        ["type:docs"]="e0e0e0"

  ["severity:critical"]="b60205" ["severity:medium"]="fbca04" ["severity:low"]="c5def5"

  ["module:auth"]="bfd4f2"       ["module:devices"]="bfd4f2"  ["module:rentals"]="bfd4f2"
  ["module:trips"]="bfd4f2"      ["module:gateway-sync"]="d4c5f9"
  ["module:incidents"]="f9c5c5"  ["module:monitoring"]="f9c5c5"
  ["module:billing"]="c5f9d4"    ["module:frontend"]="fef2c0"
  ["module:firmware"]="d4c5f9"   ["module:devops"]="e0e0e0"   ["module:docs"]="e0e0e0"

  ["review-1"]="b60205" ["review-2"]="b60205" ["review-3"]="b60205"
)

for name in "${!LABELS[@]}"; do
  gh label create "$name" --color "${LABELS[$name]}" --force $REPO_FLAG
done

# Retire the old points taxonomy (harmless if they don't exist).
for p in 1 2 3 5 8 13; do
  gh label delete "points: $p" --yes $REPO_FLAG 2>/dev/null || true
done
```

Run it in all three repos:

```bash
for r in treklink-docs treklink-web treklink-firmware; do
  REPO_FLAG="--repo TrekLink-Team/$r" bash setup-labels.sh
done
```

---

## 4. One-time repository setup (leader)

Beyond labels, each repo needs this configured once. Tracked here because it is easy to forget and
invisible until it bites.

- [ ] **Add all five members as org collaborators with write access.** Until this is done,
      reviewers cannot be assigned and `gh pr create --reviewer` fails. This currently blocks §5.2
      of the Git conventions.
- [ ] **Branch protection on `main` and `dev`** — see
      [`../01-conventions/07-github-workflow-git-conventions.md`](../01-conventions/07-github-workflow-git-conventions.md) §7.
- [ ] **Disable "Allow merge commits"** in Settings → General → Pull Requests. Leave
      "Allow rebase merging" and "Allow squash merging" enabled.
- [ ] **Enable "Automatically delete head branches"** in Settings → General.
- [ ] **Connect Jira** at the organisation level (GitHub for Jira app) so `TK-nn` keys in branches,
      commits and PRs auto-link to cards.

---

## 5. Jira board setup (leader, once)

Not a GitHub concern, but the same one-time checklist:

- [ ] Statuses: `TO DO`, `IN PROGRESS`, `IN REVIEW`, `DONE`, `BUG`, `NEEDS HELP`, `CANCELLED`
- [ ] Every status reachable from **any** other status (the deliberate `Any` transitions)
- [ ] Board view: Kanban, columns in the order above
- [ ] Timeline view enabled for roadmap/deadline visibility
- [ ] Automation rule: **PR created** → transition to `IN REVIEW`
- [ ] Automation rule: **PR merged** → transition to `DONE`
