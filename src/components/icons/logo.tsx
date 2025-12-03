import { FlaskConical } from 'lucide-react';
import type { LucideProps } from 'lucide-react';

export const Logo = ({ className, ...props }: LucideProps) => {
  return <FlaskConical className={className} {...props} />;
};
