import { LocalDescriptorProvider } from '@/lib/vision/embedding/descriptor';
import type { EmbeddingProvider } from '@/lib/vision/embedding/provider';
import { TransformersEmbeddingProvider } from '@/lib/vision/embedding/transformers';

export * from '@/lib/vision/embedding/provider';

let override: EmbeddingProvider | null = null;
let current: EmbeddingProvider | null = null;

/**
 * The configured embedding provider.
 *
 * Unlike the extraction provider, there is no "fail loudly on a deployment" rule here,
 * and the difference is worth stating. A mock READER invents content and presents it as
 * having been read off your photograph, which is a lie the user cannot see. A weaker
 * embedding just recognises less, says so, and sends the line to a human — which is
 * where every visual line goes regardless. Degrading is safe here in a way it never was
 * there.
 */
export function embeddingProvider(): EmbeddingProvider {
  if (override) return override;
  if (current) return current;
  current =
    process.env.EMBEDDING_PROVIDER === 'transformers'
      ? new TransformersEmbeddingProvider()
      : new LocalDescriptorProvider();
  return current;
}

/**
 * Whether visual recognition is switched on at all.
 *
 * Default ON. It cannot move stock by itself — a visually identified line is always
 * `needs_review` — so the risk of leaving it on is a wrong suggestion in front of
 * someone who has to look anyway. Set `VISUAL_RECOGNITION=off` to disable it entirely;
 * the index is left untouched and nothing reads it.
 */
export function visualRecognitionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env.VISUAL_RECOGNITION ?? '').trim().toLowerCase();
  return !['off', 'false', '0', 'no'].includes(value);
}

export type EmbeddingProviderDescription = {
  ok: boolean;
  enabled: boolean;
  name: string;
  model: string;
  dimensions: number;
  isDescriptorOnly: boolean;
  error: string | null;
};

/** Describe the provider without throwing — the health endpoint and settings screens. */
export function describeEmbeddingProvider(): EmbeddingProviderDescription {
  const enabled = visualRecognitionEnabled();
  try {
    const provider = embeddingProvider();
    return {
      ok: true,
      enabled,
      name: provider.name,
      model: provider.model,
      dimensions: provider.dimensions,
      isDescriptorOnly: provider.isDescriptorOnly,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      enabled,
      name: 'none',
      model: '',
      dimensions: 0,
      isDescriptorOnly: false,
      error: error instanceof Error ? error.message : 'The recogniser could not start.',
    };
  }
}

/** Test seam. */
export function setEmbeddingProvider(next: EmbeddingProvider | null): void {
  override = next;
  if (next) current = null;
}
