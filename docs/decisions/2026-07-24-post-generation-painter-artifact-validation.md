# Post-generation painter artifact validation

## Backlog item

Order 127 validates finished painter pixels for model-invented decorative glyphs,
placeholder or slot-label words, and adjacent duplicate words, then performs at
most one fail-open correction pass.

## Decisions

- Run a conservative multimodal vision judge inside the existing `hero` stage.
  Do not add a worker stage, schema change, migration, capture-service route, or
  frontend state.
- Decode and upload the initial poster to the public `assets` bucket before
  judging it. Send the small public Storage URL to the vision model rather than
  embedding the image model's potentially 20 MB data URL in a chat request.
- Keep the generation in `painting` and issue exactly one existing completion
  RPC after validation and candidate selection.
- Treat a strict four-field JSON verdict as positive when at least one artifact
  class is true. Model notes are bounded trace evidence only and never enter a
  painter prompt.
- Permit at most one retry, and start it only before 105 seconds have elapsed
  from hero-stage entry. Each judge has a 15-second timeout, bounding model time
  at 90 + 15 + 90 + 15 = 210 seconds under the 300-second worker lease.
- Append fixed, class-specific correction clauses after the fully assembled raw
  painter prompt. An empty class list is a byte-identical no-op, so first-pass
  product, event, and RedNote prompts retain their pinned golden bytes.
- Upload a retry to the same poster key before judging its public URL. Retain the
  initial Blob and restore it to that key unless the retry verdict is strictly
  clean. If validation, retry, or restoration fails, always complete with an
  available poster rather than leave the generation in `painting`.
- Gate the complete validation path with `PAINTER_VALIDATION_ENABLED`. It is on
  by default and can be disabled with `0`, `false`, `off`, or `no` without a
  redeploy or code rollback.
- Use the existing `aiChat` model resolution. `OPENROUTER_CHAT_MODEL` must remain
  vision-capable (the default `openai/gpt-4o` is); `aiChat` has no safe per-call
  model override. If operations selects a text-only chat model, disable painter
  validation with the kill switch until a vision-capable model is restored.
- Charge every enabled successful hero one vision call. A typical judge sends
  roughly 2.5K-3.5K image/input tokens and permits at most 180 output tokens. A
  detected artifact adds at most one image generation and one more vision call.
- Rebuild and redeploy only `hero` and `generation-worker`; the worker bundles
  `hero`, and the new private module does not change `_shared.ts` fan-out.

## Reasoning

- The reported brain, checkbox, and stacked-layer glyphs are visual objects, not
  OCR text. A vision model covers those objects and the raster-only duplicated
  word in one check using infrastructure already available in the Deno edge
  runtime.
- OCR in capture-service is the largest option: it needs a route, dependency or
  container package, request/security changes, and a second deployment surface.
  It is also weak on the primary drawn-icon failure.
- Upload-before-judge avoids sending a multi-megabyte base64 data URL back
  through OpenRouter and proves the candidate is a decodable, durable raster.
- Strict parsing, fixed retry enums, a single retry, initial-Blob restoration,
  and fail-open completion bound false positives, prompt injection, latency, and
  user impact.

## Follow-ups

- Calibrate judge precision and per-generation spend from trace outcomes before
  considering broader raster-quality classes.
- Keep multi-retry policies, independent OCR corroboration, a dedicated
  validation service or worker stage, and user-visible quality status deferred.
- Add a per-call validation model override only if `aiChat` gains one through a
  separately reviewed shared-helper change.
