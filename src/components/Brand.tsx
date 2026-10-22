import Image from 'next/image'

export function Brand({ heading = false }: { heading?: boolean }) {
  const Name = heading ? 'h1' : 'span'
  return <>
    <Image className="brand-mark" src="/repolight-mark.svg" width={36} height={36} alt="" aria-hidden="true" priority />
    <span className="brand-copy">
      <Name className="brand-name">RepoLight</Name>
      <span className="brand-tagline">See how code takes shape.</span>
    </span>
  </>
}
