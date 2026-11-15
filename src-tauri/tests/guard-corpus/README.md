# P4c command corpus

`commands.json` contains **496 explicit command samples**. They are data: the tests
pass them to the lexer and policy evaluator and never execute their contents.
`generate.py` materializes the readable, grouped fixture definitions; it uses only
Python's standard library and never starts a command.

Coverage includes the compiler's health-check template, SSH aliases and literal
addresses, quoting and separators, stdin scripts and redirects, nested commands,
read-only writes, standard-mode destructive operations, critical services,
credential paths and exports, multiple cloud accounts, selected scopes and
ambiguous implicit targets. The test also reads the real compiler health-check
template so adding a new checklist command requires the guard to accept it.

For cloud commands, `whoami` is account-neutral and explicit account-wide read
listings may run without a project selector. Other commands must identify a
selected resource with a literal positional target, a supported scope flag, or
`VERCEL_PROJECT_ID`. The guard does not infer a deployment target from arbitrary
cwd configuration. Repeated selectors cannot override a checked account or scope
with another value.

Run from the repository root, serially with other Rust/frontend suites:

```powershell
cargo test --locked --jobs 1 --manifest-path cloudlink/src-tauri/Cargo.toml -p guard-rules -p cloudlink-guard -- --test-threads=1
```

The two crates add 18 Rust tests: nine rule tests (including the 496-case corpus),
eight real subprocess tests of the binary in temporary Unicode/space-containing
directories, and one UTC timestamp test. The subprocess cases verify actual deny
JSON, silent allowance, compact log redaction, malformed/missing policy,
self-test behavior, log rotation, ownership, input bounds, and Windows junction
protection. No real Agent directory, SSH configuration, cloud login or OS
credential is used.

The guard is a conservative command-text check, not a shell interpreter or a
security sandbox. It returns no approval on allowance. Missing/invalid policy
passes through; `--self-test --env <environment>` detects that condition with a
nonzero exit code. The only successful self-test output is
`cloudlink-guard:ok`, and self-tests do not append audit records.
