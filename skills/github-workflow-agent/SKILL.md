---
name: github-workflow-agent
description: Autonomous GitHub Actions, Git push/pull, bug-fix branch, Issue triage, and Pull Request workflow skill for AI coding agents working on kyrpy-uiux-designer.
---

# GitHub Workflow & Actions Skill (`github-workflow-agent`)

Use this skill whenever an AI agent is asked to **pull**, **push**, **fix an issue**, **open/manage GitHub Issues**, **create/merge Pull Requests**, or **inspect/trigger/fix GitHub Actions workflows** on [`KyrpyDev/kyrpy-uiux-designer`](https://github.com/KyrpyDev/kyrpy-uiux-designer).

---

## 1. Repository & Security Guardrails

- **Public Remote**: `https://github.com/KyrpyDev/kyrpy-uiux-designer.git` (`origin`, default branch `main`)
- **Zero-Secret Rule (MANDATORY)**:
  - Never stage or commit `.env`, `credentials.env`, private keys, or live database passwords.
  - Before every `git push`, run the secret audit command:
    ```bash
    git status --short
    git grep -iE "PG_PASSWORD=[^c]|POSTGRES_PASSWORD=[^c]|SERVICE_ROLE_KEY=eyJ" -- ':!*.example' || true
    ```
- **Test Gate Before Push**:
  - Always run the Node.js built-in test runner before pushing:
    ```bash
    cd src && npm test
    ```

---

## 2. Core Workflows (`pull`, `push`, `fix`, `issue`, `actions`)

### A. Pull Latest Changes (`pull`)
Synchronize local `main` with `origin/main` cleanly:
```bash
git fetch origin
git pull --rebase origin main
cd src && npm test
```

### B. Push Verified Changes (`push`)
Stage, verify tests, audit for secrets, commit with Conventional Commits, and push:
```bash
# 1. Run tests
(cd src && npm test)

# 2. Verify no sensitive files are staged
git status --short

# 3. Stage & commit
git add -A
git commit -m "feat(scope): concise summary of change"

# 4. Push to GitHub
git push origin main
```

### C. Bug-Fix & Issue Resolution Workflow (`fix`)
When asked to fix a bug or GitHub Issue `#N`:
```bash
# 1. Inspect the issue details (if fixing a reported GitHub issue)
gh issue view <N>

# 2. Create or switch to a fix branch (or work on main if instructed)
git checkout -b fix/issue-<N>-short-slug

# 3. Reproduce & write a regression test in src/tests/
(cd src && npm test)

# 4. Commit referencing the issue
git add -A
git commit -m "fix: resolve #<N> — <concise description>"

# 5. Push and either open a PR or merge to main
git push -u origin HEAD
gh pr create --fill
```

### D. GitHub Issues Management (`issue`)
Use the GitHub CLI (`gh`) to list, create, comment on, and close issues:
```bash
# List open issues
gh issue list --limit 30

# View a specific issue with comments
gh issue view <N> --comments

# Create a new bug or feature issue
gh issue create \
  --title "feat(library): description of feature or bug" \
  --body "## Context\n...\n\n## Acceptance Criteria\n- [ ] ..."

# Comment on or close an issue
gh issue comment <N> --body "Fixed in commit $(git rev-parse --short HEAD)."
gh issue close <N> --reason "completed"
```

### E. GitHub Actions CI/CD Inspection & Recovery (`actions`)
Workflow file: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)

```bash
# 1. List recent workflow runs
gh run list --limit 10

# 2. Inspect a specific run or view failed step logs
gh run view <run-id>
gh run view <run-id> --log-failed

# 3. Trigger the CI workflow manually via workflow_dispatch
gh workflow run ci.yml

# 4. Re-run a failed workflow after fixing transient issues
gh run rerun <run-id> --failed
```

### F. Pull Request Lifecycle (`pr`)
```bash
# List open pull requests
gh pr list

# Check CI status on current PR
gh pr checks

# Review and merge a PR once checks pass
gh pr merge <PR-number> --squash --delete-branch
```
