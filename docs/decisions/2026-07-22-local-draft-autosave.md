# Local draft autosave

## Backlog item

Persist 30-day user-scoped local drafts for wizard and editor inputs, auto-restore serializable state, guard reload via `beforeunload`; defer the in-app route-blocker dialog (needs a data-router migration) and server/cross-device drafts to follow-ups.

## Decisions

- Save campaign-wizard and poster-editor drafts in versioned, user-scoped `localStorage` envelopes after a 500 ms debounce.
- Auto-restore valid drafts without a resume prompt and expose factual saving state plus an explicit discard action.
- Persist validated URL references and raw-file metadata only. Restored file metadata never satisfies generation reference requirements.
- Persist eager-capture provenance and selection metadata only. The inline JPEG remains in memory, and submit-time adoption keeps the existing URL, freshness, use-case, and color-scheme checks.
- Let the current server platform hint win when it differs from the editor draft's recorded baseline.
- Flush pending content and show the browser's native leave warning on reload or tab close while draft content differs from its baseline or a protected operation is in flight.
- Clear the matching draft after successful enqueue and clear every local campaign/editor draft after sign-out.

## Reasoning

- Local persistence fixes reload, tab-close, and recoverable in-app navigation loss without adding backend schema or authorization surface.
- A bounded, versioned envelope rejects stale, foreign, malformed, and future-dated content while allowing invalid individual URL references to be dropped safely.
- Omitting file bytes and capture JPEGs keeps drafts small and avoids storage-quota failures; explicit file-restoration copy prevents a disabled generation action from being ambiguous.
- Autosave and auto-restore make in-app navigation recoverable, so a router migration is not required for this low-risk slice.
- Server-baseline conflict handling prevents an old local value from overwriting a newer campaign setting.

## Follow-ups

- Add an in-app `useBlocker` confirmation dialog after migrating to a data router.
- Add server-backed drafts with RLS for cross-device restoration.
- Evaluate IndexedDB blob persistence for raw-file references.
- Define multi-tab draft merge and conflict behavior.
- Add explicit cross-device synchronization behavior.
- Clean up server campaign rows left behind when campaign persistence succeeds but generation enqueue fails.
