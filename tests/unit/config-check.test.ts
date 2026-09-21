import { describe, expect, it } from 'vitest';
import { blockingProblems, configProblems } from '@/lib/config-check';

const ok = {
  DATABASE_URL: 'postgresql://localhost/db',
  SESSION_SECRET: 'a-secret-long-enough-to-pass',
  EXTRACTION_PROVIDER: 'anthropic',
  ANTHROPIC_API_KEY: 'sk-ant-test',
};

describe('configProblems', () => {
  it('reports nothing blocking for a correct local setup', () => {
    expect(blockingProblems(ok)).toEqual([]);
  });

  it('catches a missing database, and says where to add one on Vercel', () => {
    const [problem] = blockingProblems({ ...ok, DATABASE_URL: undefined, VERCEL: '1', BLOB_READ_WRITE_TOKEN: 't' });
    expect(problem?.title).toMatch(/no database/i);
    expect(problem?.detail).toMatch(/Neon/);
  });

  it('catches a missing or too-short SESSION_SECRET', () => {
    expect(blockingProblems({ ...ok, SESSION_SECRET: undefined })).toHaveLength(1);
    expect(blockingProblems({ ...ok, SESSION_SECRET: 'short' })).toHaveLength(1);
  });

  it('does not block a Vercel deployment that has no Blob store', () => {
    // Photos go to the database there. Blocking the upload over a store nobody attached
    // is what produced an opaque 500 on /api/withdrawals.
    expect(blockingProblems({ ...ok, VERCEL: '1' })).toEqual([]);
  });

  it('still mentions Blob storage as the option worth taking later', () => {
    const problems = configProblems({ ...ok, VERCEL: '1' });
    const note = problems.find((p) => /database/i.test(p.title));
    expect(note?.severity).toBe('warning');
    expect(note?.detail).toMatch(/Blob/);
  });

  it('does not ask for Blob storage when running locally', () => {
    expect(blockingProblems(ok)).toEqual([]);
  });

  it('catches the flag set without a key — the exact thing that breaks a first deploy', () => {
    const [problem] = blockingProblems({ ...ok, ANTHROPIC_API_KEY: undefined });
    expect(problem?.title).toMatch(/no API key/i);
  });

  it('catches a misspelled provider', () => {
    const [problem] = blockingProblems({ ...ok, EXTRACTION_PROVIDER: 'claude' });
    expect(problem?.title).toMatch(/Unknown EXTRACTION_PROVIDER/);
  });

  it('warns — but does not block — when the offline mock is in use', () => {
    const problems = configProblems({ ...ok, EXTRACTION_PROVIDER: undefined, ANTHROPIC_API_KEY: undefined });
    expect(problems.filter((p) => p.severity === 'blocking')).toEqual([]);
    expect(problems.some((p) => p.severity === 'warning' && /sample reader/i.test(p.title))).toBe(true);
  });

  it('never echoes a secret back', () => {
    // A distinctive value, so a match means the value itself leaked rather than a word
    // that happens to appear in the advice text.
    const serialised = JSON.stringify(
      configProblems({ ...ok, SESSION_SECRET: 'xyzzy-leak-canary', ANTHROPIC_API_KEY: 'sk-ant-leak-canary' }),
    );
    expect(serialised).not.toContain('leak-canary');
  });
});

describe('the sample reader on a deployment', () => {
  it('blocks when no reader is configured on a deployed host', () => {
    // The failure this catches: a real prescription was photographed and the app
    // returned "18G blue cannula x1 / saline flush x2" — the mock's fixed sample —
    // labelled High confidence. A reading that ignores the photo must never look real.
    const { EXTRACTION_PROVIDER: _drop, ...noReader } = ok;
    const [problem] = blockingProblems({ ...noReader, VERCEL: '1' });
    expect(problem?.title).toMatch(/nothing you photograph is being read/i);
    expect(problem?.detail).toMatch(/EVERY environment/);
  });

  it('allows the sample reader when it was asked for deliberately', () => {
    const problems = configProblems({ ...ok, EXTRACTION_PROVIDER: 'mock', VERCEL: '1' });
    expect(problems.filter((p) => p.severity === 'blocking')).toEqual([]);
    expect(problems.some((p) => /sample reader/i.test(p.title))).toBe(true);
  });

  it('does not block local development, where offline is the point', () => {
    const { EXTRACTION_PROVIDER: _drop, ...noReader } = ok;
    expect(blockingProblems(noReader)).toEqual([]);
  });
});
