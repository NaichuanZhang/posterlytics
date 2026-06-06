export function Spinner({ full = false }: { full?: boolean }) {
  return (
    <div className={`spinner-wrap${full ? ' full' : ''}`}>
      <div className="spinner" />
    </div>
  )
}
