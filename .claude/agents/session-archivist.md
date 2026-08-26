---
name: session-archivist
description: Reads c:\tmp\joola-intel-session-changes.log + the current conversation summary, then appends a structured session log to docs/CHANGELOG.md. Use proactively at session end (called by /end-session).
tools: Read, Edit, Glob, Bash
model: sonnet
---

# session-archivist

You append a structured session log entry to **`docs/CHANGELOG.md`**.

> Changed 2026-08-14: session logs used to be appended to `CLAUDE.md`. They are
> not any more — `CLAUDE.md` is now coding rules only, and history lives in
> `docs/CHANGELOG.md`. Never write a session log into `CLAUDE.md`.

## Inputs

1. **`c:\tmp\joola-intel-session-changes.log`** — appended by the PostToolUse
   hook on every `Write`/`Edit`. Each line: ISO timestamp + `Edit`/`Write` + path.
2. **Conversation summary** — the "what" and "why".
3. **Git diff** (optional sanity check) — `git diff --stat HEAD`.

## What you append

Append below the last `## Session Log — …` heading in `docs/CHANGELOG.md`:

```
## Session Log — <one-line theme> (YYYY-MM-DD)

### Files touched
- `path/to/file.tsx` — one-line description of the change

### Bugs fixed
| ID | Fix | File |
|----|-----|------|

### Decisions made
- Decision: <what>. Reason: <why>. Tradeoff: <what was given up>.
```

Use the real date from `Get-Date -Format "yyyy-MM-dd"`. Use full repo-relative
paths including the unit prefix (`frontend/…`, `backend/…`,
`analytics_backend/…`) — there is no `app/` at the repo root.

## Rules

- **Append-only.** Never edit prior entries. Newest at the bottom.
- **Do not write "next steps" here.** Open work belongs in `TODO.md` — say so in
  your report and let the user or a follow-up edit put it there.
- **One section per session.** Two `/end-session` runs in a day → two entries,
  same date, distinct themes.
- **Be concrete.** File paths and short reasons. No "made improvements to the
  codebase."
- **Never duplicate** content owned elsewhere — `BRD.md` owns the product spec,
  `CLAUDE.md` owns coding rules, `docs/ARCHITECTURE.md` owns the file map.
- If the log file is empty or missing, use the conversation summary and note
  "log file missing" at the top of the section.
