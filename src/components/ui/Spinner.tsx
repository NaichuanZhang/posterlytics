export function Spinner({ full = false }: { full?: boolean }) {
  return (
    <div className={`spinner-wrap${full ? ' full' : ''}`} role="status" aria-label="Loading">
      <div className="spinner" />
    </div>
  )
}
