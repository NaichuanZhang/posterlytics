# Bilingual product-surface internationalization

## Backlog item

**Bilingual `en-US` / `zh-CN` frontend internationalization**

Goal: make every fixed user-facing application and tracked-link status string
available in English and Simplified Chinese while preserving existing English
behavior and generated poster content.

## Decisions

1. Use the existing English source copy as typed message IDs. Derive
   `TranslationKey` from that list, keep `enUS` as an identity map, and require
   `zhCN` to satisfy `Record<TranslationKey, string>`.
2. Resolve locale once at the application root through `I18nProvider`, backed by
   a single `WorkspacePreferencesProvider`. Persist locale in
   `posterlytics.workspace.v1`, repair legacy values, fall back to browser
   language, and synchronize storage events across tabs.
3. Offer the same language selector in the public navigation, sign-in header,
   and authenticated rail. Update the document `lang` attribute with the active
   locale.
4. Localize fixed UI copy, accessibility text, fallback errors, dates, numbers,
   generation statuses, and trace labels. Preserve user, backend, and AI data as
   supplied.
5. Keep completed-poster CTA/default copy in `AiPoster` unchanged. It remains
   campaign or generated-poster content rather than application chrome.
6. Enforce source-string coverage with a TypeScript AST test. Its allowlist is
   exact by file, context, text, and count, and is restricted to invariant brand
   names, URLs, prompts/data, and generated-poster copy.
7. Pin the existing marketing, durable-generation, and asset-review Playwright
   scenarios to `en-US`. Add a separate `zh-CN` marketing/sign-in scenario for
   browser detection, persistence, Chinese copy, and document language.
8. Localize the public `view` function's missing-link and unpublished-poster
   pages with a self-contained message map. Negotiate the locale from weighted
   `Accept-Language` values, then emit matching HTML language and response
   headers without importing the SPA catalog into the Deno function.
9. Standardize core product terms as campaign = `推广活动`, placement = `投放点`,
   and visits = `访问量`.

## Reasoning

1. Source-text IDs minimize migration ceremony and preserve readable call sites.
   Opaque IDs would add a naming layer without improving the current two-locale
   workflow. A required Chinese record makes missing parity a compile error.
2. Locale belongs with the existing durable workspace settings. Keeping separate
   preference hooks would permit stale in-memory copies and conflicting storage
   writes; a single provider gives every route one authoritative state.
3. Browser detection gives first-load localization without blocking the user,
   while a visible selector makes the choice reversible before and after
   authentication. Persisting the choice avoids route-specific behavior.
4. Translating only component text would leave error and helper paths partly
   English. Passing locale into pure helpers keeps those paths testable without
   translating runtime data that Posterlytics does not own.
5. Translating completed-poster copy could alter approved campaign output and
   exports. That requires a separate product decision about content language,
   regeneration, and per-version persistence.
6. Search-based checks miss conditional JSX, accessibility attributes, and
   helper-returned strings. AST classification covers those contexts, while
   exact counts prevent the allowlist from becoming a broad escape hatch.
7. Existing smoke assertions are regression contracts for English. Explicit
   locale pinning removes machine-locale variance; a separate Chinese scenario
   verifies localization without weakening those assertions.
8. The tracked-link pages render outside React, so an inline catalog avoids
   coupling Deno's single-file deployment to the SPA module graph. Quality
   weighting respects browser preference order, while `Content-Language` and
   `Vary: Accept-Language` make the selected representation explicit.
9. `推广活动` avoids implying that every campaign is a paid advertisement, unlike
   `广告活动`. `投放点` is shorter and more natural in product UI than the
   operations-heavy `投放点位`. `访问量` clearly names total visits and remains
   distinct from `独立访客`.

## Follow-ups

- Generated poster content, AI prompts, backend-authored messages, and persisted
  campaign copy remain untranslated; content-language support needs its own
  product and data-model design.
- Additional locales, plural-rule selection, and a translation-management
  workflow are deferred until the locale set grows beyond English and Chinese.
- Function deployment, generated function bundles, and project-board updates
  are intentionally excluded from this repository-only change.
