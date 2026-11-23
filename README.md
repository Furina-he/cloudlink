<div align="center">

<img src="docs/brand/cloudlink-icon.svg" width="84" height="84" alt="CloudLink logo" />

<h1>CloudLink</h1>

<p><strong>The local infrastructure switchboard &amp; command guardrail for your AI coding agents.</strong></p>

<p>
  Connect SSH servers and cloud CLIs once. CloudLink compiles them into one living Agent Skill (<code>cloudlink-servers</code>),
  syncs it across Claude Code, Codex, Cursor, Antigravity, and 20+ local agents on Windows &amp; WSL2,
  guards changes with one-time desktop approvals, and shares confirmed ops memory across every tool.
</p>

<p>
  <a href="https://github.com/Furina-he/cloudlink/releases/latest"><img src="https://img.shields.io/github/v/release/Furina-he/cloudlink?style=flat&amp;color=00a3cc&amp;label=Release" alt="Latest Release" /></a>
  <a href="https://github.com/Furina-he/cloudlink/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Furina-he/cloudlink/ci.yml?branch=main&amp;style=flat&amp;label=CI" alt="CI Status" /></a>
  <a href="https://github.com/Furina-he/cloudlink/releases"><img src="https://img.shields.io/github/downloads/Furina-he/cloudlink/total?style=flat&amp;color=00a3cc&amp;label=Downloads" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11%20%2B%20WSL2-161b1d?style=flat" alt="Platform: Windows 10/11 + WSL2" />
  <img src="https://img.shields.io/badge/Stack-Tauri%20v2%20%C2%B7%20Rust%20%C2%B7%20React%2019-161b1d?style=flat" alt="Tauri v2, Rust, React 19" />
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Furina-he/cloudlink?style=flat&amp;color=161b1d" alt="MIT License" /></a>
</p>

<p>
  <strong>English</strong> · <a href="README_ZH.md">简体中文</a>
</p>

<p>
  <a href="https://github.com/Furina-he/cloudlink/releases/latest">Download Installer</a> ·
  <a href="docs/releases/">Release Notes</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://github.com/Furina-he/cloudlink/issues">Report Issue</a>
</p>

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/resources-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/resources-light.png" />
  <img src="docs/assets/resources-light.png" width="880" alt="CloudLink Resources Switchboard" />
</picture>

<p><sub>
  <i>Desktop UI is currently in Simplified Chinese; the compiled <code>cloudlink-servers</code> Skill read by your AI agents is generated in English by default.</i>
</sub></p>

</div>

---

## Why CloudLink?

Working with multiple AI coding agents against real VPS hosts and cloud accounts usually runs into the same friction:

- **Scattered context** — Every new session or agent switch means re-explaining SSH aliases, Docker paths, reverse-proxy domains, and which repo deploys where.
- **Risky one-shot commands** — Giving an agent SSH or cloud CLI access means one hallucinated `docker compose down -v`, `cf delete`, or `cat .env` can break production or leak secrets.
- **Siloed tribal knowledge** — Lessons discovered by Claude Code never reach Codex, Cursor, or Antigravity unless you copy them around by hand.

**CloudLink fixes this in one quiet local desktop window:** verify your servers and cloud CLIs once, toggle which agents can see which resources, review risky changes with one-click desktop approvals, and merge verified agent notes straight into every authorized agent's Skill.

> [!NOTE]
> CloudLink is **not** an SSH terminal, a cloud console clone, or an OS-level sandbox. It is a local-first context compiler, Skill distributor, and command guardrail—your real permissions remain governed by OpenSSH, official CLIs, and remote accounts.

---

## Key Features

