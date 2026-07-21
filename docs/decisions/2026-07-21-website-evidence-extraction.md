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

The first preview slice now uses these pure boundaries without persistence.
That keeps freshness and invalidation out of the request path while preserving
the option to add durable reuse later.

## Follow-ups

1. Consider a `capture_previews` schema only if later reuse justifies ownership,
   expiry, cleanup, and concurrency semantics; persistence is not a preview
   prerequisite.
2. Keep the existing capture service as the shared browser boundary; a separate
   preview Fly service is not required.
3. Add the analyze freshness fast path only after preview provenance and
   invalidation rules are durable.
