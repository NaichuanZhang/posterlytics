/**
 * Who runs Posterlytics, and where a visitor can reach them.
 *
 * These are the project's real, publicly reachable locations — the same GitHub
 * repository this code is published from. They live here, rather than inline in
 * the page, for the reason `publicLimits.ts` exists: a public page must not
 * claim a support route that does not answer. tests/publicContact.test.ts keeps
 * the issue tracker derived from the repository URL so the two cannot drift.
 *
 * No email address is published. A support address that nobody reads is worse
 * than naming the tracker that is actually watched.
 */
export const OPERATOR_NAME = 'Naichuan Zhang'

export const SOURCE_REPOSITORY_URL = 'https://github.com/NaichuanZhang/posterlytics'

export const ISSUE_TRACKER_URL = `${SOURCE_REPOSITORY_URL}/issues`

/** Link text shows the destination, so the target is legible before the click. */
export const SOURCE_REPOSITORY_LABEL = 'github.com/NaichuanZhang/posterlytics'

export const ISSUE_TRACKER_LABEL = `${SOURCE_REPOSITORY_LABEL}/issues`
