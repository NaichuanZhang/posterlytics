import type { ReactNode } from 'react'
import { GenerationActivityProvider } from './GenerationActivityProvider'

export default function AuthenticatedActivityScope({
  children,
}: {
  children: ReactNode
}) {
  return <GenerationActivityProvider>{children}</GenerationActivityProvider>
}
