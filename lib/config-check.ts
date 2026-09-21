/**
 * What is wrong with this deployment, in words somebody can act on.
 *
 * Every problem here used to surface as "Something went wrong" from a route handler,
 * which tells a person nothing and costs them an afternoon. Each entry names the exact
 * variable and the exact place to set it.
 */
export type ConfigProblem = {
  severity: 'blocking' | 'warning';
  title: string;
  detail: string;
};

export function configProblems(env: Record<string, string | undefined> = process.env): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const onVercel = Boolean(env.VERCEL);

  if (!env.DATABASE_URL) {
    problems.push({
      severity: 'blocking',
      title: 'No database is configured',
      detail: onVercel
        ? 'Add Storage → Create Database → Neon (Postgres) in your Vercel project, then redeploy. The integration sets DATABASE_URL for you.'
        : 'DATABASE_URL is not set. Run `npm run db:up`, then copy the printed line into .env.',
    });
  }

  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16) {
    problems.push({
      severity: 'blocking',
      title: 'SESSION_SECRET is missing or too short',
      detail: onVercel
        ? 'Add SESSION_SECRET in Vercel → Settings → Environment Variables. Generate one with: openssl rand -hex 32'
        : 'Set SESSION_SECRET in .env to at least 16 characters. `cp .env.example .env` gives you a development default.',
    });
  }

  if (onVercel && !env.BLOB_READ_WRITE_TOKEN) {
    problems.push({
      severity: 'warning',
      title: 'Photos are being stored in the database',
      detail:
        'That works and needs no setup. For anything beyond a prototype, add Storage → Create → Blob in Vercel: object storage is cheaper per byte and keeps large blobs out of your database backups. The switch is automatic and existing photos keep working.',
    });
  }

  if (!env.EXTRACTION_PROVIDER && onVercel) {
    problems.push({
      severity: 'blocking',
      title: 'No reader is configured — nothing you photograph is being read',
      detail:
        'EXTRACTION_PROVIDER is not set on this deployment. Set it to "anthropic" with ANTHROPIC_API_KEY to read real handwriting. In Vercel, tick EVERY environment when you add a variable: a preview deployment does not see variables added for Production only.',
    });
  }

  if (env.EXTRACTION_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    problems.push({
      severity: 'blocking',
      title: 'Claude vision is switched on but has no API key',
      detail:
        'EXTRACTION_PROVIDER=anthropic needs ANTHROPIC_API_KEY alongside it. Add the key, or remove EXTRACTION_PROVIDER to go back to the offline mock reader.',
    });
  }

  if (env.EXTRACTION_PROVIDER && env.EXTRACTION_PROVIDER !== 'anthropic' && env.EXTRACTION_PROVIDER !== 'mock') {
    problems.push({
      severity: 'blocking',
      title: `Unknown EXTRACTION_PROVIDER "${env.EXTRACTION_PROVIDER}"`,
      detail: 'It must be "mock" (the default) or "anthropic".',
    });
  }

  if (env.EXTRACTION_PROVIDER === 'mock' || (!env.EXTRACTION_PROVIDER && !onVercel)) {
    problems.push({
      severity: 'warning',
      title: 'Using the offline sample reader',
      detail:
        'No handwriting is being read. One of three fixed sample notes is replayed whatever you photograph, so any reading you see is invented. Set EXTRACTION_PROVIDER=anthropic and ANTHROPIC_API_KEY to read real photos.',
    });
  }

  return problems;
}

export function blockingProblems(env?: Record<string, string | undefined>): ConfigProblem[] {
  return configProblems(env).filter((p) => p.severity === 'blocking');
}
