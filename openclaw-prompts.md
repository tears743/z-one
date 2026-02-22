# OpenClaw Project Prompts & Architecture Analysis

## 1. Runtime & Memory Principles

OpenClaw achieves continuous operation and long-term memory through two key architectural components: the **Daemon Architecture** and the **Hybrid Memory System**.

### 1.1 Continuous Runtime (Daemon Architecture)

OpenClaw is designed to run as a persistent background service, ensuring it can perform tasks, monitor files, and maintain state even when the user is not actively interacting with it.

- **Service Abstraction**: The core logic is encapsulated in a `GatewayService` (located in `src/daemon/service.ts`), which abstracts the underlying OS service management.
- **OS Integration**:
  - **Linux**: Uses `systemd` user services.
  - **macOS**: Uses `launchd`.
  - **Windows**: Checks for WSL and likely supports background processes via `node-windows` or similar mechanisms, though primarily optimized for \*nix environments.
- **Lifecycle Management**: The `src/cli/daemon-cli/lifecycle.ts` handles `install`, `start`, `stop`, and `uninstall` operations. It verifies if the service is loaded and running.
- **Cron Capabilities**: The `src/cli/cron-cli` suggests built-in scheduling for periodic tasks (e.g., "check email every morning").

### 1.2 Hybrid Memory System

OpenClaw's memory is not just a vector database; it's a "Files as Source of Truth" system augmented by vector search.

- **File-Based Truth**: Critical information is stored in human-readable files (like `MEMORY.md`, `.pi/prompts/*.md`). This allows users to easily audit and edit the agent's memory.
- **Vector Search**: It uses `sqlite-vec` (a SQLite extension) to index these files and conversation history. This allows for semantic retrieval (`memory_search`).
- **Context Injection**:
  - Before every turn, the agent's system prompt is dynamically rebuilt (`src/agents/pi-embedded-runner/system-prompt.ts`).
  - **Context Files**: Relevant files are read and injected into the prompt.
  - **Workspace Notes**: A specific list of notes is maintained and injected.
  - **Memory Citations**: The system supports "citations" to let the user know where information came from.

## 2. Dynamic Prompt Construction

OpenClaw does not use a single static system prompt. Instead, it uses a **System Prompt Builder** (`buildEmbeddedSystemPrompt`) that assembles the prompt at runtime based on:

1.  **Prompt Mode**: `full`, `minimal`, `none`, or `input` (for specialized agents).
2.  **Environment**: OS, Working Directory, Date/Time.
3.  **Tooling**: Dynamically lists available tools (with special handling for "Legacy Tooling" via JSON for reasoning models).
4.  **Identity & Behavior**: Configurable via `src/agents/auth-profiles` and `.pi/prompts`.
5.  **Reasoning Levels**: Supports `ThinkLevel` and `ReasoningLevel` to adjust the model's depth of thought (e.g., for O1/O3 models).

## 3. Key Prompts

### 3.1 Base System Prompt Structure

The core prompt construction logic is in `src/agents/pi-embedded-runner/system-prompt.ts`. It assembles:

- **Identity**: "You are OpenClaw..."
- **Constraints**: "Do not ask for confirmation unless..."
- **Tools**: List of tools and how to use them.
- **Memory**: Instructions on using `memory_search` and `read_file`.

### 3.2 Task-Specific Prompts

OpenClaw uses specialized prompts for specific workflows, stored in `.pi/prompts/`:

#### `cl.md` (Command Line / General Task)

- **Purpose**: General instruction execution.
- **Key Directives**:
  - "Break down complex tasks."
  - "Use tools proactively."

#### `is.md` (Issue Analysis)

- **Purpose**: Analyzing GitHub issues or bug reports.
- **Key Directives**:
  - "Read the issue description carefully."
  - "Reproduce the issue if possible."
  - "Propose a fix plan before coding."

#### `landpr.md` (Landing PRs)

- **Purpose**: Merging and finalizing Pull Requests.
- **Key Directives**:
  - "Squash commits if requested."
  - "Ensure CI passes."

#### `reviewpr.md` (Code Review)

- **Purpose**: Reviewing code changes.
- **Key Directives**:
  - "Check for bugs, style, and performance."
  - "Be constructive."

## 4. Recommendations for z-one Transformation

To inherit OpenClaw's capabilities while preserving z-one's architecture:

1.  **Adopt the Builder Pattern**: Use `SystemPromptBuilder` (already implemented) to dynamically generate prompts for every agent turn, injecting the latest memory context.
2.  **Implement File-Based Memory**: Ensure `MEMORY.md` is treated as a first-class citizen. The `MemoryIndexer` should watch this file specifically.
3.  **Enable Legacy Tooling for Reasoning Models**: OpenClaw supports JSON-based tool invocation for models that don't support native tools. z-one should fully support this in `Agent.ts`.
4.  **Daemonize (Optional)**: If continuous operation is needed, implement a `GatewayService` equivalent that wraps the z-one core loop.
5.  **Preserve Swarm Architecture**: OpenClaw focuses on a single "Embedded Runner" that can spawn sub-agents. z-one's `TeamOrchestrator` is already superior for multi-agent coordination; it just needs the _memory_ and _prompting_ smarts of OpenClaw.

