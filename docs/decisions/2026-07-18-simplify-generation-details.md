# Simplify generation details

## Backlog item

**Simplify generation details for users (hide pipeline internals & prompts)**

Goal: show the user's instruction and relevant images without exposing pipeline
stages or prompt-engineering internals.

## Decisions

1. Delete the browser trace renderer instead of retaining it behind a Vite
   environment flag.
2. Query only the hero trace's `attached_images` column for the regular product
   UI.
3. Use `reconstructLegacyImageAssets` only when
   `trace_schema_version` is null. A traced version with no hero row shows an
   unavailable state instead of an inferred image set.
4. Show only aggregate ready, running, failed, or canceled status. Never display
   stored failure codes, backend messages, selection rationale, or trace errors.
5. Keep trace capture and owner-readable database rows unchanged for this
   presentation-layer story.

## Reasoning

1. A client environment flag is compiled into the browser bundle and is not an
   authorization boundary. Keeping the renderer and clipboard path would retain
   an avoidable disclosure mechanism.
2. Selecting `attached_images` rather than `*` keeps prompts, model IDs,
   provider settings, manifests, artifacts, and failure metadata out of the
   application's network payload as well as its rendered output.
3. Hero attachments record the image-generation call's actual image set.
   Reconstructing a newer but incomplete trace could present candidates as
   images that were used; legacy rows have no exact trace and therefore still
   need the bounded best-effort reconstruction.
4. Raw pipeline failures are unstable implementation details and can disclose
   providers or internal codes. Static product copy gives the user the relevant
   outcome without leaking diagnostics.
5. Moving diagnostics behind a server-only boundary requires backend access
   design and migration work outside the approved presentation scope.

## Follow-ups

- If trace confidentiality must cover owners making direct authenticated data
  API queries, move diagnostic fields behind a server-only role or a
  purpose-built privileged endpoint. Current owner RLS still permits direct
  access to the stored trace row.