- **Unified Infrastructure Switchboard** — Manage Linux SSH servers alongside **Cloudflare (`cf`)**, **Vercel (`vercel`)**, **Oracle Cloud (`oci`)**, and **GitHub (`gh`)** in one place. Import existing `~/.ssh/config` aliases or onboard with password-to-key conversion, host fingerprint verification, and read-only system probing.
- **Dynamic Cloud Scope Management** — Cloudflare, Vercel, Oracle Cloud, and GitHub default to **auto-following** current and future resources under the linked account/owner—with stable per-item exclusions or manual selection whenever you want tighter boundaries.
- **One Living Agent Skill (`cloudlink-servers`)** — Compiles verified connections, probed services (Docker, systemd, 1Panel, Baota), auto-derived topology links (DNS → server, jump hosts, GitHub repo → Vercel), and team conventions into a single clean Skill (`SKILL.md` + `references/*.md`) with **zero passwords, private keys, or API secrets**.
- **Predictable Cross-Agent Delivery (Windows & WSL2)** — Syncs managed copies to **23 recognized AI agents** plus custom paths. Toggling one agent never silently toggles another; shared real directories publish only the explicit intersection; ownership (`.cloudlink.json`), symlinks, and Windows reparse points are checked before every write, with backup & undo on conflicts.
- **Local Command Guardrails & Live Approvals** — All provided SSH and cloud CLI actions route through the bundled `cloudlink-guard` runner (with an automatic `PreToolUse` Bash hook for Claude Code). Choose **Confirm Changes** or **Auto-Ops** per resource, mark **Production** independently, and approve or deny sensitive commands right from the Activity view.
- **Cross-Agent Ops Memory** — Agents append durable findings (config paths, deploy quirks, maintenance windows) to `~/.cloudlink/inbox/<resource>.md`. CloudLink scans notes for secrets (powered by gitleaks rules) and prompt-injection patterns; once you approve a note, it recompiles and syncs to every authorized agent.
- **Local-First Native Desktop** — Built with Tauri v2 + Rust. Zero accounts, zero telemetry, light/dark themes, top/side navigation, system tray residency, auto-start, and minisign-verified in-app updates via GitHub Releases.

---

## How It Works

```mermaid
flowchart LR
  subgraph Infra["Your Infrastructure"]
    direction TB
    SSH["Linux Servers (OpenSSH)"]
    Cloud["Cloud CLIs (cf · vercel · oci · gh)"]
  end

  subgraph App["CloudLink Desktop (Windows + WSL2)"]
    direction TB
    Core["Verify · Probe · Topology"]
    Compiler["Compile cloudlink-servers"]
    Guard["cloudlink-guard & Live Approval"]
    Core --> Compiler
  end

  subgraph Agents["Local AI Agents"]
    direction TB
    CC["Claude Code (~/.claude/skills + Hook)"]
    Uni["Universal (~/.agents/skills · 17 Agents)"]
    Ded["Antigravity · Trae · Kiro · Continue · Custom"]
  end

  Infra -->|"Read-only facts & scopes"| Core
  Compiler -->|"Zero-secret Skill sync"| Agents
  Agents -->|"SSH & cloud CLI calls"| Guard
  Guard -->|"Approved execution"| Infra
  Agents -.->|"Ops notes inbox (reviewed & merged)"| Compiler
```

---

## Execution Modes & Guardrails

Every new resource starts in **Confirm Changes**. **Production** is an independent risk marker (never a hidden third mode); enabling **Auto-Ops** on a production resource requires explicit confirmation and displays a persistent amber indicator.

| Operation Category | Examples | `Confirm Changes` (Default) | `Auto-Ops` |
| :--- | :--- | :---: | :---: |
| **Read-only queries** | `df -h`, `docker ps`, `nginx -t`, `cf zones list`, `vercel ls`, `oci … get` | Auto-allow | Auto-allow |
| **Routine changes** | `nginx -s reload`, `docker compose up -d`, `cf dns create`, routine deploys | **Ask (Allow once)** | Auto-allow |
| **High-risk operations** | Data/volume deletion (`docker compose down -v`, `dropdb`), cloud destroy, `reboot`/`shutdown`, firewall edits, SSH/`sshd` config, critical services, opaque scripts (`curl \| sh`) | **Ask (Allow once)** | **Ask (Allow once)** |
| **Hard redlines** | Reading `.env` / `*.pem` / `id_*` / `/etc/shadow`, `docker inspect` env vars, `vercel env pull`, `cf` secret/token export, GitHub repo delete, default-branch force-push, cross-account or ambiguous targets | **Deny** | **Deny** |

