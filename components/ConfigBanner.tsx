import { blockingProblems } from '@/lib/config-check';

/**
 * Shown at the top of the capture screen when the deployment cannot actually work.
 *
 * The alternative — letting somebody photograph a note and then hit a generic error —
 * wastes their time and teaches them nothing. This names the variable and where to set it.
 */
export function ConfigBanner() {
  const problems = blockingProblems();
  if (problems.length === 0) return null;

  return (
    <div
      className="mb-5 rounded-2xl border border-stop-600/30 bg-stop-50 p-4 text-stop-900"
      role="alert"
    >
      <h2 className="font-bold">
        {problems.length === 1 ? 'This deployment is not set up yet' : 'This deployment is not set up yet'}
      </h2>
      <ul className="mt-2 space-y-2 text-sm">
        {problems.map((problem) => (
          <li key={problem.title}>
            <span className="font-semibold">{problem.title}.</span> {problem.detail}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-stop-900/70">
        Full details at <code className="rounded bg-stop-600/10 px-1">/api/health</code>.
      </p>
    </div>
  );
}
