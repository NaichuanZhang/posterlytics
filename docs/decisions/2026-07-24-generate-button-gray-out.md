# Generate button gray out

## Backlog item

**Generate button gray out**

Goal: Render disabled application primary buttons with full-opacity neutral tokens and guard the editor blocker state with a computed-style smoke assertion.

## Decisions

1. Apply the neutral disabled treatment globally to native `.button-primary` controls so unavailable primary actions use one consistent affordance.
2. Use `--surface-muted`, `--line-strong`, and `--text-soft` at full opacity, while retaining the shared disabled cursor and transform behavior.
3. Add an explicit `.button-primary:disabled:hover` selector after the normal primary hover rule so hover cannot restore the accent treatment.
4. Keep the existing Generate-version disabled logic and blocker description unchanged.
5. Extend the existing QR lifecycle smoke with deterministic computed-style assertions instead of screenshot comparison.

## Reasoning

A half-opacity saturated accent still reads as actionable, while a full-opacity neutral fill clearly separates unavailable actions from enabled primary actions. The shared app-level rule is appropriate because every disable-capable `.button-primary` represents an action that cannot currently run.

The `border-color: var(--line-strong)` declaration preserves the control boundary on the gray-on-gray inspector, so the disabled button remains visually distinct and a future edit does not drop that boundary. `--text-soft` also keeps the disabled label readable against `--surface-muted`.

The existing native `disabled` attribute, defensive generation guard, and `aria-describedby` relationship already provide the correct functional and accessible behavior. A computed-style smoke assertion directly guards the missing visual affordance and avoids screenshot flakiness.

## Follow-ups

The opacity-based disabled styling for the public authentication `.public-button-primary` in `public.css` is a separate visual system and remains deliberately deferred as out of scope.
