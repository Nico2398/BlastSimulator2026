# Fully Autonomous AI Development Pipeline — GitHub Copilot

## What You Need

| Component | Minimum | Cost |
|---|---|---|
| **GitHub** | Free (public repo) or Pro ($4/mo for private) | $0–$4/mo |
| **Copilot** | **Pro** ($10/mo) — 300 premium requests | $10/mo |
| **Total** | | **$10–$14/mo** |

Your current Copilot Pro + free GitHub plan is sufficient. No upgrade required.

> **Pro+ ($39/mo)** only if you exceed 300 agent tasks/month (1 premium request per task).
> **GitHub Pro ($4/mo)** only if you need branch protection rules on private repos.
> **Public repos** get unlimited free Actions minutes — strongly recommended for this workflow.

---

## Architecture

```
YOU ──► Write issues (backlog) ──► Label "ready"
                                        │
        ┌───────────────────────────────┘
        ▼
  ┌─────────────────────┐
  │ AUTO-ASSIGN WORKFLOW │ (GitHub Actions on merge or on schedule)
  │ Picks next "ready"   │
  │ Assigns to @copilot  │
  └──────────┬──────────┘
             ▼
  ┌─────────────────────┐
  │ COPILOT CODING AGENT│ ◄── reads copilot-instructions.md
  │ Writes code          │ ◄── runs in copilot-setup-steps.yml env
  │ Runs tests           │ ◄── CI runs automatically (no approval!)
  │ Opens PR             │
  └──────────┬──────────┘
             ▼
  ┌─────────────────────┐
  │ COPILOT CODE REVIEW │ (automatic, independent context)
  │ Reviews PR quality   │
  │ Checks acceptance    │
  │ criteria from issue  │
  └──────┬─────────┬────┘
         │         │
      PASSES     FAILS or AMBIGUOUS
         │         │
         ▼         ▼
  ┌──────────┐  ┌──────────────────┐
  │AUTO-MERGE│  │ @copilot fix OR  │
  │ + close  │  │ tag @you         │
  │ issue    │  │ label "blocked"  │
  └────┬─────┘  └──────────────────┘
       │
       ▼
  AUTO-ASSIGN NEXT "ready" ISSUE ──► LOOP
```

**Zero manual intervention** on the happy path. You only get pulled in when the reviewer agent flags something ambiguous or the coding agent gets stuck.

---

## Step 1 — Repository Settings (One-Time)

### 1.1 Enable Copilot Coding Agent

**Settings → Copilot → Coding agent → Enable**

### 1.2 Disable CI Approval Requirement ⚡

This is the key setting that unlocks full autonomy. As of March 2026, GitHub added the option to let Copilot's CI workflows run without human approval.

**Settings → Copilot → Coding agent → Actions workflow approval → Disable "Require approval for workflow runs"**

> ⚠️ **Security trade-off:** This means unreviewed Copilot code can access your Actions secrets and repo write permissions. Only enable this on repos where your secrets are non-sensitive or properly scoped. For a personal project, this is fine.

### 1.3 Enable Auto-Merge

**Settings → General → Pull Requests → ✅ Allow auto-merge**

### 1.4 Enable Copilot Code Review (the Reviewer Agent)

**Settings → Copilot → Code review → Enable**

Then set up a **ruleset** to make Copilot review mandatory:

**Settings → Rules → Rulesets → New ruleset**

- Target: default branch (`main`)
- Rule: "Require a pull request before merging"
- Sub-rule: enable **"Require Copilot code review"**
- Add yourself to the **bypass list** so you can still push directly when needed

### 1.5 Allow GitHub Actions to Approve and Create PRs

**Settings → Actions → General → Workflow permissions**

- ✅ Read and write permissions
- ✅ Allow GitHub Actions to create and approve pull requests

### 1.6 Create a Personal Access Token (PAT)

Go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens**

Create a token with:
- **Repository access:** your target repo
- **Permissions:** Issues (Read/Write), Pull requests (Read/Write), Contents (Read/Write)

Store it as a repository secret: **Settings → Secrets and variables → Actions → New secret → Name: `PAT_TOKEN`**

