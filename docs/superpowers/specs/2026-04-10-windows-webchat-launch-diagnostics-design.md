# Windows WebChat Launch Fix Design

**Problem**

Windows installer version `1.3.137` can open an Unauthorized OpenClaw Web Chat page when the user clicks `Web Chat` from the Done step. The current runtime logs do not make it obvious whether the installer launched the wrong URL shape, launched without a token, or handed off correctly and the failure happened downstream.

**Scope**

- Only change the Windows installer repo at `/Users/m1/Projects/ClawLite-Installer`.
- Fix the Done-step Web Chat launch path so the authenticated Web Chat UI is opened correctly after the user clicks `Web Chat`.
- Add explicit diagnostics around the launch path to verify the fix.
- Redact the gateway token in any diagnostic output.
- Make the diagnostics visible in the existing Done-step log export.

**Non-Goals**

- Do not change OpenClaw gateway or Control UI behavior.
- Do not modify other installer repos or shared release tooling.
- Do not redesign the Done step UX.

**Approach**

Fix the renderer-side `openWebChat` flow in `src/renderer/src/steps/DoneStep.tsx`, because this is the exact handoff point between a user click and the browser launch. The most likely failure mode in the current code is stale auth bootstrap state: `DoneStep` stores `gatewayToken` in React state, but only rereads config if that state is empty. If onboarding or provider switching rotates `gateway.auth.token`, the launcher can still open Web Chat with an outdated token and produce an Unauthorized page even though the URL shape is correct.

The fix is to reconcile against the latest config before every Web Chat launch, prefer the latest on-disk token when it differs from in-memory state, and build the final launch URL from that reconciled token. The diagnostics should answer four questions in a single exported log:

1. Did the click reach the launch handler?
2. Did the handler have a gateway token, and where did it come from?
3. Was the final URL built with `#token=` or `?token=`?
4. Did Electron accept the external open request?

**Diagnostic Output**

The Done-step logs should append a short diagnostic block when the user clicks `Web Chat`:

- `webchat click received`
- `webchat installer version: <version>` when available
- `webchat gateway status at launch: <status>`
- `webchat token source: state|config|missing`
- `webchat token length: <n>` when present
- `webchat url mode: hash|query|missing`
- `webchat launch url: http://127.0.0.1:18789/#token=<redacted>`
- `webchat openExternal: success`
- `webchat openExternal: failed: <message>` on error

If no token is available after reconciliation, keep the current user-facing message and also log that the launch was aborted before `openExternal`.

**Redaction Rules**

- Never log the raw gateway token.
- The logged URL must replace the token value with `<redacted>`.
- Token length is allowed because it helps confirm presence without exposing the secret.

**File Changes**

- Modify `src/renderer/src/steps/DoneStep.tsx` to reconcile the latest gateway token before launch and add launch diagnostics and error capture.
- Add a small helper module next to `DoneStep` to keep token selection, URL building, and redaction testable.
- Add automated tests for URL redaction and URL mode detection in the repo’s test location.

**Testing**

- Add unit tests covering:
  - stale in-memory token replaced by the latest config token
  - hash-mode URL redaction
  - query-mode detection
  - missing-token handling
- Run the targeted test file locally.
- Run the project build used for the Windows installer to ensure the diagnostics do not break packaging.

**Success Criteria**

- A user log exported after clicking `Web Chat` in the Windows installer clearly shows whether the launcher used `#token=` or `?token=`.
- The launcher always prefers the latest persisted gateway token over stale in-memory state.
- No raw token appears in logs.
- Clicking `Web Chat` opens the correct authenticated Web Chat UI when a valid current gateway token is present.
