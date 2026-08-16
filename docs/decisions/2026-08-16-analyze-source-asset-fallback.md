# Scraped brand assets as analyze evidence when the screenshot carries nothing

## Backlog item

**Source website agentic scraping** — *"screenshots often doesnt work, how about just scraping down
the images + texts"*.

## Verified before implementing

The item's literal ask was already shipped, so this record exists mostly to state what was actually
missing. Four parallel investigations plus adversarial verification agreed on the following, all
re-traced against the code rather than taken from summaries.

- **Text and images are already scraped from raw HTML on every website generation, unconditionally
  and independently of the browser capture.** `acquireProductSource` returns
  `html: await fetchHtml(url)` and `capture: await capture(url, scheme)` as two independent awaits
  (`functions/_sourceAcquisition.ts:92-96`); the eager-reuse branch also fetches HTML (`:144-148`).
  Downstream, `extractAssets(scrapeHtml, productUrl)` (`functions/analyze.ts:315`) and
  `stripToText(scrapeHtml).slice(0, 8000)` (`:433`) both sit outside any capture check. So
  "just scrape the images + texts" would have been a no-op change.
- **The only capture-gated HTML extraction was colors** — `functions/analyze.ts:348`.
- **Capture supplies no copy and no product images at all.** `collectInBrowser` reads
  `getComputedStyle` and bounding rects only (`capture-service/src/capture.ts:345-366`). Its
  contribution is `DesignTokens`, the three-frame style board, and the weighted pixel palette.
- **The premise behind the complaint is nonetheless true, and now measured.** Joining succeeded
  analyze traces against `poster_generations.design_tokens` / `screenshot_url` for
  2026-07-19..07-30 shows capture produced **no evidence in 36 of 41 website attempts (~88%)**, and
  the split is bimodal — no partials. Capture is effectively all-or-nothing in production.
- **The real gap:** `analyze`'s own multimodal candidate list was style board + user references only
  (`functions/analyze.ts:386-408`). With no board and no user uploads, the stage that describes
  observed visual treatment ran as a **text-only** call — while `hero` went on to paint with the
  scraped logo and product images (`functions/hero.ts:288-305`) that analyze was never shown.
- **A second, narrower hole:** a capture returning HTTP 200 with neither tokens nor a board reports
  `error: null` (`functions/_captureSite.ts:151-173`), so `captureSucceeded` was true and the HTML
  color fallback was suppressed for the one "success" that carries nothing.
- **No ADR forbids this.** The recorded rejections of scrape-as-evidence are Amazon-scoped
  (`2026-07-19-amazon-seller-reference-mode.md:19-24`, `2026-07-21-amazon-product-title-assist.md:13-15`,
  `2026-07-25-amazon-reference-image-requirement.md:21-22`). `2026-07-21-single-paid-eager-capture.md:61-64`
  forbids persisting raw HTML and hot-linking source URLs — respected here, since only re-hosted
  URLs are used.

## Decisions

1. **Attach the already-re-hosted scraped logo and product images to the analyze call, and only when
   no style board is attached.** Gated on `!screenshot_url`, so every capture-success and
   inherited-board path stays byte- and behavior-identical.
2. **Reuse the existing re-hosted URLs from `rehostBrandAssets`.** No new fetch, no new evidence
   source, no raw HTML persisted, nothing hot-linked.
3. **Rank them as secondary.** `SOURCE_REFERENCE_PRIORITY` already orders `logo(3)` and `product(4)`
   below `style-board(1)` and `user-reference(2)`, so these can only fill space the primary evidence
   left empty.
4. **Word the purposes to forbid inference.** `analysisSourceLogo` / `analysisSourceImage(index)`
   tell the model to describe only what the image shows and not to infer page layout or palette
   proportions from it.
5. **Gate the color fallback on evidence, not on the status flag** — `hasCapturedEvidence` rather
   than `captureSucceeded` at `functions/analyze.ts:348`.
6. **No prompt bytes change.** The analyze `system`/`user` strings are untouched, so
   `tests/fixtures/pipelinePromptGoldens.json` stays byte-identical. That was the acceptance gate,
   and it held.

## Reasoning

- **Why not take the item literally?** It would have produced no behavior change, and a rewrite of
  the capture-failure fallback would have reversed the recorded "raw HTML color mining is
  capture-failure-only" policy (`CLAUDE.md`, commit `8bb360f`) for nothing.
- **Why show real pixels rather than describe them?** The programmatic/agentic seam says no LLM
  authors color or font extraction. Attaching images the model then *describes* keeps that seam
  intact: the deterministic extractors still own tokens, and the model still only describes what it
  is shown. Feeding HTML/CSS text and asking for a palette would have crossed it.
- **Why secondary rather than a style-board substitute?** A product photo carries the brand's real
  subject but no page layout, palette proportion, or typography evidence. Presenting it as
  page-level evidence would invite exactly the wrong inference, which is why the purpose strings say
  so explicitly.
- **Why gate on `hasCapturedEvidence`?** Mining stays capture-failure-only in the sense that
  matters — it runs exactly when no captured evidence exists. Keying off the status flag left the
  worst case (200 with nothing) with neither captured colors nor mined ones, falling through to a
  model guess.
- **Why not fix capture instead?** That has the higher ceiling given ~88% failure, but both levers
  are out of this item's envelope: keeping the Fly machine warm is an operational config change, and
  a best-effort screenshot after a `goto` timeout was explicitly deferred in
  `2026-07-23-capture-partial-evidence.md:41-47` because it changes the navigation failure contract.
  Folding either in would smuggle a deferred decision through as a bug fix.

## Follow-ups

- **Reduce capture failures at the source (~88% produce no evidence).** The highest-value remaining
  work and its own board item: warm instances, and the deferred best-effort screenshot after a
  `goto` timeout.
- **Raise scrape recall.** `extractAssets` misses `srcset`, `<picture>`, `data-src`, and JSON-LD
  `Product.image`; `stripToText` takes DOM-order text with no `<title>`, `og:description`, heading
  structure, or main-content selection, so nav and cookie banners can consume much of the
  8000-character budget. Deliberately deferred: it is diffuse, and touching the text sources risks
  moving byte-pinned analyze goldens for no guaranteed gain.
- **Harden `fetchProductHtml`** (`functions/_sourceAcquisition.ts:33-50`) to the bounded-reader
  contract in `2026-07-24-amazon-html-prefix-truncation.md:11-18`. It currently has a 5s timeout but
  no byte cap, no per-hop redirect validation, no content-type check, and no private-network guard,
  unlike the capture service. Prerequisite for any future "scrape harder" work; not needed here,
  because this change adds no new fetch.
- **Make capture outcomes queryable.** `functions/_captureSite.ts:32-63` already logs every attempt,
  but only to stdout, so the failure rate above had to be reconstructed from a DB proxy.
- **The wizard capture preview still shows nothing on capture failure** — deliberate per
  `2026-07-21-stateless-capture-preview.md:19-20` (capture runs before HTML acquisition for SSRF
  ordering), pinned by `tests/capturePreview.test.ts:400`. Changing it is an ADR amendment, not a
  bug fix. If the maintainer's "screenshots often don't work" observation came from the preview
  panel, that is the surface, and it remains untouched here.
