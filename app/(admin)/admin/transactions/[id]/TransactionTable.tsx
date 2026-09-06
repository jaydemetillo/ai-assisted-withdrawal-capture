'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { EvidenceModal } from '@/components/EvidenceModal';
import { ACTION_COPY, type Action } from '@/lib/constants';

type Line = {
  id: string; itemId: string; itemName: string; description: string;
  expiryDate: string | null; imageUrl: string; quantity: number; remarks: string;
  rawText: string; confidence: number; matchStatus: string;
  bbox: [number, number, number, number] | null; stockNow: number;
};

export function TransactionTable({
  transactionId, action, reference, voided, storeroomName, photo, transcript, evidence, catalogue, lines: initial,
}: {
  transactionId: string;
  action: Action;
  reference: string;
  voided: boolean;
  storeroomName: string;
  photo: string | null;
  transcript: string;
  evidence: { reference: string; capturedBy: string; capturedAt: string; reason: string; provider: string; model: string };
  catalogue: { id: string; name: string }[];
  lines: Line[];
}) {
  const router = useRouter();
  const copy = ACTION_COPY[action];

  const [lines, setLines] = useState(initial);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = lines.filter(
    (l) =>
      !query ||
      l.itemName.toLowerCase().includes(query.toLowerCase()) ||
      l.remarks.toLowerCase().includes(query.toLowerCase()),
  );

  async function save(line: Line, patch: { itemId?: string; quantity?: number; remarks?: string }) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/transactions/${transactionId}/lines/${line.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? 'Could not save');
      setEditing(null);
      // The correction changes stock levels elsewhere on the page, so re-fetch rather
      // than patching local state and letting the two drift apart.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-6 py-4">
      <div className="flex items-center gap-2 text-xs">
        <Link href="/admin/history" className="rounded p-1 hover:bg-white" aria-label="Back">
          <Icon name="left-arrow-alt" size={16} />
        </Link>
        <Link href="/admin/history" className="text-brand-600">Back</Link>
        <span className="text-divider-strong">/</span>
        <span className="font-medium text-content-medium">Transaction details</span>
      </div>

      <div className="mt-3 flex items-baseline gap-3">
        <h1 className="text-[32px] font-bold text-primary-600">{copy.past}</h1>
        <span className="text-sm text-content-medium">{reference}</span>
        {voided && <span className="rounded bg-critical/20 px-2 py-0.5 text-xs font-semibold text-critical">Reversed</span>}
      </div>

      {error && <p className="mt-2 text-sm text-critical">{error}</p>}

      <section className="mt-5 rounded-2xl bg-white shadow-sm2">
        <header className="flex h-[54px] items-center justify-between border-b border-divider-medium px-4">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">
            {copy.past} from {storeroomName}
          </h2>
          <div className="flex items-center gap-3">
            <label className="flex h-[30px] w-[230px] items-center gap-2 rounded-lg bg-[#ededed]/60 px-3">
              <Icon name="search" size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                aria-label="Search rows"
                className="w-full bg-transparent text-[13px] text-content outline-none placeholder:text-content"
              />
            </label>
            <Icon name="filter" size={16} />
          </div>
        </header>

        <table className="w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="border-b border-divider-medium bg-canvas-alt text-[13px] font-semibold text-content-table">
              <th scope="col" className="w-[22%] px-4 py-3">Item name</th>
              <th scope="col" className="w-[9%] px-2 py-3">Photo</th>
              <th scope="col" className="w-[20%] px-2 py-3">Descriptions</th>
              <th scope="col" className="w-[11%] px-2 py-3 text-center">Expiry date</th>
              <th scope="col" className="w-[10%] px-2 py-3 text-center">{copy.columnHeader}</th>
              <th scope="col" className="w-[28%] px-2 py-3">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((line) => {
              const isEditing = editing === line.id;
              return (
                <tr key={line.id} className="border-b border-divider-medium align-middle">
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <select
                        defaultValue={line.itemId}
                        onChange={(e) => save(line, { itemId: e.target.value })}
                        className="w-full rounded border border-divider-medium px-2 py-1 text-sm"
                      >
                        {catalogue.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : (
                      <span className="text-sm font-semibold text-content-strong">{line.itemName}</span>
                    )}
                  </td>

                  <td className="px-2 py-3">
                    {photo ? (
                      <button
                        type="button"
                        onClick={() => setShowEvidence(true)}
                        aria-label="Open the photographed list"
                        className="block h-9 w-[66px] overflow-hidden rounded border border-divider-medium transition-transform hover:scale-105"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo} alt="" className="size-full object-cover" />
                      </button>
                    ) : (
                      <span className="text-xs text-content-medium">—</span>
                    )}
                  </td>

                  <td className="truncate px-2 py-3 text-sm text-content-medium" title={line.description}>
                    {line.description || '—'}
                  </td>

                  <td className="px-2 py-3 text-center text-sm text-[#474747]">{line.expiryDate ?? '—'}</td>

                  <td className="px-2 py-3 text-center">
                    {isEditing ? (
                      <input
                        type="number"
                        min={1}
                        defaultValue={line.quantity}
                        onBlur={(e) => save(line, { quantity: Number(e.target.value) })}
                        className="w-16 rounded border border-divider-medium px-2 py-1 text-center text-sm"
                      />
                    ) : (
                      <span className="text-sm font-medium text-brand-600">-{line.quantity}</span>
                    )}
                    <span className="mt-0.5 block text-[10px] text-content-medium">{line.stockNow} left</span>
                  </td>

                  <td className="px-2 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm text-content-medium" title={line.remarks}>
                        {line.remarks || '—'}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === line.id ? null : line.id)}
                          className="rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-600"
                        >
                          {expanded === line.id ? 'Collapse' : 'Expand'}
                        </button>
                        <button
                          type="button"
                          disabled={saving || voided}
                          onClick={() => setEditing(isEditing ? null : line.id)}
                          className="rounded border border-divider-medium px-2 py-1 text-xs font-medium text-content-medium disabled:opacity-40"
                        >
                          {isEditing ? 'Done' : 'Edit'}
                        </button>
                      </span>
                    </div>

                    {expanded === line.id && (
                      <div className="mt-2 rounded-lg bg-canvas-alt p-3 text-xs text-content-medium">
                        <p><strong className="font-semibold text-content-strong">Written on the note:</strong> &ldquo;{line.rawText || '—'}&rdquo;</p>
                        <p className="mt-1">
                          <strong className="font-semibold text-content-strong">Read with:</strong>{' '}
                          {Math.round(line.confidence * 100)}% confidence
                          {line.matchStatus === 'CORRECTED' && ' · corrected by an admin'}
                        </p>
                        <textarea
                          defaultValue={line.remarks}
                          placeholder="Add a remark…"
                          onBlur={(e) => e.target.value !== line.remarks && save(line, { remarks: e.target.value })}
                          className="mt-2 w-full rounded border border-divider-medium p-2 text-xs"
                          rows={2}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-content-medium">No rows match &ldquo;{query}&rdquo;.</p>
        )}
      </section>

      {photo && (
        <EvidenceModal
          open={showEvidence}
          onClose={() => setShowEvidence(false)}
          photo={photo}
          transcript={transcript}
          meta={evidence}
          chips={lines.map((l) => ({
            id: l.id,
            bbox: l.bbox,
            label: l.itemName,
            quantity: l.quantity,
            needsReview: l.confidence > 0 && l.confidence < 0.75,
          }))}
        />
      )}
    </div>
  );
}
