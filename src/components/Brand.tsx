import { REPOCAT_TAGLINE } from '@/lib/brand'

export function Brand({ heading = false }: { heading?: boolean }) {
  const Name = heading ? 'h1' : 'span'
  return <>
    <span className="brand-mark">R</span>
    <div className="brand-copy"><Name className="brand-name">Repocat</Name><span className="brand-tagline">{REPOCAT_TAGLINE}</span></div>
  </>
}
