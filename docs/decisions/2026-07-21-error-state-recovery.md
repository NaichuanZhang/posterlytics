# Actionable error states and recovery

## Backlog item

**Error-state UX: misleading success toast, mislabeled 404, dead-end recovery**

Goal: make high-impact failures truthful, app-authored, and recoverable.

## Decisions

1. Show draft-saved copy only after campaign insertion has produced an ID;
   creation failures use app-authored copy while SDK detail stays diagnostic.
2. Keep missing-code tracked links at HTTP 400 and add a function-local
   `invalid` page whose visible heading is also 400.
3. Keep unknown codes at 404 and unpublished codes at 200, and give every
   public status page a link back to Posterlytics.
4. Classify sign-in failures by stable SDK code/status with message fallbacks;
   credential failures offer password recovery and transport failures retain
   the enabled sign-in form.
5. Name every accepted Amazon host from one ordered source of truth, replace
   implementation-facing image and generation errors with next steps, and
   state the existing 30-second reset cooldown.
6. Keep `view` localization in its local message dictionary so the public
   redirect bundle remains independent of the application catalog.

## Reasoning

HTTP 400 is correct when the required tracked-link code is absent; changing
only the label avoids altering the public redirect and visit-logging contract.
Unknown codes represent missing resources, while unpublished codes represent
real links that are not live, so their existing 404 and 200 semantics remain.

Stable error categories prevent backend and browser wording from leaking into
the interface. Recovery actions preserve the user's entered email and existing
workflow rather than introducing new navigation or redesigning successful
states. Shared host data and cooldown constants keep instructions aligned with
the validation and timing behavior they describe.

## Follow-ups

None.