> This PAT is used by workflows to assign issues to Copilot and approve/merge PRs. The default `GITHUB_TOKEN` cannot assign issues to `@copilot`.

---

## Step 2 — Repository Files

### 2.1 Agent Instructions: `.github/copilot-instructions.md`

This is Copilot's "brain" for your repo. Tailor it to your project.

```markdown
# Project Instructions

## Architecture
- [Your stack: e.g., Node.js + Express + PostgreSQL]
- [Your patterns: e.g., repository pattern, service layer]

## Coding Standards
- All public functions must have JSDoc / docstrings
- Use descriptive variable names, no abbreviations
- Max function length: 40 lines
- Every change must include tests for the acceptance criteria

## Testing
- Framework: [jest / pytest / etc.]
- Run: `npm test` (or your command)
- Coverage target: 80%+ on modified files

## PR Rules
- Reference the issue number in the PR body with "Closes #<number>"
- This is critical for the auto-assign pipeline to work

## Code Review Rules
- Approve if: all acceptance criteria pass, tests pass, code is clean
- Request changes if: tests fail or code quality issues exist
  → Comment `@copilot <specific fix instruction>` so the agent can iterate
- Tag @<your-username> if: architectural decisions needed, ambiguous
  requirements, or database/API schema changes
```

### 2.2 Agent Environment: `.github/workflows/copilot-setup-steps.yml`

Pre-installs your project dependencies so the agent can build and test.

```yaml
name: "Copilot Setup Steps"
on: workflow_dispatch

jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      # Adapt to your stack:
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      # Add anything else: database setup, env vars, etc.
```

### 2.3 Issue Template: `.github/ISSUE_TEMPLATE/agent-task.yml`

Using YAML form format for structured input:

```yaml
name: "Agent Task"
description: "Atomic task for autonomous agent processing"
labels: ["agent-task", "ready"]
body:
  - type: textarea
    id: context
    attributes:
      label: Context
      description: Why does this task exist? What feature does it belong to?
    validations:
      required: true

  - type: textarea
    id: task
    attributes:
      label: Task Description
      description: >
        What specifically needs to be done? Reference files, functions,
        endpoints. Be precise — the agent will follow this literally.
    validations:
      required: true

  - type: textarea
    id: acceptance
    attributes:
      label: Acceptance Criteria
      description: Checkboxes the agent can verify.
      value: |
        - [ ] Criterion 1
        - [ ] Criterion 2
        - [ ] All existing tests still pass
        - [ ] New tests cover the change
    validations:
      required: true

  - type: textarea
    id: testing
    attributes:
      label: Testing Procedure
      description: >
        Exact commands to validate. The agent will run these.
      value: |
        ```bash
        npm test -- --grep "feature-name"
        # Expected: all tests pass
        ```
    validations:
      required: true

  - type: textarea
    id: dependencies
    attributes:
      label: Dependencies
      description: Issues that must be merged before this one.
      placeholder: "Depends on: #XX"

  - type: textarea
    id: constraints
    attributes:
      label: Scope Constraints
      description: What should NOT be changed.
      placeholder: "Do not modify CI config, do not add dependencies"
```

### 2.4 Labels

Create these labels in your repo (Settings → Labels):

| Label | Color | Purpose |
|---|---|---|
| `ready` | `#0E8A16` green | Available for agent pickup |
| `in-progress` | `#FBCA04` yellow | Agent working |
| `blocked` | `#D93F0B` red | Needs human input |
| `done` | `#6F42C1` purple | Merged and closed |
| `agent-task` | `#1D76DB` blue | Identifies agent-processable issues |

---

## Step 3 — Automation Workflows

### 3.1 The Chain: Auto-Assign on Merge

`.github/workflows/auto-assign-next.yml`

This is the engine of your pipeline. When a Copilot PR merges, it closes the completed issue and assigns the next `ready` issue to Copilot.

