# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CloudLink is a Windows-first Tauri v2 desktop application (`cloudlink/`) that manages VPS server definitions, verifies SSH connectivity, runs read-only probes, compiles a unified Agent Skill (`cloudlink-servers`), delivers managed copies to CLI Agents' global skills directories (`~/.claude/skills`, `~/.agents/skills`, or custom directories across Windows and WSL2), enforces command guardrails on Claude Code via a `PreToolUse` hook (`cloudlink-guard`), and collects Agent notes.

## Required Reading Order

Before starting or continuing any stage, read in order:

1. `README.md` — Project overview and current stage status
2. `PRODUCT.md` — Product context, positioning, and principles
3. `DESIGN.md` — "Steel & Signal" visual system and tokens
4. `docs/PRD.md` — PRD v3 (Chapters 3–8 are hard engineering & product specifications)
5. `docs/EXECUTION-PLAN.md` — Phased execution plan (P0–P6) and acceptance gates
6. `docs/CC-SWITCH-EXPERIENCE.md` — Battle-tested engineering lessons from `cc-switch` VPS development (`SSH_ASKPASS`, Windows OpenSSH 9.5p1 quirks, `keyring` lock/target safety, reparse-point checks, and test isolation)

Do not modify files under `docs/archive/`. Priority on conflict: `docs/PRD.md` Chapter 7 > `DESIGN.md` tokens > `docs/PRD.md` other chapters > `docs/EXECUTION-PLAN.md`.

## Commands

Frontend commands run from `cloudlink/` (or via `pnpm --dir cloudlink <script>`):

```bash
pnpm --dir cloudlink dev:mock    # Vite in mock IPC mode (.env.mock -> VITE_MOCK=1)
pnpm --dir cloudlink typecheck   # tsc -b
pnpm --dir cloudlink lint        # ESLint (includes dependency & import restrictions)
pnpm --dir cloudlink test        # Vitest unit tests
pnpm --dir cloudlink e2e         # Playwright E2E tests (against mock mode)
pnpm --dir cloudlink build       # Production frontend bundle
pnpm --dir cloudlink tauri dev   # Full Tauri desktop window
```

Rust backend commands (run **serially**, never concurrently with full Vitest/Playwright suites on this 16 GiB Windows machine):

```bash
cargo fmt --check --manifest-path cloudlink/src-tauri/Cargo.toml
cargo clippy --locked --jobs 1 --manifest-path cloudlink/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --jobs 1 --manifest-path cloudlink/src-tauri/Cargo.toml -- --test-threads=1
```

## Hard Engineering & Safety Constraints

1. **Dependency & Component Whitelist (`docs/PRD.md` Chapter 7):**
   - Only packages listed in PRD 7.1 are permitted.
   - Use the exact component mapping in PRD 7.3 (`base-nova` / Base UI primitives use `render`, never Radix `asChild`; `react-resizable-panels` v4 sizes must be strings like `"42%"` or `"300px"`; `useFieldArray` must set `keyName: "key"`).
   - All UI copy lives in `cloudlink/src/lib/copy.ts`. Rust returns error/lint/reason IDs and parameters, never localized sentences.
   - Only `cloudlink/src/lib/ipc.ts` may call `invoke`, and only `cloudlink/src/lib/events.ts` may call `listen`.

2. **Test Isolation & Real Config Protection (Critical):**
   - This workstation has real user Skills in Windows `~/.claude/skills` (17 items) and WSL `~/.agents/skills` (`repo-to-resume-tailor`), plus real `~/.ssh/config` and OS credentials. **Never touch them in tests.**
   - When `CLOUDLINK_HOME` (or test path overrides) is set, path resolution must have **zero fallback** to real `HOME` / `USERPROFILE` / `APPDATA`.
   - Unit tests must never access the native OS credential store (`OsCredentialStore` must bail under `cfg!(test)` and require an injected mock store).
   - Overwriting or deleting any directory/file requires verifying `.cloudlink.json` ownership and checking `symlink_metadata` + Windows `FILE_ATTRIBUTE_REPARSE_POINT` (`0x400`).

3. **SSH & Credential Pitfalls from CC Switch (`docs/CC-SWITCH-EXPERIENCE.md`):**
   - `SSH_ASKPASS` helper dispatch must be the very first statement in `src-tauri/src/main.rs` (before `tauri-plugin-single-instance`, logging, or DB init) and must trigger via an environment marker (`CLOUDLINK_SSH_ASKPASS=1`), not `--askpass` CLI flags.
   - On Windows, pass `SSH_ASKPASS=./cloudlink.exe` with `command.current_dir(exe_parent)` so Windows OpenSSH 9.5p1 does not corrupt non-ASCII paths.
   - On Windows, call `connection.set_nonblocking(false)` on sockets returned by `TcpListener::accept()`.
   - Always place `--` before `<alias>` in `ssh` argument arrays to block post-destination option injection.
   - When testing a connection with a saved password (`req.password` omitted), verify that `req.connection`'s `(host, port, user, auth.method)` still matches the persisted server record before reading the OS vault (`PasswordTargetChanged` guard).
   - Never pass Windows `\\?\` verbatim canonical paths to OpenSSH; convert `\` to `/` in quoted `ssh_config` paths.
