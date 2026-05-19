---
description: Orchestrate end-of-session housekeeping — QA, session archive, recovery doc sync, BRD patch — then print a push-readiness report.
allowed-tools: Agent, Bash, Read
---

# /end-session

Run end-of-session housekeeping in this exact order. Each step must complete before the next.

## Steps

### 1. QA gate

Spawn the `qa-runner` agent with the instruction:
> Run `pwsh ./qa/regression.ps1 -Continue` and return the stage table + verdict. Don't attempt to fix anything.

Record the verdict (PASS or FAIL).

### 2. Session archive

Spawn the `session-archivist` agent with the instruction:
> Read `c:\tmp\joola-intel-session-changes.log` + the conversation summary I'll pass you. Append a `## Session Log — ...` section to `CLAUDE.md`. Theme: <derive from current conversation>.

Pass it a 200-word summary of what happened this session.

### 3. Recovery doc sync

Spawn the `backup-curator` agent with the instruction:
> Sync recovery docs and test arrays with the live codebase. Check routes, API routes, snapshot dates, env vars, and major deps. Report drift.

### 4. BRD patch

Spawn the `brd-curator` agent with the instruction:
> Read the latest Session Log just appended to `CLAUDE.md`. Patch the BUSINESS REQUIREMENTS section to reflect any new pages/brands/data sources, and mark any completed pending-hardening items.

### 5. Push-readiness report

Print to the user, exactly:

```
=== End-of-session report ===

QA:              PASS|FAIL
Session log:     appended to CLAUDE.md
Recovery docs:   N files refreshed
BRD:             K changes

Push command:
  pwsh ./scripts/deploy.ps1 -Message "<your message here>"
```

If QA was PASS: include the deploy command as ready-to-run.
If QA was FAIL: prefix the deploy command with `# DO NOT RUN until QA passes:` and surface the failure summary.

## Rules

- **Run agents sequentially.** Each agent reads outputs of the previous one (Session Log is appended before BRD-curator reads it).
- **Never push.** Only print the deploy command. The user pushes.
- **Never edit source code.** This command only updates docs and runs verification.
- If any agent reports unrecoverable failure (e.g. file system error), stop and surface it; don't proceed to later steps.
