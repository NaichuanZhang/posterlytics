# Generic poster format names

## Backlog item

**Generic poster format names — geometry-only labels + filename suffixes**

Goal: name poster formats by geometry while keeping their persisted identities
and rendering behavior unchanged.

## Decisions

1. Replace platform-branded format labels with geometry-only labels. Platform
   recommendations belong to a use-case layer, not the format registry.
2. Name the bandless 3:4 format "Portrait 3:4 full bleed." "Cover" describes a
   use case, while "full bleed" describes the format's edge-to-edge geometry.
3. Rename export filename suffixes as follows:

| Slug | Old suffix | New suffix |
| --- | --- | --- |
| `rednote_3x4` | `RedNote-3x4` | `Portrait-3x4` |
| `rednote_cover_3x4` | `RedNote-Cover-3x4` | `FullBleed-3x4` |
| `yt_thumb_16x9` | `YouTube-16x9` | `Landscape-16x9` |
| `luma_1x1` | `Luma-1x1` | `Square-1x1` |

4. Keep the historical platform-derived database slugs. They are frozen
   identifiers in check constraints and generation snapshots, not display copy.
5. Existing downloaded files remain unchanged; future exports and re-exports
   use the new live-registry suffixes.

## Reasoning

Geometry is stable across use cases, while platform targets can change or
overlap. Separating those concepts avoids embedding channel intent in format
identity. Retaining the slugs preserves database and historical-generation
compatibility without a migration.

## Follow-ups

- Add platform recommendations only with the future use-case guidance layer.
