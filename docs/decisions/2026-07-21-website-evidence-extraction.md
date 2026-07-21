# Website evidence extraction foundation

## Backlog item

**Extract website evidence and normalize capture URLs**

Goal: isolate the existing website-evidence pipeline and establish a shared,
tested URL-normalization contract without changing production capture behavior.

## Decisions

1. Move HTML asset/color extraction, evidence rehosting, style-board upload,
   and failure cleanup from `analyze` into one edge-function helper module.
2. Preserve analyze ordering, storage keyspaces, limits, fallback behavior,
   persisted evidence fields, log text, and cleanup timing exactly.
3. Add the same pure URL normalizer at the app and capture-service boundaries,
   driven by one shared fixture, but leave both modules unwired.
4. Limit this slice to testable foundations; it introduces no schema,
   deployment, generation, or wizard behavior.

## Reasoning

Extraction and storage behavior need a unit-testable boundary before capture
preview work can reuse them safely. Keeping the helper inside `functions`
avoids coupling the Deno pipeline to the Node capture service. Duplicating the
small pure normalizer at each runtime boundary keeps their build systems
independent, while one fixture prevents their contracts from drifting.

Wiring preview behavior now would combine a behavior-preserving refactor with
new persistence, deployment, freshness, and user-interface semantics. Those
changes need their own contracts and rollout validation.

## Follow-ups

1. Add the `capture_previews` schema and RPCs after ownership, expiry, and
   concurrency semantics are defined.
2. Add the `capture-preview` edge function after the preview persistence
   contract exists.
3. Deploy a separate preview Fly service and secrets after its trust boundary,
   limits, and operational ownership are agreed.
4. Add the analyze freshness fast path after preview provenance and invalidation
   rules are durable.
5. Add wizard preview UI after the backend can expose stable preview status,
   evidence, retry, and failure states.