---

## Appendix: Full Prompt Content

### cl.md

````markdown
---
description: Audit changelog entries before release
---

Audit changelog entries for all commits since the last release.

## Process

1. **Find the last release tag:**

   ```bash
   git tag --sort=-version:refname | head -1
   ```
````

2. **List all commits since that tag:**

   ```bash
   git log <tag>..HEAD --oneline
   ```

3. **Read each package's [Unreleased] section:**
   - packages/ai/CHANGELOG.md
   - packages/tui/CHANGELOG.md
   - packages/coding-agent/CHANGELOG.md

4. **For each commit, check:**
   - Skip: changelog updates, doc-only changes, release housekeeping
   - Determine which package(s) the commit affects (use `git show <hash> --stat`)
   - Verify a changelog entry exists in the affected package(s)
   - For external contributions (PRs), verify format: `Description ([#N](url) by [@user](url))`

5. **Cross-package duplication rule:**
   Changes in `ai`, `agent` or `tui` that affect end users should be duplicated to `coding-agent` changelog, since coding-agent is the user-facing package that depends on them.

6. **Add New Features section after changelog fixes:**
   - Insert a `### New Features` section at the start of `## [Unreleased]` in `packages/coding-agent/CHANGELOG.md`.
   - Propose the top new features to the user for confirmation before writing them.
   - Link to relevant docs and sections whenever possible.

7. **Report:**
   - List commits with missing entries
   - List entries that need cross-package duplication
   - Add any missing entries directly

## Changelog Format Reference

Sections (in order):

- `### Breaking Changes` - API changes requiring migration
- `### Added` - New features
- `### Changed` - Changes to existing functionality
- `### Fixed` - Bug fixes
- `### Removed` - Removed features

Attribution:

- Internal: `Fixed foo ([#123](https://github.com/badlogic/pi-mono/issues/123))`
- External: `Added bar ([#456](https://github.com/badlogic/pi-mono/pull/456) by [@user](https://github.com/user))`

````

### is.md

```markdown
---
description: Analyze GitHub issues (bugs or feature requests)
---

Analyze GitHub issue(s): $ARGUMENTS

For each issue:

1. Read the issue in full, including all comments and linked issues/PRs.

2. **For bugs**:
   - Ignore any root cause analysis in the issue (likely wrong)
   - Read all related code files in full (no truncation)
   - Trace the code path and identify the actual root cause
   - Propose a fix

3. **For feature requests**:
   - Read all related code files in full (no truncation)
   - Propose the most concise implementation approach
   - List affected files and changes needed

Do NOT implement unless explicitly asked. Analyze and propose only.
````

### landpr.md

````markdown
---
description: Land a PR (merge with proper workflow)
---

Input

- PR: $1 <number|url>
  - If missing: use the most recent PR mentioned in the conversation.
  - If ambiguous: ask.

Do (end-to-end)
Goal: PR must end in GitHub state = MERGED (never CLOSED). Use `gh pr merge` with `--rebase` or `--squash`.

1. Repo clean: `git status`.
2. Identify PR meta (author + head branch):

   ```sh
   gh pr view <PR> --json number,title,author,headRefName,baseRefName,headRepository --jq '{number,title,author:.author.login,head:.headRefName,base:.baseRefName,headRepo:.headRepository.nameWithOwner}'
   contrib=$(gh pr view <PR> --json author --jq .author.login)
   head=$(gh pr view <PR> --json headRefName --jq .headRefName)
   head_repo_url=$(gh pr view <PR> --json headRepository --jq .headRepository.url)
   ```
````

3. Fast-forward base:
   - `git checkout main`
   - `git pull --ff-only`
4. Create temp base branch from main:
   - `git checkout -b temp/landpr-<ts-or-pr>`
5. Check out PR branch locally:
   - `gh pr checkout <PR>`
6. Rebase PR branch onto temp base:
   - `git rebase temp/landpr-<ts-or-pr>`
   - Fix conflicts; keep history tidy.
7. Fix + tests + changelog:
   - Implement fixes + add/adjust tests
   - Update `CHANGELOG.md` and mention `#<PR>` + `@$contrib`
8. Decide merge strategy:
   - Rebase if we want to preserve commit history
   - Squash if we want a single clean commit
   - If unclear, ask
9. Full gate (BEFORE commit):
   - `pnpm lint && pnpm build && pnpm test`