```yaml
name: "Pipeline: assign next issue to Copilot"

on:
  pull_request:
    types: [closed]

jobs:
  chain-next-task:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - name: Close done issue + assign next to Copilot
        uses: actions/github-script@v7
        with:
          github-token: ${{ secrets.PAT_TOKEN }}
          script: |
            const owner = context.repo.owner;
            const repo = context.repo.repo;
            const prBody = context.payload.pull_request.body || '';
            const prTitle = context.payload.pull_request.title || '';

            // --- 1. Find and close the completed issue ---
            const closesMatch = prBody.match(/[Cc]loses?\s+#(\d+)/);
            const titleMatch = prTitle.match(/#(\d+)/);
            const issueNum = closesMatch?.[1] || titleMatch?.[1];

            if (issueNum) {
              const n = parseInt(issueNum);
              console.log(`Closing issue #${n} as done.`);
              await github.rest.issues.update({ owner, repo, issue_number: n, state: 'closed' });
              await github.rest.issues.addLabels({ owner, repo, issue_number: n, labels: ['done'] });
              await github.rest.issues.removeLabel({ owner, repo, issue_number: n, name: 'in-progress' }).catch(() => {});
            }

            // --- 2. Find next ready issue (oldest first) ---
            const { data: ready } = await github.rest.issues.listForRepo({
              owner, repo,
              labels: 'ready',
              state: 'open',
              sort: 'created',
              direction: 'asc',
              per_page: 10
            });

            for (const issue of ready) {
              // Check dependencies
              const depMatch = issue.body?.match(/[Dd]epends?\s+on:?\s*#(\d+)/);
              if (depMatch) {
                const dep = await github.rest.issues.get({
                  owner, repo, issue_number: parseInt(depMatch[1])
                });
                if (dep.data.state !== 'closed') {
                  console.log(`#${issue.number}: dependency #${depMatch[1]} not closed, skipping.`);
                  continue;
                }
              }

              // Assign to Copilot
              console.log(`Assigning #${issue.number} to Copilot.`);
              await github.rest.issues.addAssignees({
                owner, repo,
                issue_number: issue.number,
                assignees: ['copilot']
              });
              await github.rest.issues.removeLabel({
                owner, repo,
                issue_number: issue.number,
                name: 'ready'
              }).catch(() => {});
              await github.rest.issues.addLabels({
                owner, repo,
                issue_number: issue.number,
                labels: ['in-progress']
              });

              return; // Only assign one at a time
            }

            console.log('No more ready issues. Pipeline idle.');
```

### 3.2 Auto-Approve + Auto-Merge Copilot PRs

`.github/workflows/auto-merge-copilot.yml`

Once the Copilot code review passes and your CI checks pass, this workflow auto-approves and merges.

```yaml
name: "Pipeline: auto-approve and merge Copilot PRs"

on:
  pull_request_review:
    types: [submitted]
  check_suite:
    types: [completed]

permissions:
  pull-requests: write
  contents: write

jobs:
  auto-approve-and-merge:
    runs-on: ubuntu-latest
    steps:
      - name: Auto-approve and merge if Copilot PR with passing checks
        uses: actions/github-script@v7
        with:
          github-token: ${{ secrets.PAT_TOKEN }}
          script: |
            const owner = context.repo.owner;
            const repo = context.repo.repo;

            let prNumber;

            // Get PR number from event
            if (context.payload.pull_request) {
              prNumber = context.payload.pull_request.number;
            } else if (context.payload.check_suite) {
              const prs = context.payload.check_suite.pull_requests;
              if (prs.length === 0) return;
              prNumber = prs[0].number;
            }

            if (!prNumber) return;

            // Get full PR data
            const { data: pr } = await github.rest.pulls.get({
              owner, repo, pull_number: prNumber
            });

            // Only process Copilot PRs (Copilot creates from copilot/* branches)
            if (!pr.head.ref.startsWith('copilot/')) {
              console.log('Not a Copilot branch, skipping.');
              return;
            }

            // Check all status checks pass
            const { data: checks } = await github.rest.checks.listForRef({
              owner, repo, ref: pr.head.sha
            });

            const allPassed = checks.check_runs.length > 0 &&
              checks.check_runs.every(c =>
                c.status === 'completed' &&
                (c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral')
              );

            if (!allPassed) {
              console.log('Checks not all passed yet.');
              return;
            }

            // Auto-approve the PR
            try {
              await github.rest.pulls.createReview({
                owner, repo,
                pull_number: prNumber,
                event: 'APPROVE',
                body: '✅ Auto-approved: all checks passed.'
              });
              console.log(`Approved PR #${prNumber}`);
            } catch (e) {
              console.log(`Approval note: ${e.message}`);
            }

            // Merge the PR
            try {
              await github.rest.pulls.merge({
                owner, repo,
                pull_number: prNumber,
                merge_method: 'squash'
              });
              console.log(`Merged PR #${prNumber}`);
            } catch (e) {
              // If merge requirements not met yet, enable auto-merge
              console.log(`Direct merge failed, enabling auto-merge: ${e.message}`);
              try {
                await github.graphql(`
                  mutation($prId: ID!) {
                    enablePullRequestAutoMerge(input: {
                      pullRequestId: $prId,
                      mergeMethod: SQUASH
                    }) { clientMutationId }
                  }
                `, { prId: pr.node_id });
                console.log(`Auto-merge enabled for PR #${prNumber}`);
              } catch (e2) {
                console.log(`Auto-merge also failed: ${e2.message}`);
              }
            }
```

### 3.3 Handle Failures: Notify You

`.github/workflows/handle-failure.yml`

```yaml
name: "Pipeline: handle agent failure"

on:
  issues:
    types: [labeled]

jobs:
  notify:
    if: github.event.label.name == 'blocked'
    runs-on: ubuntu-latest
    steps:
      - name: Comment and notify
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.payload.issue.number,
              body: [
                '🚨 **Pipeline paused — agent blocked on this issue.**',
                '',
                '@YOUR_GITHUB_USERNAME — please review:',
                '1. The PR and agent session logs',
                '2. Add clarification to this issue',
                '3. Remove `blocked`, add `ready`, and re-assign to `copilot` to resume',
                '',
                'Or complete the task manually and the pipeline will auto-continue on merge.'
              ].join('\n')
            });
