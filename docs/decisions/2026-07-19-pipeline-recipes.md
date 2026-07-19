# Pipeline recipes and source validation

## Backlog item

**Pipeline recipes: server use-case resolver and Amazon validation**

Goal: resolve existing pipeline content and acquisition behavior from each
generation snapshot's persisted `use_case`, without changing stage routing or
current website, Amazon, and event output.

## Decisions

1. `_useCasePolicy.ts` owns a pure discriminated recipe union. Website and
   Amazon are `kind: 'product'` recipes containing acquisition mode, analyze
   briefs, reference-purpose strings, and stage vocabulary. Event is the
   minimal `kind: 'event-bespoke'` sentinel and carries no product vocabulary.
2. `_workerPolicy.ts` remains the exclusive stage-routing policy. Recipes
   select content within stages; event routing and its bespoke prompt path
   remain scenario-driven.
3. The generation worker is the authoritative mismatch gate. It compares the
   generation snapshot's `use_case` with the campaign source before loading an
   active stage trace or invoking a stage. The analyze compatibility endpoint
   repeats the check before its status transition.
4. Both mismatch directions use the non-retryable
   `use_case_source_mismatch` code. Worker failures go through
   `record_generation_job_failure`, so `failure_stage` remains the current job
   stage. Compatibility failures use the existing generation failure fields.
   Persisted messages do not echo the source URL, and the UI maps the code to
   localized catalog copy.
5. Amazon network safety is independent of persisted intent.
   `_sourceAcquisition.ts` always skips fetch and capture for recognized Amazon
   hosts, even if an inconsistent row reaches it. Amazon intent also selects
   the existing no-I/O acquisition mode.
6. Prompt parity is enforced with characterization goldens captured by running
   the unrefactored analyze, designer, and hero stages through a deterministic
   test backend. Recipe-driven website, Amazon, and event prompts are compared
   to those complete strings byte-for-byte.
7. Existing downstream wording is intentionally shared by website and Amazon
   recipes where runtime behavior was previously shared. Copy improvements,
   including removing website terminology from Amazon designer and hero
   prompts, are out of scope.

## Reasoning

1. A server-only recipe union keeps prompt policy behind the trust boundary
   while making every content seam explicit and independently testable.
2. Keeping routing separate prevents an intent recipe from accidentally
   adding, skipping, or reordering pipeline stages and preserves legacy event
   behavior.
3. The worker sees both authoritative records and can reject before paid or
   stateful stage work. The analyze check protects direct compatibility calls
   without making every content stage duplicate validation.
4. Reusing existing failure persistence preserves retries, status history, and
   user-visible failure conventions instead of introducing a second error
   channel.
5. Intent can be stale or malformed; host-based no-fetch protection must still
   prevent CAPTCHA or block pages from becoming brand evidence.
6. Full prompt goldens detect whitespace, punctuation, ordering, and reference
   vocabulary drift that semantic assertions or snapshots created after the
   refactor would miss.
7. This rank is a dispatch refactor with one approved rejection behavior.
   Changing copy at the same time would make parity unverifiable and broaden
   review beyond the card.

## Follow-ups

- Revisit Amazon-specific downstream copy only as a separate behavior change
  with reviewed prompt goldens.
- Add new product recipe values only when their complete source, prompt,
  format, and tracking behavior can ship together.
