# Account recovery: forgot password

## Backlog item

**Account recovery: forgot password**

Goal: let a locked-out email-and-password user recover their account from `/signin`.

## Decisions

1. Keep recovery as inline state on `SignInPage`, with the step UI isolated in `PasswordRecoveryFlow`; do not add a reset route.
2. Implement the configured code flow as email request, 6-digit code exchange, new password, and explicit success steps.
3. Keep the email across steps and prefill it when returning to sign-in, but never retain the reset token after a successful password change.
4. Allow resends from the code step after a 30-second client-side debounce, restarting the delay after every accepted request.
5. Use the same generic request confirmation for initial sends and resends: "If an account exists, a code was sent." Treat non-rate-limited 4xx request responses as that same state so the UI does not become an account-enumeration signal.
6. Map code, token, password-policy, rate-limit, and operational failures to step-specific inline messages instead of displaying raw backend errors.
7. Require at least 6 characters and matching password fields in the client, while still handling backend password-policy errors.
8. Extend the existing marketing Playwright smoke with mocked InsForge reset endpoints and add unit coverage for validation and error mapping.

## Reasoning

1. `/signin` already owns the session-aware marketing/auth shell and return-path handling. An inline flow preserves that context and gives every step an immediate back-to-sign-in action; a dedicated route would add routing and shell duplication for a code flow that has no email-link landing page.
2. The verified backend setting is `resetPasswordMethod: "code"`, so exchanging the emailed OTP before submitting the password matches the supported SDK contract. A magic-link callback would be unused and misleading.
3. Preserving the email removes repeated input and makes the final sign-in prompt useful. Keeping the short-lived reset token only in component memory limits its lifetime and avoids URL or storage exposure.
4. Thirty seconds prevents accidental send bursts without making recovery depend on a long timer. Disabling the control communicates the wait more clearly than accepting and discarding repeated clicks.
5. Generic confirmation and masked account-sensitive responses keep known and unknown addresses on the same visible path. Echoing "account not found" or changing screens only for registered emails would expose account membership.
6. Raw SDK messages are not stable product copy and can be ambiguous. Step-specific messages give users a recovery action, particularly for invalid or expired codes and reset tokens.
7. Client validation gives immediate feedback for the known project policy and confirmation mismatch. Backend validation remains authoritative and may reject a password for additional reasons.
8. The behavior crosses React state, SDK request shapes, and auth routing. The existing browser smoke can verify that integration cheaply, while pure tests make error behavior deterministic.

## Follow-ups

- OAuth and email verification remain out of scope because this story only closes password recovery for the current email-and-password configuration.
- Link-based password reset routing is deferred unless the backend `resetPasswordMethod` changes from `code`.
- Backend auth configuration, custom SMTP, deployment, and Notion updates are intentionally unchanged for this repository-only story.
