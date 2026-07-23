# Password recovery heading focus

## Backlog item

Order 123: Recovery Heading Focus. Focus the recovery "Reset your password"
heading on the in-place sign-in-to-recovery entry, remove the initial email
autofocus race, and preserve the existing focus targets throughout recovery.

## Decisions

- Focus the recovery heading on each fresh recovery-flow mount with a mount-only
  `useFocusOnChange` hook.
- Remove unconditional autofocus from the email input and focus it through a
  step-aware hook only when the flow returns to the email step.
- Preserve the code and password input autofocus, success-heading focus, and
  recovery-to-sign-in heading focus.
- Assert the initial heading target and forward Tab order in the marketing smoke
  while retaining all later focus, request, and page-error assertions.

## Reasoning

Email focus may have been intentional, and the counter-evidence in the ticket
was considered. The established convention focuses headings on view changes,
including route changes, recovery-to-sign-in reversal, and recovery success, so
closing the lone asymmetric sign-in-to-recovery direction is more consistent.
Separate mount and step hooks ensure only the heading schedules focus on entry;
the email hook skips its initial effect and handles only a later return.

## Follow-ups

None.
