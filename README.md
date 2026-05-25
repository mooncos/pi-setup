# pi-config

Personal [pi coding agent](https://github.com/earendil-works/pi-coding-agent) configuration, tracked as a git repo.

> **Note:** This file is intentionally named `README.md` (not `SKILL.md`, not placed under `extensions/` or `skills/`), so pi ignores it entirely.

---

## Directory layout

```
~/.pi/agent/
├── settings.json          # Main pi settings (model, theme, packages, subagent overrides)
├── pi-permissions.jsonc   # Tool permission rules
├── auth.json              # Provider credentials (gitignored)
├── run-history.jsonl      # CLI run history (gitignored)
│
├── extensions/            # Local pi extensions (TypeScript)
│   ├── hostname-marker.ts # Stamps the current hostname in the prompt
│   └── sync.ts            # Syncs config across machines
│
├── skills/                # Local pi skills (Markdown + assets)
│   ├── alpha-arxiv/       # arXiv paper search & annotation via the alpha CLI
│   ├── humanizer/         # (stub) humanize AI-generated text
│   └── writing-clearly-and-concisely/
│                          # Strunk-style prose rules (includes elements-of-style.md)
│
├── git/                   # Cloned pi packages (managed by `pi pkg`)
│   └── github.com/
│       ├── arpagon/pi-rewind          # Session rewind / undo
│       ├── dbachelder/pi-btw          # Side-conversation (/btw) workflow
│       ├── MasuRii/pi-permission-system
│       ├── MasuRii/pi-tool-display
│       ├── nicobailon/pi-intercom     # Cross-session messaging
│       ├── nicobailon/pi-subagents    # Subagent orchestration skill
│       └── nicobailon/pi-web-access   # Web search / librarian skill
│
├── bin/                   # Bundled binaries used by pi (fd, rg) — gitignored
├── intercom/              # Intercom socket & state — gitignored
└── sessions/              # Session logs — gitignored
```

---

## Installed packages

Declared in `settings.json → packages`:

| Package | Source |
|---------|--------|
| `pi-rewind` | `git@github.com:arpagon/pi-rewind.git` |
| `pi-subagents` | `git@github.com:nicobailon/pi-subagents.git` |
| `pi-intercom` | `git@github.com:nicobailon/pi-intercom.git` |
| `pi-btw` | `git@github.com:dbachelder/pi-btw.git` |
| `pi-web-access` | `git@github.com:nicobailon/pi-web-access.git` |
| `pi-tool-display` | `https://github.com/MasuRii/pi-tool-display` |
| `pi-permission-system` | `https://github.com/MasuRii/pi-permission-system` |

---

## Subagent model overrides

Configured in `settings.json → subagents.agentOverrides`:

| Agent | Model | Thinking |
|-------|-------|---------|
| scout, delegate | claude-haiku-4-5 | xhigh |
| worker, context-builder | claude-sonnet-4-6 | xhigh |
| researcher, planner, reviewer, oracle | claude-opus-4-7 | xhigh |

---

## Sync / multi-machine setup

`extensions/sync.ts` handles syncing this repo between machines.  
`extensions/hostname-marker.ts` injects the current hostname so sessions are identifiable in shared logs.

---

## What pi does and doesn't pick up here

| Path | Picked up by pi? |
|------|-----------------|
| `settings.json` | ✅ Main config |
| `pi-permissions.jsonc` | ✅ Permission rules |
| `extensions/*.ts` | ✅ Loaded as extensions |
| `skills/*/SKILL.md` | ✅ Loaded as skills |
| `git/` | ✅ Package clones (via `settings.json → packages`) |
| `README.md` ← this file | ❌ Ignored |
| `bin/`, `intercom/`, `sessions/` | ❌ Runtime artefacts |
