import { insforge } from './insforge'
import { safeReferenceFilename } from './references'
import type { ReferenceImage } from './types'

const BUCKET = 'assets'

export async function uploadReferenceImages(
  userId: string,
  campaignId: string,
  files: readonly File[],
): Promise<ReferenceImage[]> {
  const uploaded: ReferenceImage[] = []

  try {
    for (const file of files) {
      const key = `references/${userId}/${campaignId}/${crypto.randomUUID()}-${safeReferenceFilename(file.name)}`
      const { data, error } = await insforge.storage.from(BUCKET).upload(key, file)
      if (error || !data) throw new Error(error?.message ?? `Could not upload ${file.name}`)

      uploaded.push({
        key: data.key,
        url: data.url,
        name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      })
    }
    return uploaded
  } catch (error) {
    await deleteReferenceImages(uploaded)
    throw error
  }
}

export async function deleteReferenceImages(images: readonly Pick<ReferenceImage, 'key'>[]): Promise<void> {
  await Promise.allSettled(images.map((image) => insforge.storage.from(BUCKET).remove(image.key)))
}
