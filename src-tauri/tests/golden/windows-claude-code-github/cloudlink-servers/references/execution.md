# Waiting, timeouts and unknown results

Every Connect entry in the details files calls the CloudLink runner. This file covers what follows a call: a request waiting for the user's approval, a timeout, or a result you cannot interpret.

## Waiting for approval
`exec` waits up to about 90 seconds for approval. A structured `waiting` result with a request ticket (exit 75) is not rejection or execution failure. Keep the original ticket private and continue the same request; never resubmit through another tool:

    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' wait --env 'windows' '<requestId.ownerToken>'

PowerShell:

    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' wait --env 'windows' '<requestId.ownerToken>'

- Do not add source/session options to `wait`: it retains the original request's source.
- Approval expires 5 minutes after request creation. Only the original inline caller or `wait` consumes it, at most once.
- “Approved” is not “executed”; expired/cancelled requests do not run. `wait` can return waiting again.
- Restarting CloudLink never approves or resumes an old request.

## Timeouts and unknown results
- A timeout may leave remote work running; inspect rather than retry. Never replay unknown results.
- Output streams are bounded and not saved by default.

## When the runner refuses
While CloudLink is starting or updating, or when its state is unreadable or it cannot be reached, the runner refuses instead of running the command. Report this to the user; it is not a reason to use another route. Inspect the runtime with the same quoted runner followed by `status` (no other arguments):

    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' status

PowerShell:

    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' status