```

### 3.4 Scheduled Kickstart (Optional)

`.github/workflows/scheduled-assign.yml`

If the pipeline stalls (e.g., no merge triggered the chain), this cron job picks it back up:

```yaml
name: "Pipeline: scheduled kickstart"

on:
  schedule:
    - cron: "0 8,14,20 * * *"  # 3x daily at 8am, 2pm, 8pm UTC
  workflow_dispatch:  # manual trigger button

jobs:
  kickstart:
    runs-on: ubuntu-latest
    steps:
      - name: Check for idle ready issues
        uses: actions/github-script@v7
        with:
          github-token: ${{ secrets.PAT_TOKEN }}
          script: |
            const owner = context.repo.owner;
            const repo = context.repo.repo;

            // Check if any issue is already in-progress
            const { data: inProgress } = await github.rest.issues.listForRepo({
              owner, repo,
              labels: 'in-progress',
              state: 'open',
              per_page: 1
            });

            if (inProgress.length > 0) {
              console.log(`Issue #${inProgress[0].number} already in progress.`);
              return;
            }

            // Find next ready issue
            const { data: ready } = await github.rest.issues.listForRepo({
              owner, repo,
              labels: 'ready',
              state: 'open',
              sort: 'created',
              direction: 'asc',
              per_page: 1
            });

            if (ready.length === 0) {
              console.log('No ready issues.');
              return;
            }

            const issue = ready[0];
            console.log(`Kickstarting pipeline with issue #${issue.number}`);

            await github.rest.issues.addAssignees({
              owner, repo,
              issue_number: issue.number,
              assignees: ['copilot']
            });
            await github.rest.issues.removeLabel({
              owner, repo,
              issue_number: issue.number,
              name: 'ready'
            }).catch(() => {});
            await github.rest.issues.addLabels({
              owner, repo,
              issue_number: issue.number,
              labels: ['in-progress']
            });
