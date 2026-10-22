export function Brand({ heading = false }: { heading?: boolean }) {
  const Name = heading ? 'h1' : 'span'
  return <>
    <span className="brand-mark">R</span>
    <Name className="brand-name">Repocat</Name>
  </>
}
