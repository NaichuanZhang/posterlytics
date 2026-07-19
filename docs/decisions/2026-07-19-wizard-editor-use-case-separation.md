# Wizard and editor use-case separation

## Backlog item

**Wizard + editor use-case separation: picker and per-use-case forms**

Goal: make campaign intent explicit before creation and keep website and Amazon
inputs separate through creation and regeneration.

## Decisions

1. Campaign creation starts with a leading card picker, not permanently visible
   inline cards. Only `website_product` and `amazon_listing` are shown. The
   non-creatable `event` entry and the not-yet-registered `social_cover` use
   case are deliberately absent.
2. The selected registry entry's `inputFields` requirements control field
   visibility, required markers, source validation, and reference controls.
   The website form retains its existing section order, labels, placeholders,
   optional markers, and behavior.
3. Amazon listing copy and product or brand images move ahead of campaign
   action as primary inputs. This is a hierarchy and copy change, not a
   validation change: both remain optional because the registry still declares
   them optional.
4. An Amazon destination is prefilled from the listing URL only when the
   destination is blank. Prefill runs on source blur, on a switch to Amazon,
   and defensively before draft persistence. It never overwrites an entered
   destination and preserves the seller URL's existing query bytes.
5. A valid source from the opposite use case shows an inline one-click switch.
   Submission remains blocked until intent and source match. A switch preserves
   entered fields; the next draft update writes `product_url` and `use_case`
   together. This client guard complements, and does not replace, server
   validation.
6. The editor resolves reference labels, the Amazon notice, and allowed poster
   formats from persisted `campaign.use_case`. Its format options are the
   registry allowance unioned with the campaign's current format, so future
   restrictions cannot strand a historical campaign.
7. Format filtering is intentionally a no-op in v1 because website and Amazon
   both allow every registered format. The filtering seam and generic
   grandfathering are present without a `rednote_cover_3x4` special case.
8. Picker and per-use-case copy are catalog-backed in English and transcreated
   Chinese; no source-literal audit exception is added.

## Reasoning

1. A separate first step makes intent explicit without consuming permanent form
   space or suggesting that use cases can be combined.
2. One registry-driven rendering contract prevents field policy from drifting
   between use cases while characterization smoke assertions protect website
   parity.
3. Amazon generation treats seller references as primary evidence, but making
   them newly mandatory would change the Rank 3 server contract and reject
   previously accepted inputs.
4. Blur-time prefill is visible before submission, while blank-only behavior
   protects seller attribution links and deliberate off-listing destinations.
5. An explicit switch is reversible and safe during the pre-generation draft
   window. Atomic persistence matches the database guard that freezes source
   intent after the first generation.
6. Persisted intent is authoritative in the editor. Unioning the current format
   is safer than naming one legacy exception and remains correct as the
   registry evolves.
7. Wiring filtering now establishes the editor contract without inventing a
   product restriction that neither v1 use case declares.

## Follow-ups

- Add `social_cover` only with its complete source, prompt, format, persistence,
  and tracking behavior.
- Keep event creation retired unless a dedicated event creation contract is
  designed.
