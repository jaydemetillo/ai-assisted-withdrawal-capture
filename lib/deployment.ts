/**
 * The full app needs a real database. The standalone demo at /demo.html does not.
 *
 * On a serverless host a SQLite file is not a real database - the disk is per-instance
 * and disposable - so a deploy that only set ANTHROPIC_API_KEY has no usable store.
 * Rather than let those pages throw a Prisma error, we send visitors to the demo, which
 * works with nothing but the key.
 */
export function hasUsableDatabase(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const onServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (onServerless && url.startsWith('file:')) return false;
  return true;
}
