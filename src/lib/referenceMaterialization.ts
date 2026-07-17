import type { PendingReference } from './references'
import type { ReferenceImage } from './types'

export interface ReferenceMaterializationOperations {
  uploadFile: (reference: Extract<PendingReference, { kind: 'file' }>) => Promise<ReferenceImage>
  importUrl: (reference: Extract<PendingReference, { kind: 'url' }>) => Promise<ReferenceImage>
  remove: (images: readonly ReferenceImage[]) => Promise<void>
}

export async function materializePendingReferences(
  references: readonly PendingReference[],
  operations: ReferenceMaterializationOperations,
): Promise<ReferenceImage[]> {
  const stored: ReferenceImage[] = []

  try {
    for (const reference of references) {
      const image = reference.kind === 'file'
        ? await operations.uploadFile(reference)
        : await operations.importUrl(reference)
      stored.push(image)
    }
    return stored
  } catch (error) {
    await operations.remove(stored).catch(() => {})
    throw error
  }
}