- **One-time approvals**: Pending commands pause in **Activity → Waiting for approval** (`Allow once` / `Deny`). Approval tickets expire after 5 minutes, can be consumed at most once, and re-verify route & policy revisions immediately before launching the process.
- **Honest caller attribution**: Activity logs separate the actual invoking agent (`--agent` self-report or hook identity) from the check channel (`runner` / `hook`) and real exit status—unknown callers are never guessed from delivery directories.

---

## Supported Ecosystem

### Infrastructure & Cloud CLIs

| Resource | CLI / Protocol | Onboarding & Scope |
| :--- | :--- | :--- |
| **Linux Servers** | System `OpenSSH` | Import `~/.ssh/config` or create managed connections; password-to-key conversion; host fingerprint verification; opt-in `Include`; read-only POSIX `sh` probing |
| **Cloudflare** | Official `cf` CLI | One-click background install & browser OAuth (requires Node.js 22.23+); dynamic auto-follow for zones, Workers & Pages + exclusions |
| **Vercel** | `vercel` CLI | One-click background install & browser login; dynamic auto-follow for current & future projects + exclusions |
| **Oracle Cloud** | `oci` CLI | Guided terminal `oci setup bootstrap`; dynamic auto-follow for compartments & compute instances |
| **GitHub** | `gh` CLI | Per-owner (personal or org) resource; one-click install & browser login; dynamic auto-follow for accessible repos (including private) with stable repo ID exclusions |

### Supported AI Agents (23 Recognized Brands + Custom Paths)

| Target Group | Global Skills Path | Agents & Capabilities |
| :--- | :--- | :--- |
| **Claude Code** | `~/.claude/skills` | Skill delivery + automatic `PreToolUse` Bash hook redirecting recognized direct commands to `cloudlink-guard` |
| **Universal Agent Skills** | `~/.agents/skills` | Shared across **17** recognized agents: **Codex**, **Cursor**, **Windsurf**, **Gemini CLI**, **GitHub Copilot**, **OpenCode**, **Cline**, **Roo Code**, **Kilo Code**, **Goose**, **Amp**, **Qwen Code**, **Droid**, **Augment**, **Crush**, **Junie**, **Warp** |
| **Antigravity** | `~/.gemini/config/skills` | Auto-detected and shared across Antigravity Desktop / IDE and `agy` CLI |
| **Dedicated Directories** | `~/.trae/skills`, `~/.trae-cn/skills`, `~/.kiro/skills`, `~/.continue/skills` | Auto-added when **Trae**, **Trae CN**, **Kiro**, or **Continue** is detected on Windows or WSL2 |
| **Custom Directories** | Any Windows or WSL2 path | Manually register any local skills folder with full ownership & backup protection |

---

## Interface Preview

### Live Guardrail Approvals & Agent Notes Inbox

Review risky commands (`Allow once` / `Deny`) alongside incoming agent notes—with automatic secret scanning and prompt-injection warnings before anything enters your Skill.

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/activity-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/activity-light.png" />
  <img src="docs/assets/activity-light.png" width="880" alt="CloudLink Activity view showing live command approvals and agent notes scanning" />
</picture>
</div>

### Agent Delivery & Compiled Skill Preview

<table>
  <tr>
    <td width="50%" valign="top">
      <p align="center"><strong>Agent Targets, Guard Status &amp; Conflict Handling</strong></p>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/agents-dark.png" />
        <source media="(prefers-color-scheme: light)" srcset="docs/assets/agents-light.png" />
        <img src="docs/assets/agents-light.png" alt="CloudLink Agents delivery view" />
      </picture>
    </td>
    <td width="50%" valign="top">
      <p align="center"><strong>Compiled English <code>SKILL.md</code> Preview &amp; Lint Checks</strong></p>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/skill-preview-dark.png" />
        <source media="(prefers-color-scheme: light)" srcset="docs/assets/skill-preview-light.png" />
        <img src="docs/assets/skill-preview-light.png" alt="CloudLink compiled SKILL.md preview sheet" />
      </picture>
    </td>
  </tr>
</table>

---

## Quick Start

### Requirements

