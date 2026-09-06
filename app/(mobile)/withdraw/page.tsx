import Link from 'next/link';
import { StatusBar } from '@/components/PhoneFrame';
import { BottomTabBar } from '@/components/BottomTabBar';
import { EmptyState } from '@/components/EmptyState';

export default function WithdrawPage() {
  return (
    <>
      <StatusBar />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(7rem+var(--safe-b))] pt-4">
        <h1 className="text-2xl font-bold text-brand-600">Withdraw</h1>
        <div className="mt-6">
          <EmptyState
            title="Not part of this prototype"
            blurb="This build focuses on capturing a handwritten list and turning it into stock movements."
          />
        </div>
        <Link href="/scan" className="mt-4 block rounded-full bg-brand-600 py-3.5 text-center text-sm font-semibold text-white">
          Capture a written list
        </Link>
      </div>
      <BottomTabBar />
    </>
  );
}
