# Landing multi-format showcase

## Backlog item

**Order 131: Landing showcase does not prove multi-format generation**

Add an isolated registry-derived CSS format study using an owned fictional
brand, exposing all five supported formats side-by-side with labels, including
QR-footer and full-bleed behavior, without changing existing `SamplePoster`
surfaces or adding media assets; OG metadata remains untouched.

## Decisions

1. Add one unnumbered `#formats` section between the workflow and versions
   sections without changing the existing section indices or navigation.
2. Render the five approved format slugs in an explicit presentation order
   through new `FormatStudy` and `FormatSample` components. Existing hero,
   sign-in, workflow, version, and placement samples remain unchanged.
3. Derive sheet, artwork, matte, QR-band, and QR geometry exclusively from
   `posterSize.ts`. Artwork and QR footer share the centered artwork width, so
   the output sheet retains the renderer's side mattes.
4. Use the fictional `Posterlytics House / Citrus 01` brand with CSS-only
   product artwork and the existing marketing QR asset. Add no image, SVG,
   font, dependency, or third-party brand.
5. Reflow the study from an equal-height desktop shelf to a tablet grid and a
   mobile column. At 375px and below, landscape and square footers show only
   the centered QR to prevent intra-footer clipping.
6. Reuse the registry's existing localized format labels and add bilingual
   catalog entries only for new study and house-brand copy.
7. Cover registry adaptation with unit invariants and cover format presence,
   geometry, footer behavior, localization, and narrow-width containment in
   the marketing browser smoke.

## Reasoning

An isolated study closes the public-evidence gap without changing the
well-covered `SamplePoster` component or its many unrelated callers. Mirroring
the renderer's descriptor geometry keeps the comparison truthful, while an
owned CSS brand avoids provenance, payload, and trademark risk. Removing footer
copy only where the scaled landscape and square bands become too short preserves
the visible QR behavior without truncation or overflow.

## Follow-ups

Replacing Picsum across the hero, sign-in, workflow, version, and placement
surfaces requires a separate visual-redesign decision because it has a broader
regression and asset-review surface.
