import { insforge } from './insforge'
import { materializePendingReferences } from './referenceMaterialization'
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
): Promise<ReferenceImage[]> {
  return materializePendingReferences(references, {
    uploadFile: async ({ file }) => uploadReferenceImage(userId, campaignId, file),
    importUrl: async (reference) => {
      if (reference.previewStatus !== 'ready') {
        throw new Error(`${reference.name} must finish loading before generation starts.`)
      }

      const { data, error } = await insforge.functions.invoke('reference-import', {
        body: { campaignId, url: reference.url },
      })
      if (error) throw new Error(error.message ?? `Could not import ${reference.name}`)

      const image = normalizeReferenceImages([data])[0]
      if (!image) throw new Error(`The imported image metadata for ${reference.name} was invalid.`)
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
): Promise<ReferenceImage> {
  const key = `references/${userId}/${campaignId}/${crypto.randomUUID()}-${safeReferenceFilename(file.name)}`
  const { data, error } = await insforge.storage.from(BUCKET).upload(key, file)
  if (error || !data) throw new Error(error?.message ?? `Could not upload ${file.name}`)

  return {
    key: data.key,
    url: data.url,
    name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
  }
}