- **OS**: Windows 10 / 11 (x64) with WebView2 Runtime
- **SSH**: Windows built-in OpenSSH client
- **Optional**: WSL2 (for agents running inside WSL); Node.js 22.23+ (required by Cloudflare's `cf` CLI)

### Install & Set Up

1. Download `CloudLink_<version>_x64-setup.exe` from [**GitHub Releases**](https://github.com/Furina-he/cloudlink/releases/latest) and run the installer.
2. Click **`+`** to add an SSH server (or import from `~/.ssh/config`) or connect Cloudflare, Vercel, Oracle Cloud, or GitHub.
3. Verify the host fingerprint and approve SSH config `Include` (or sign in via the official cloud CLI browser flow).
4. Toggle which AI agents should receive each resource—then ask your agent to inspect a service or deploy a change, and approve write actions directly in CloudLink.

---

## Security Model & Honest Boundaries

Trust in a developer tool comes from stating both what it protects and where its boundary ends:

| What CloudLink Guarantees | What CloudLink Honestly Does Not Claim |
| :--- | :--- |
| **Zero secrets in Skill**: Passwords, private key contents, and cloud API tokens are never written to `SKILL.md` or `references/*.md`. | **Not an OS security sandbox**: Under the same OS user, other local tools or unrecognized direct commands outside the runner are not isolated by CloudLink. |
| **Active checking in window & tray**: Closing the window to the system tray keeps runner checks, live approvals, and caller logs active. | **Quitting stops active checks**: Once you fully exit CloudLink, existing Skills, the standalone runner, and manual `ssh <alias>` still work, while live mode checks and approvals stop (stale approvals never auto-approve). |
| **Managed ownership only**: Overwrites and removals verify `.cloudlink.json` ownership, symlinks, and Windows reparse points, with backups and undo on takeover. | **No fake remote rollback**: File takeovers and merged notes support undo; commands already executed on remote hosts report real exit results without pretending to undo remote side effects. |
| **Local-first & zero telemetry**: All state stays in local SQLite; network requests are limited to your own connections, probes, CLI queries, and optional signed update checks. | **Not a substitute for remote least-privilege**: Guardrails catch mistakes and accidents, not a replacement for dedicated non-root accounts, IAM scoping, or infrastructure isolation. |

For full protocol details, route verification, and isolation boundaries, see [docs/architecture.md](docs/architecture.md).

---

## Development

To preview the frontend UI in mock mode (uses demo fixtures, no Rust toolchain required):

```bash
git clone https://github.com/Furina-he/cloudlink.git
cd cloudlink
pnpm install --frozen-lockfile
pnpm dev:mock
```

To run the full Tauri desktop app (requires Rust 1.95.0+, MSVC Build Tools, and Node.js 22+):

```bash
pnpm build:guard
pnpm tauri dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete local setup, test isolation rules, and verification commands.

### Tech Stack

- **Desktop & Backend**: Tauri v2 · Rust · SQLite · `cloudlink-guard` sidecar · minisign updater
- **Frontend**: React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui (`base-nova`) · Zustand · Motion

---

## Roadmap

- [x] Windows 10/11 + WSL2 SSH & cloud CLI (`cf`, `vercel`, `oci`, `gh`) management with dynamic scope
- [x] Unified `cloudlink-servers` Skill compiler & managed delivery across 23 recognized AI agents (including Antigravity)
- [x] Local `cloudlink-guard` execution channel, Confirm Changes / Auto-Ops modes, live approvals & Agent Notes inbox
- [ ] macOS desktop build
- [ ] Linux desktop build
- [ ] Native pre-tool hook integrations for additional AI agents beyond Claude Code

---

## Documentation

| Document | Description |
| :--- | :--- |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev environment, test isolation rules, checks, and commit conventions |
| [docs/architecture.md](docs/architecture.md) | Module responsibilities, data flow, runner protocol, and security boundaries |
| [docs/code-standards.md](docs/code-standards.md) | Frontend, Rust, type-contract (`ts-rs`), and testing conventions |
| [docs/design-system.md](docs/design-system.md) | Visual tokens, typography, component mappings, and interaction rules |
| [docs/releases/README.md](docs/releases/README.md) | Versioning, minisign signing, CI pipeline, and GitHub Releases workflow |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Third-party licenses and attributions (including gitleaks secret rules) |

---

## License

CloudLink is open-source software licensed under the [MIT License](LICENSE). Third-party materials retain their respective licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
