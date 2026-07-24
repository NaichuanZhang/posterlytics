# Wizard required-field accessibility parity

## Backlog item

**Order 133: Wizard required-field a11y parity**

Pair native `required` and boolean `aria-required` across every New-campaign required input, including the shared social-cover destination, without expanding custom validation UI.

## Decisions

1. Use a small local `requiredInputProps` helper to derive native `required` and `aria-required` from one boolean for every use-case-driven wizard input.
2. Include tagline in the helper even though current creatable use cases make it optional, so its ARIA state continues to follow its field requirement.
3. Add static `aria-required={true}` to the shared social-cover destination because it is unconditionally required whenever rendered in the wizard or editor.
4. Keep existing native validation, focus handling, visible requirement labels, and product-name inline error behavior unchanged.
5. Cover required and optional serialization through the existing browser smoke.

## Reasoning

Mirroring the same requirement expression into two independent props would be easy to drift. The helper keeps native and ARIA state paired without introducing new validation behavior.

Extending `useRequiredFieldValidity` was rejected because that hook owns `aria-invalid` and blur/submit error visibility, not required-state exposure. Wiring the other fields through it would add state and inline-error concerns outside this accessibility parity fix.

The shared social-cover destination is a native-required input in both render sites, so annotating the shared component closes the same gap without changing its API.

## Follow-ups

Richer inline-error, `aria-invalid`, and `aria-describedby` wiring for required fields other than product name remains separate work because it would expand validation behavior and user-facing error handling.
