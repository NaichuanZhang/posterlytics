# Editor reference image reuse

## Backlog item

**Poster editor: Generate version grayed out for text-only creative redirection**

Reuse a reference-only campaign's current images when the next version adds
direction but no replacement images.

## Decisions

1. The editor resubmits a copy of the campaign's nonblank-URL reference images
   for `social_cover` and `rednote_post` when no pending image is attached.
2. A nonempty pending set remains a complete replacement set. Persisted and
   pending images are never added together, preserving the five-image limit.
3. The required-image minimum is never waived. First versions and later
   campaigns with no usable persisted or pending references remain blocked.
4. Social cover and RedNote share the reuse policy. RedNote continues to
   require draft copy.
5. Persisted `brand_assets` do not count toward the reference minimum.
6. Persisted references count toward editor validity but are not rendered as
   removable inputs. Removal needs explicit exclusion and draft semantics.
7. One blocker controls the runtime guard, button disabled state, and visible
   `aria-describedby` hint. The creation wizard remains unchanged.

## Reasoning

`enqueue_poster_generation` writes `p_reference_images` directly to the new
generation and hard-rejects an empty or blank-URL set for Social cover and
RedNote. Resubmission is therefore required first to pass enqueue validation.
It also grounds analyze, because reference-only acquisition performs no fetch
or capture and analyze reads visual evidence from the new generation's
`reference_images`. Completion and version activation copy that snapshot back
to the campaign, preserving the current references.

Skipping the minimum for every later version was rejected because it would
allow zero-reference campaign anomalies through the editor. Counting
`brand_assets` was rejected because neither the enqueue guard nor the
reference-only analyze contract treats them as required user references.

## Follow-ups

- Design persisted-reference exclusion and removal as a separate editor
  feature, including local-draft semantics.
