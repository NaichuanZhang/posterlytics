# Amazon seller reference mode

## Backlog item

**亚马逊产品广告 poster - Amazon listing -> ad creative**

Goal: accept an Amazon listing URL as the source for a brand-grounded,
off-Amazon tracked poster without claiming reliable listing scraping or
unverified Amazon-native ad formats.

## Decisions

1. Ship a seller-reference recipe for the existing tracked-poster loop. Sellers
   provide listing copy in generation context and up to five product or brand
   images through `GenerationReferences`.
2. Classify only exact HTTP(S) hosts: `amazon.com`, `www.amazon.com`, `a.co`,
   `amzn.to`, `amzn.asia`, and `amzn.eu`. Lookalike suffixes, arbitrary Amazon
   subdomains, regional listing domains, and bare ASINs are not classified.
3. For a classified Amazon source, `analyze` skips both the raw HTML fetch and
   capture-service request. Seller references become primary evidence. An
   Amazon refresh clears inherited `screenshot_url`/`screenshot_key`,
   `design_tokens`, and discovered `brand_assets` on the new generation; it
   does not delete storage objects referenced by the parent or another
   campaign.
4. Show proactive, localized guidance in both campaign creation and the poster
   editor. Do not rely on an analyze error: Amazon CAPTCHA or block pages can
   return successful HTTP and Playwright responses and masquerade as valid
   source evidence.
5. Do not register Sponsored Brands 1200x628. `aiImage` forwards a descriptor's
   arbitrary `image_config.aspect_ratio` string to the configurable
   `OPENROUTER_IMAGE_MODEL`, whose default is
   `google/gemini-2.5-flash-image`, but this repository verifies only `1:1`,
   `2:3`, `3:4`, and `16:9`. `AiPoster` uses uncropped `object-fit: contain` and
   assumes provider artwork and descriptor ratios agree. A nearby-ratio crop or
   letterbox is unacceptable until Amazon safe areas, whitespace, border, and
   policy validation are designed and tested.
6. Preserve existing Amazon Attribution query bytes exactly. Parse the URL only
   for validation and existing UTM-key detection, then append missing
   Posterlytics UTM pairs to the raw pre-fragment query instead of serializing
   owner-provided parameters through `URLSearchParams`.
7. Add no format, schema, migration, scraper integration, or policy-validation
   infrastructure in this scope. Existing landscape formats remain
   off-Amazon poster outputs and are not labeled Amazon-native.

## Reasoning

1. `GenerationReferences` already provides the required 4,000-character text
   input and five durable image references, so the useful seller workflow ships
   without new credentials or infrastructure.
2. Exact host matching prevents attacker-controlled names such as
   `amazon.com.example` from entering a trusted special path. A small explicit
   list also avoids silently claiming support for untested regional storefronts.
3. A CAPTCHA screenshot is worse than missing evidence because downstream
   models can treat it as brand truth. Clearing only the new snapshot keeps the
   generation honest while preserving immutable parent history and the
   existing campaign-level storage cleanup contract.
4. Guidance at input time tells sellers what evidence generation will actually
   use. Error-path copy would often never appear because blocked responses look
   technically successful.
5. A registry entry represents a verified provider, render, export, and policy
   contract. Neither exact `300:157` support nor a compliant fallback
   composition is established, so adding the slug would overstate capability.
6. Amazon Attribution values may contain meaningful percent-encoded bytes.
   Parsing remains useful for UTM ownership rules, but reserialization can
   change `%20` to `+`; raw append preserves the owner's destination verbatim.

## Follow-ups

- Integrate Product Advertising API only after this project has an eligible
  Amazon Associates account and a reviewed credential/data-use design.
- Evaluate an Apify-style scraper only after cost, block rate, data quality,
  and operational ownership are measured.
- Design deterministic Amazon ad templates and policy validation for legible
  text, substantiated claims, borders, whitespace, and safe areas.
- Add bare-ASIN input only with an explicit marketplace-resolution contract.
- Add regional Amazon listing domains only after each marketplace is tested and
  represented deliberately in the classifier.
- Revisit Sponsored Brands 1200x628 only after exact provider-ratio support is
  verified and compliant crop/letterbox behavior exists.
- Lifestyle/A+ imagery and brand-store banners remain separate Amazon-native
  format stories.