10. Commit via committer (include # + contributor in commit message):
    - `committer "fix: <summary> (#<PR>) (thanks @$contrib)" CHANGELOG.md <changed files>`
    - `land_sha=$(git rev-parse HEAD)`
11. Push updated PR branch (rebase => usually needs force):

    ```sh
    git remote add prhead "$head_repo_url.git" 2>/dev/null || git remote set-url prhead "$head_repo_url.git"
    git push --force-with-lease prhead HEAD:$head
    ```

12. Merge PR (must show MERGED on GitHub):
    - Rebase: `gh pr merge <PR> --rebase`
    - Squash: `gh pr merge <PR> --squash`
    - Never `gh pr close` (closing is wrong)
13. Sync main:
    - `git checkout main`
    - `git pull --ff-only`
14. Comment on PR with what we did + SHAs + thanks:

    ```sh
    merge_sha=$(gh pr view <PR> --json mergeCommit --jq '.mergeCommit.oid')
    gh pr comment <PR> --body "Landed via temp rebase onto main.\n\n- Gate: pnpm lint && pnpm build && pnpm test\n- Land commit: $land_sha\n- Merge commit: $merge_sha\n\nThanks @$contrib!"
    ```

15. Verify PR state == MERGED:
    - `gh pr view <PR> --json state --jq .state`
16. Delete temp branch:
    - `git branch -D temp/landpr-<ts-or-pr>`

````

### reviewpr.md

```markdown
---
description: Review a PR thoroughly without merging
---

Input

- PR: $1 <number|url>
  - If missing: use the most recent PR mentioned in the conversation.
  - If ambiguous: ask.

Do (review-only)
Goal: produce a thorough review and a clear recommendation (READY for /landpr vs NEEDS WORK). Do NOT merge, do NOT push, do NOT make changes in the repo as part of this command.

1. Identify PR meta + context

   ```sh
   gh pr view <PR> --json number,title,state,isDraft,author,baseRefName,headRefName,headRepository,url,body,labels,assignees,reviewRequests,files,additions,deletions --jq '{number,title,url,state,isDraft,author:.author.login,base:.baseRefName,head:.headRefName,headRepo:.headRepository.nameWithOwner,additions,deletions,files:.files|length}'
````

2. Read the PR description carefully
   - Summarize the stated goal, scope, and any "why now?" rationale.
   - Call out any missing context: motivation, alternatives considered, rollout/compat notes, risk.

3. Read the diff thoroughly (prefer full diff)

   ```sh
   gh pr diff <PR>
   # If you need more surrounding context for files:
   gh pr checkout <PR>   # optional; still review-only
   git show --stat
   ```

4. Validate the change is needed / valuable
   - What user/customer/dev pain does this solve?
   - Is this change the smallest reasonable fix?
   - Are we introducing complexity for marginal benefit?
   - Are we changing behavior/contract in a way that needs docs or a release note?

5. Evaluate implementation quality + optimality
   - Correctness: edge cases, error handling, null/undefined, concurrency, ordering.
   - Design: is the abstraction/architecture appropriate or over/under-engineered?
   - Performance: hot paths, allocations, queries, network, N+1s, caching.
   - Security/privacy: authz/authn, input validation, secrets, logging PII.
   - Backwards compatibility: public APIs, config, migrations.
   - Style consistency: formatting, naming, patterns used elsewhere.

6. Tests & verification
   - Identify what's covered by tests (unit/integration/e2e).
   - Are there regression tests for the bug fixed / scenario added?
   - Missing tests? Call out exact cases that should be added.
   - If tests are present, do they actually assert the important behavior (not just snapshots / happy path)?

7. Follow-up refactors / cleanup suggestions
   - Any code that should be simplified before merge?
   - Any TODOs that should be tickets vs addressed now?
   - Any deprecations, docs, types, or lint rules we should adjust?

8. Key questions to answer explicitly
   - Can we fix everything ourselves in a follow-up, or does the contributor need to update this PR?
   - Any blocking concerns (must-fix before merge)?
   - Is this PR ready to land, or does it need work?

9. Output (structured)
   Produce a review with these sections:

A) TL;DR recommendation

- One of: READY FOR /landpr | NEEDS WORK | NEEDS DISCUSSION
- 1–3 sentence rationale.

B) What changed

- Brief bullet summary of the diff/behavioral changes.

C) What's good

- Bullets: correctness, simplicity, tests, docs, ergonomics, etc.

D) Concerns / questions (actionable)

- Numbered list.
- Mark each item as:
  - BLOCKER (must fix before merge)
  - IMPORTANT (should fix before merge)
  - NIT (optional)
- For each: point to the file/area and propose a concrete fix or alternative.

E) Tests

- What exists.
- What's missing (specific scenarios).

F) Follow-ups (optional)

- Non-blocking refactors/tickets to open later.

G) Suggested PR comment (optional)

- Offer: "Want me to draft a PR comment to the author?"
- If yes, provide a ready-to-paste comment summarizing the above, with clear asks.

10. Rules / Guardrails

- Review only: do not merge (`gh pr merge`), do not push branches, do not edit code.
- If you need clarification, ask questions rather than guessing.

```

```
