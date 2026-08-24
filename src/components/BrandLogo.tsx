import Image from 'next/image'

interface BrandLogoProps {
  className?: string
  priority?: boolean
}

export default function BrandLogo({ className = '', priority = false }: BrandLogoProps) {
  return (
    <Image
      src="/cronovia-logo-transparent.png"
      alt="Cronovia"
      width={1581}
      height={228}
      priority={priority}
      className={`h-auto w-full ${className}`}
    />
  )
}
