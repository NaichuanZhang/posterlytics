import { insforge } from './insforge'
import { materializePendingReferences } from './referenceMaterialization'
import {
  DEFAULT_LOCALE,
  translate,
  type SupportedLocale,
} from './i18n'
import {
  normalizeReferenceImages,
  safeReferenceFilename,
  type PendingReference,
} from './references'
import type { ReferenceImage } from './types'

const BUCKET = 'assets'

export async function materializeReferenceImages(
  userId: string,
  campaignId: string,
  references: readonly PendingReference[],
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<ReferenceImage[]> {
  return materializePendingReferences(references, {
    uploadFile: async ({ file }) =>
      uploadReferenceImage(userId, campaignId, file, locale),
    importUrl: async (reference) => {
      if (reference.previewStatus !== 'ready') {
        throw new Error(translate(
          locale,
          '{name} must finish loading before generation starts.',
          { name: reference.name },
        ))
      }

      const { data, error } = await insforge.functions.invoke('reference-import', {
        body: { campaignId, url: reference.url },
      })
      if (error) {
        throw new Error(error.message ?? translate(locale, 'Could not import {name}', {
          name: reference.name,
        }))
      }

      const image = normalizeReferenceImages([data], locale)[0]
      if (!image) {
        throw new Error(translate(
          locale,
          'Posterlytics could not read {name}. Remove it and add the image again.',
          { name: reference.name },
        ))
      }
      return image
    },
    remove: deleteReferenceImages,
  })
}

export async function deleteReferenceImages(images: readonly Pick<ReferenceImage, 'key'>[]): Promise<void> {
  await Promise.allSettled(images.map((image) => insforge.storage.from(BUCKET).remove(image.key)))
}

async function uploadReferenceImage(
  userId: string,
  campaignId: string,
  file: File,
  locale: SupportedLocale,
): Promise<ReferenceImage> {
  const key = `references/${userId}/${campaignId}/${crypto.randomUUID()}-${safeReferenceFilename(file.name)}`
  const { data, error } = await insforge.storage.from(BUCKET).upload(key, file)
  if (error || !data) {
    console.error('Reference image upload failed', {
      error,
      hasData: Boolean(data),
    })
    throw new Error(translate(locale, 'Could not upload {name}. Check your connection and try again.', {
      name: file.name,
    }))
  }

  return {
    key: data.key,
    url: data.url,
    name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
  }
}
