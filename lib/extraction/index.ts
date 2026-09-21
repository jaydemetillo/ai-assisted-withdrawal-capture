import { AnthropicExtractionProvider, anthropicIsConfigured } from '@/lib/extraction/anthropic';
import { MockExtractionProvider } from '@/lib/extraction/mock';
import type { ExtractionProvider } from '@/lib/extraction/provider';

export * from '@/lib/extraction/provider';

let override: ExtractionProvider | null = null;

/**
 * The configured extraction provider.
 *
 * The mock is the default and needs no credentials. Claude vision requires BOTH
 * `EXTRACTION_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`; if the flag is set without a
 * key, we fail loudly rather than silently falling back to invented data — a demo that
 * looks like it is reading handwriting but is not would be worse than an error.
 */
function isDeployed(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function extractionProvider(): ExtractionProvider {
  if (override) return override;

  const choice = process.env.EXTRACTION_PROVIDER;

  if (choice === 'anthropic') {
    if (!anthropicIsConfigured()) {
      throw new Error(
        'EXTRACTION_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. Add the key, or set EXTRACTION_PROVIDER=mock to use the offline sample reader.',
      );
    }
    return new AnthropicExtractionProvider();
  }

  // On a deployed host the mock is almost never what anyone intended, and it is actively
  // dangerous: it returns a fixed sample note whatever you photograph, so a real
  // document comes back as somebody else's supply list. An unset variable there is a
  // misconfiguration, not a choice, and it fails loudly. Locally, unset still means the
  // mock, because an offline demo needs no credentials.
  if (!choice && isDeployed()) {
    throw new Error(
      'No reader is configured on this deployment. EXTRACTION_PROVIDER is not set, and the offline mock returns a fixed sample note whatever you photograph. Set EXTRACTION_PROVIDER=anthropic with ANTHROPIC_API_KEY to read real handwriting, or EXTRACTION_PROVIDER=mock to deliberately use samples.',
    );
  }

  return new MockExtractionProvider();
}

export type ProviderDescription = {
  ok: boolean;
  isMock: boolean;
  name: string;
  model: string;
  error: string | null;
};

/**
 * Describe the configured provider without throwing.
 *
 * Pages that merely need to know "is this a mock?" must not crash the whole screen over
 * a missing variable — the screen is where the person finds out what to set.
 */
export function describeProvider(): ProviderDescription {
  try {
    const provider = extractionProvider();
    return { ok: true, isMock: provider.isMock, name: provider.name, model: provider.model, error: null };
  } catch (error) {
    return {
      ok: false,
      isMock: false,
      name: 'none',
      model: '',
      error: error instanceof Error ? error.message : 'The reader could not start.',
    };
  }
}

/** Test seam. */
export function setExtractionProvider(next: ExtractionProvider | null): void {
  override = next;
}
