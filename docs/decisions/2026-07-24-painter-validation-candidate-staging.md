# Painter validation candidate staging

## Backlog item

Order 128: Painter-validation retry storage race. Keep the initial poster
available unless a separately stored retry is independently judged clean.

## Decisions

- This record amends the same-key retry and restoration decision in
  `2026-07-24-post-generation-painter-artifact-validation.md`.
- Upload the initial poster once to
  `poster/{campaignId}/{generationId}/poster.png`. Do not remove that key before
  or during retry generation, decoding, upload, or validation.
- Upload the retry to
  `poster/{campaignId}/{generationId}/poster.retry.png`. Promotion is logical:
  after a clean retry verdict, persist the candidate's returned URL and key
  directly because InsForge Storage has no copy, move, or rename operation.
- Assign the retry as the selected poster only after retry generation, decoding,
  upload, strict verdict parsing, and classification all succeed and report no
  artifact. Every other validation result keeps the initial poster selected.
- Complete the generation with the selected URL and key before deleting either
  loser. Delete the unselected object best-effort after successful completion;
  log cleanup failures without changing the ready generation. Preserve the
  existing selected-object cleanup when completion itself fails.
- Parse verdicts as either a bare JSON object or exactly one anchored `json`
  code fence with no surrounding text. Reject prose, malformed or multiple
  fences, unexpected keys or types, positive verdicts without notes, and clean
  verdicts with non-empty notes.
- Preserve the kill switch, one-retry limit, retry-start budget, fixed enum-only
  retry suffix, first-pass prompt bytes, trace metadata, and fail-open behavior.

| Branch | Persisted poster | Best-effort loser cleanup | Trace outcome |
|---|---|---|---|
| Validation disabled | Initial canonical | None | Existing no-metadata path |
| Initial verdict clean | Initial canonical | None | `clean` |
| Initial verdict unavailable or invalid | Initial canonical | None | `unavailable` |
| Artifact detected after retry budget | Initial canonical | None | `retry_skipped_budget` |
| Retry uploaded and independently clean | Retry candidate | Initial canonical | `corrected` |
| Retry verdict remains dirty | Initial canonical | Retry candidate | `residual` |
| Retry upload fails | Initial canonical | Retry key, in case of a partial write | `retry_failed` |
| Retry paint or decode fails | Initial canonical | None | `retry_failed` |
| Retry verdict unavailable or invalid | Initial canonical | Retry candidate | `retry_failed` |

- Treat the 90-second painter and 15-second judge timeouts as model-call
  ceilings. Their 210-second sum is not an end-to-end bound: decode, storage,
  trace, cleanup, and database work have no deadline. The 300-second worker
  lease remains the operational recovery backstop.

## Reasoning

- Distinct keys remove the destructive interval where the canonical object was
  deleted before the retry upload or verdict succeeded.
- Delaying loser deletion until after the completion RPC makes the database
  selection durable before cleanup and ensures cleanup cannot remove the
  selected poster.
- Persisted hero URLs and keys are opaque to consumers and completion RPCs, and
  the `assets` storage policy constrains bucket and owner rather than filename.
- Deterministic single-fence tolerance handles a common model formatting error
  while strict parsing rejects arbitrary prose and keeps malformed verdicts on
  the safe fail-open path.
- A global Promise timeout would not cancel an in-flight SDK upload or database
  commit and could introduce another storage race, so no wall-clock guard is
  added.

## Follow-ups

- Monitor `painter_artifact_loser_cleanup_failed` for orphan volume before
  considering a storage lifecycle cleanup.
- Keep hard end-to-end cancellation deferred until the SDK exposes cancellable
  storage and database operations.
