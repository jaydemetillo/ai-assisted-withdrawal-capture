import { PhoneFrame } from '@/components/PhoneFrame';

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <PhoneFrame>{children}</PhoneFrame>;
}
