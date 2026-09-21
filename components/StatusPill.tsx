import type { Decision } from '@prisma/client';

/**
 * The three plain-language buckets from docs/safety-and-decision-rules.md.
 *
 * A percentage is deliberately never shown. "94% confident" invites a nurse to do
 * arithmetic about risk in a corridor; "Needs review" tells them what to do.
 */
const LABELS: Record<Decision, { text: string; className: string }> = {
  eligible: { text: 'High confidence', className: 'pill-ok' },
  needs_review: { text: 'Needs review', className: 'pill-warn' },
  ambiguous: { text: 'Needs review', className: 'pill-warn' },
  restricted: { text: 'Needs supply review', className: 'pill-stop' },
  unmatched: { text: 'Cannot identify', className: 'pill-stop' },
  unreadable: { text: 'Cannot identify', className: 'pill-stop' },
};

export function StatusPill({ decision }: { decision: Decision }) {
  const label = LABELS[decision];
  return <span className={label.className}>{label.text}</span>;
}
