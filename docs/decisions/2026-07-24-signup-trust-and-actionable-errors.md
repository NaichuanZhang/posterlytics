# Signup trust and actionable authentication errors

Add signup-only legal consent with factual public policies and mode-aware actionable authentication failures while preserving generic sign-in credential disclosure.

## Backlog item

**Order 135: Signup trust/UX gaps**

Goal: give new users clear policy links and actionable signup failures without turning sign-in into an account-enumeration signal.

## Decisions

1. Show consent directly below the Create account button and link to public `/terms` and `/privacy` routes only in signup mode.
2. Keep both policies short and factual to the personal demo: acceptable use and as-is availability for Terms; authentication email, submitted inputs, owner-scoped records, hashed visitor identifiers, visit dimensions, and public assets or links for Privacy.
3. Classify duplicate-account, rate-limit, and weak-password failures by stable InsForge codes and status, with a bounded weak-password message fallback.
4. Preserve the existing credential classifier as the first branch, including status `401`, and mask any duplicate-account classification received in sign-in mode as invalid credentials.
5. Keep classification mode-agnostic and put all mode-specific copy and affordances in an exhaustive immutable presentation matrix.
6. Localize all new visible copy in English and Simplified Chinese and keep the legal pages in the existing public visual system.
7. Add no backend, schema, migration, generated-function, or dependency changes.

## Reasoning

Signup must already reject a registered email, so explaining that result and offering sign-in or recovery makes the existing response useful. Sign-in remains deliberately generic for invalid credentials and unexpected duplicate-account responses.

Stable codes avoid coupling product copy to backend prose. Status `429` catches generic throttling, while the bounded password regex handles policy responses that arrive without the expected code.

Local public pages are the only honest link target because no external policies exist. Restricting their claims to verified storage, RLS, and visit-logging behavior avoids invented commercial terms.

## Follow-ups

- Revisit the six-character client password minimum in a separate password-policy story.
- Replace the opaque hosted domain with a canonical product domain in a separate hosting story.
