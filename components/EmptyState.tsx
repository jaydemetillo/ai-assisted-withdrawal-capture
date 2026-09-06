export function EmptyState({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="rounded-xl border border-dashed border-divider-strong bg-white/60 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-content-strong">{title}</p>
      <p className="mt-1 text-xs text-content-medium">{blurb}</p>
    </div>
  );
}
