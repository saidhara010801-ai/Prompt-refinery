import Image from 'next/image';
import { cn } from '@/lib/utils';

type LogoProps = {
  variant?: 'wordmark' | 'icon';
  className?: string;
  label?: string;
};

export function Logo({ variant = 'icon', className, label = 'Clarift' }: LogoProps) {
  const assetName = variant === 'wordmark' ? 'logo' : 'icon';

  return (
    <span
      role="img"
      aria-label={label}
      className={cn('relative inline-flex shrink-0', className)}
    >
      <Image
        src={`/brand/clarift-${assetName}-dark.svg`}
        alt=""
        aria-hidden="true"
        fill
        sizes="320px"
        className="object-contain dark:hidden"
      />
      <Image
        src={`/brand/clarift-${assetName}-light.svg`}
        alt=""
        aria-hidden="true"
        fill
        sizes="320px"
        className="hidden object-contain dark:block"
      />
    </span>
  );
}
