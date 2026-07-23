# Campaign-type poster-format reset

## Backlog item

Fix campaign-type switches that silently carry a RedNote full-bleed format into
tracked Website campaigns and remove their QR code and placement tracking.

## Decisions

- Reset the poster format to the destination type's default whenever the
  campaign type changes, even when the current format is allowed by both types.
- Preserve a valid current format when the user opens the campaign-type picker
  and reselects the same type.
- Track the picker origin in a non-persisted ref and clear it after selection or
  local-draft discard.
- Keep allowed restored draft formats unchanged. Existing Website drafts using
  the full-bleed format self-heal after the next cross-type switch.

## Reasoning

- Destination defaults make cross-type behavior deterministic and return
  tracked Website and Amazon campaigns to their A4 QR format.
- Losing an explicit non-default choice across a deliberate type change is an
  intentional tradeoff for the simpler reset policy.
- Same-type reselection is not a type change and should not discard a valid
  explicit choice.
- An allowed Website full-bleed draft does not record whether the format was
  selected intentionally or inherited from the old bug, so rewriting it during
  restore could destroy valid user intent.

## Follow-ups

- Revisit existing allowed full-bleed drafts only if format-choice provenance
  or a product rule forbidding bandless tracked campaigns is introduced.
