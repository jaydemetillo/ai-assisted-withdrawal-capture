import { EmptyState } from '@/components/EmptyState';

export default function ReportsPage() {
  return (
    <div className="px-6 py-8">
      <h1 className="text-[32px] font-bold text-primary-600">Reports</h1>
      <div className="mt-6 max-w-xl">
        <EmptyState
          title="Not part of this prototype"
          blurb="This build covers photographing a handwritten list, reviewing what was read, and recording it against stock."
        />
      </div>
    </div>
  );
}
