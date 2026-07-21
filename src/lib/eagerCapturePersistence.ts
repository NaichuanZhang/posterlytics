import type { CapturePreview } from './capturePreview'
import type { DeviceColorScheme } from './colorScheme'
import {
  buildEagerCapturePatch,
  clearEagerCapturePatch,
  eagerStyleBoardBlob,
  eagerStyleBoardKey,
  matchEagerCaptureForAdoption,
  type EagerCaptureAdoptionReason,
} from './eagerCapture'
import { insforge } from './insforge'
import type { CreatableUseCaseId } from './useCases'

const BUCKET = 'assets'
export const EAGER_CAPTURE_SYNC_TIMEOUT_MS = 4_000

export type EagerCaptureSyncResult =
  | {
      status: 'adopted'
      reason: 'eligible'
      screenshotKey: string
    }
  | {
      status: 'cleared'
      reason: Exclude<EagerCaptureAdoptionReason, 'eligible'>
    }

export class EagerCaptureSyncError extends Error {
  readonly code: 'upload_failed' | 'campaign_update_failed' | 'timeout'

  constructor(
    code: EagerCaptureSyncError['code'],
    message: string,
  ) {
    super(message)
    this.name = 'EagerCaptureSyncError'
    this.code = code
  }
}

export async function syncEagerCaptureEvidence({
  campaignId,
  productUrl,
  useCase,
  colorScheme,
  preview,
  nowMs = Date.now(),
}: {
  campaignId: string
  productUrl: string
  useCase: CreatableUseCaseId
  colorScheme: DeviceColorScheme
  preview: CapturePreview | null
  nowMs?: number
}): Promise<EagerCaptureSyncResult> {
  const match = matchEagerCaptureForAdoption({
    preview,
    productUrl,
    useCase,
    colorScheme,
    nowMs,
  })

  return withTimeout(
    match.matched
      ? adoptCapture(campaignId, match.preview)
      : clearCapture(campaignId, match.reason),
    EAGER_CAPTURE_SYNC_TIMEOUT_MS,
  )
}

async function adoptCapture(
  campaignId: string,
  preview: CapturePreview,
): Promise<EagerCaptureSyncResult> {
  const captureId = preview.captureId
  if (!captureId || !preview.styleBoardDataUrl) {
    throw new EagerCaptureSyncError(
      'upload_failed',
      'Capture evidence is incomplete.',
    )
  }
  let key: string
  let blob: Blob
  try {
    key = eagerStyleBoardKey(campaignId, captureId)
    blob = eagerStyleBoardBlob(preview.styleBoardDataUrl)
  } catch {
    throw new EagerCaptureSyncError(
      'upload_failed',
      'Eager style-board preparation failed.',
    )
  }
  await insforge.storage.from(BUCKET).remove(key).catch(() => null)
  const { data, error } = await insforge.storage.from(BUCKET).upload(key, blob)
  if (error || !data) {
    throw new EagerCaptureSyncError(
      'upload_failed',
      'Eager style-board upload failed.',
    )
  }

  let patch: ReturnType<typeof buildEagerCapturePatch>
  try {
    patch = buildEagerCapturePatch(campaignId, preview, data)
  } catch {
    await insforge.storage.from(BUCKET).remove(data.key).catch(() => null)
    throw new EagerCaptureSyncError(
      'upload_failed',
      'Eager style-board provenance validation failed.',
    )
  }
  const { error: updateError } = await insforge.database
    .from('campaigns')
    .update(patch)
    .eq('id', campaignId)
  if (updateError) {
    await insforge.storage.from(BUCKET).remove(data.key).catch(() => null)
    throw new EagerCaptureSyncError(
      'campaign_update_failed',
      'Eager campaign evidence update failed.',
    )
  }

  return {
    status: 'adopted',
    reason: 'eligible',
    screenshotKey: data.key,
  }
}

async function clearCapture(
  campaignId: string,
  reason: Exclude<EagerCaptureAdoptionReason, 'eligible'>,
): Promise<EagerCaptureSyncResult> {
  const { error } = await insforge.database
    .from('campaigns')
    .update(clearEagerCapturePatch())
    .eq('id', campaignId)
  if (error) {
    throw new EagerCaptureSyncError(
      'campaign_update_failed',
      'Eager campaign evidence clear failed.',
    )
  }
  return { status: 'cleared', reason }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new EagerCaptureSyncError(
            'timeout',
            'Eager capture persistence timed out.',
          ))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== null) clearTimeout(timeout)
  }
}
