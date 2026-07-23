# Form and route accessibility

## Backlog item

Centralize route and view focus, put reference-only wizard fields in task order, and expose required-field errors without replacing native validation.

## Decisions

- Use `RouteFocusManager` for pathname changes and `useViewFocus` for in-page view transitions. Both defer focus with `requestAnimationFrame`, preserve meaningful focus, and yield to open modal focus traps.
- Order reference-only creation as artwork details, generation references, then artwork output. Keep Website and Amazon output fields inline.
- Use `useRequiredFieldValidity` to reveal programmatic required errors after blur or a validation-attempt epoch.
- Record the first invalid target during captured native `invalid` events, coalesce the attempt in a microtask, and focus it from a layout effect after React commits.
- Keep native required validation. Do not add `noValidate` or cancel `invalid` events.

## Reasoning

- Native validation and the post-commit layout effect cooperate: the browser reports and focuses its first invalid control while React commits `aria-invalid` and deterministic fallback focus.
- The previous reverted attempt disabled native validation with `noValidate` and focused inline before React committed. Keeping native validation and moving fallback focus to a layout effect fixes both failures.
- Name-first source order matches reading and keyboard order for reference-only artwork while avoiding changes to established Website and Amazon workflows.
- These choices address WCAG 2.4.3, 3.3.1, and 3.3.2 without backend, schema, or type changes.

## Follow-ups

None.
