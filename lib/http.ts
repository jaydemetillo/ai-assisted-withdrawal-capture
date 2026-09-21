import { NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth/session';
import { log } from '@/lib/log';

/**
 * One place that turns a thrown error into a response.
 *
 * Client-facing messages are written for a nurse holding a phone, not for a developer.
 * Anything we did not anticipate becomes a generic message and a server-side log line —
 * an internal error text could carry a fragment of extracted content.
 */
export function routeError(error: unknown, context: Record<string, string> = {}): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error && error.name === 'ExpectedError') {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Misconfiguration is not a bug the user can do anything about by retrying, and the
  // message says exactly what is missing. Hiding it behind "something went wrong" is how
  // a five-minute fix becomes an afternoon.
  if (error instanceof Error && CONFIG_ERROR.test(error.message)) {
    log.error('configuration error', { ...context, name: error.name });
    return NextResponse.json({ error: error.message, configuration: true }, { status: 503 });
  }

  log.error('unhandled route error', { ...context, name: error instanceof Error ? error.name : 'unknown' });
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}

/**
 * Errors thrown by the configuration guards in lib/storage, lib/auth and lib/extraction.
 * Matched on their own wording because they are raised from deep inside adapters that
 * have no business importing an HTTP module.
 */
const CONFIG_ERROR = /SESSION_SECRET|ANTHROPIC_API_KEY|without a Blob store|EXTRACTION_PROVIDER/;

/** An error whose message is safe to show the user. */
export function expected(message: string): Error {
  const error = new Error(message);
  error.name = 'ExpectedError';
  return error;
}
