# Amazon Seller Image Requirement

## Backlog item

**Amazon Seller Image Requirement** - Require one seller image for Amazon
creation and reuse valid persisted seller images for later versions.

## Decisions

1. Require at least one seller-provided image when creating an Amazon listing
   campaign.
2. Allow later Amazon generations to reuse valid persisted reference images
   when no replacement images are pending.
3. Keep Amazon outside the reference-only use-case predicate and leave website
   refresh behavior unchanged.
4. Enforce the image minimum in the client, matching the existing Social cover
   and RedNote post posture.

## Reasoning

Amazon pages are intentionally never fetched or captured because reliable
scraping would encounter CAPTCHA and anti-automation controls. This change does
not make Amazon page scraping work. It eliminates the empty asset-review
symptom by requiring at least one seller-provided image, matching Social cover
and RedNote post.

The first version must receive a new image. Later versions may reuse a valid
persisted seller image so regeneration does not regress after the campaign has
already satisfied the requirement. A dedicated reuse predicate adds Amazon to
that behavior without changing reference-only classification or enabling
Amazon website refresh.

## Follow-ups

- Defer `a.co/d/<token>` short-link ASIN and title assistance because it
  requires network redirect expansion. Manual title entry works, and this gap
  does not affect generation assets.
- Consider defense-in-depth enforcement at enqueue or edge boundaries. The
  current client-only minimum matches Social cover and RedNote post.
