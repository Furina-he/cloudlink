# Probe protocol v1 fixtures

These sanitized Linux-output samples retain the command formats used by Ubuntu 24.04,
Alpine/BusyBox, and an Ubuntu user without Docker socket permission. Public placeholder
names replace deployment-specific names. The `@@status` delimiters are emitted by
CloudLink's versioned probe script, not by the individual Linux tools.

The permission-denied sample is stdout only. Docker's diagnostic stderr is captured in
memory at runtime and never stored with a probe snapshot or fixture-derived asset.

Unit tests load these files with `include_str!` and do not contact a server or read user
SSH configuration. Changes to the script's output protocol should update all samples.