```

---

## Step 4 — The Reviewer Agent

The Copilot **agentic code review** (GA since March 2026) acts as your independent reviewer. It operates with its own context, separate from the coding agent.

**What it does automatically:**

- Gathers full project context (not just the diff)
- Checks code quality, bugs, security issues
- Can comment `@copilot <fix instruction>` on the PR, which triggers the coding agent to iterate — creating a **closed loop** without you
- Can tag `@you` when it judges human input is needed

**How to customize its behavior:**

Add review-specific rules to `.github/copilot-instructions.md` (see Section 2.1 above). The review agent reads the same instructions file.

**The autonomous review loop:**

1. Coding agent finishes → opens PR → requests review
2. Code review agent reviews → finds issue → comments `@copilot fix X`
3. Coding agent picks up the comment → pushes fix → CI runs automatically
4. Code review agent re-reviews → approves
5. Auto-merge workflow merges → chain assigns next issue

This loop can iterate multiple times without you.

---

## Step 5 — Your Workflow as Customer + Lead Dev

### Morning Routine (~15 min)

1. **Check the Agents Panel** on GitHub.com — see what completed overnight
2. **Review any `blocked` issues** — add guidance and re-queue
3. **Write new issues** to refill the backlog (use the template)
4. Label them `ready` — the pipeline picks them up automatically

### Writing Good Issues (Your Main Job)

As the **Customer**, write the "what" and "why":
> "As a user, I want to filter products by category so I can find items faster."

As the **Lead Developer**, write the "how" and testing:
> "Add a `category` query parameter to `GET /api/products`. Filter against `products.category_id`. Test: `npm test -- --grep 'product filter'` should pass. Expected: 200 with filtered results. Do not modify the database schema."

The better your issues, the more autonomous the pipeline. Vague issues = more `blocked` states.

---

## Complete File Tree

```
your-repo/
├── .github/
│   ├── copilot-instructions.md               # Agent brain (coding + review)
│   ├── ISSUE_TEMPLATE/
│   │   └── agent-task.yml                     # Structured issue form
│   └── workflows/
│       ├── copilot-setup-steps.yml            # Agent dev environment
│       ├── auto-assign-next.yml               # Chain: assign next on merge
│       ├── auto-merge-copilot.yml             # Auto-approve + merge
│       ├── handle-failure.yml                 # Notify on blocked
│       ├── scheduled-assign.yml               # Cron kickstart
│       └── ci.yml                             # Your existing CI/CD
├── src/
├── tests/
└── ...
```

---

## Budget Estimation

| Resource | Allowance | Per-Task Cost | Tasks/Month |
|---|---|---|---|
| Premium requests (Pro) | 300/mo | 1 per task + ~1–2 for review iterations | ~100–150 |
| Actions minutes (Free, private) | 2,000/mo | ~10–30 min per task | ~65–200 |
| Actions minutes (public repo) | **Unlimited** | ~10–30 min per task | **Unlimited** |
| Extra premium requests | $0.04 each | — | Buy as needed |

**Recommendation:** Use a **public repository** for unlimited Actions minutes. Your Copilot Pro at $10/month covers the rest. If you need more than ~150 tasks/month, either upgrade to Pro+ ($39/mo for 1,500 requests) or set a budget for overages at $0.04/request.

---

## Security Notes

1. **CI auto-approval** means Copilot code runs your Actions before human review. Scope your Actions secrets tightly. Don't store production deploy keys in repos where the agent operates freely.

2. **Auto-merge** bypasses human review on the happy path. Your safety net is the required Copilot code review — if it flags issues, merge is blocked until they're resolved.

3. **PAT scope** — use a fine-grained token scoped to just this repo. Never use a classic token with broad `repo` scope.

4. **The coding agent only pushes to `copilot/*` branches** — your `main` branch is protected by the merge rules.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Copilot doesn't pick up the issue | Verify coding agent is enabled. Check the issue is assigned to `copilot` (not `@copilot` in body text). Check premium request quota. |
| CI still requires manual approval | Settings → Copilot → Coding agent → disable "Require approval for workflow runs" |
| Auto-merge doesn't fire | Settings → General → Allow auto-merge. Verify the PAT has `contents: write` permission. |
| Pipeline stalls between tasks | The scheduled-assign.yml cron job catches this. Or manually trigger it via workflow_dispatch. |
| Agent keeps failing on same issue | Label it `blocked`. Review logs. Add more context to the issue. Consider splitting into smaller tasks. |
| PR doesn't reference issue number | Update `copilot-instructions.md` to stress: "Always include `Closes #<number>` in PR body." |
