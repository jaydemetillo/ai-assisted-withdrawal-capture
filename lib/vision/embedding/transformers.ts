import type { Embedding, EmbeddingProvider } from '@/lib/vision/embedding/provider';
import { unit } from '@/lib/vision/embedding/provider';

/**
 * CLIP (or SigLIP) via transformers.js, running locally on CPU. Free, open weights,
 * nothing leaves the machine.
 *
 * This is the provider the design actually wants. The local descriptor knows where the
 * colours are; this one knows what a syringe looks like, because it was trained on a few
 * hundred million captioned images. Two photos of the same pack from opposite sides land
 * near each other in a way no colour histogram achieves.
 *
 * **It is optional on purpose.** The package is tens of megabytes and the weights are
 * another ~90 MB fetched at first use, which is a slow cold start on a serverless host
 * and a hard failure on one with no outbound access. Making it a hard dependency would
 * mean every deployment pays for it whether or not it is switched on, and a deployment
 * that cannot fetch the weights would fail at install rather than at a feature nobody
 * enabled. So it is a dynamic import behind `EMBEDDING_PROVIDER=transformers`:
 *
 *     npm install @huggingface/transformers
 *     EMBEDDING_PROVIDER=transformers
 *
 * Vectors are NOT comparable with the descriptor's. Switching providers leaves the
 * existing examples in place but out of scope — reads filter on `embeddingModel` — so
 * the index reads as empty and re-teaches from scratch. That is visible and recoverable;
 * mixing coordinate spaces would be neither.
 *
 * ## Verified against the real library
 *
 * This file was written before the package could be installed here, so for a while the
 * honest caveat was that only `toVector` had ever run. It has since been driven end to
 * end against `@huggingface/transformers` with `Xenova/clip-vit-base-patch32`:
 * `RawImage.fromBlob` accepted a JPEG Buffer, `pipeline('image-feature-extraction', ...)`
 * returned a Tensor with `dims: [1, 512]` and a Float32Array `.data`, and `toVector`
 * parsed it to 512 finite numbers — which is why `dimensions` defaults to 512.
 *
 * The measured difference from the descriptor, over four images that are two shapes in
 * two colours:
 *
 *   | similarity                   | descriptor | CLIP  |
 *   | ---------------------------- | ---------- | ----- |
 *   | same shape, different colour | 0.648      | 0.944 |
 *   | same colour, different shape | 0.790      | 0.859 |
 *
 * The ordering inverts. The descriptor groups by colour, so two items in the same livery
 * look alike to it; CLIP groups by what the thing IS. On a cart where a whole product
 * range shares a colour, that is the difference between a usable recogniser and one that
 * confidently confuses a syringe with a dressing pack.
 */
export const DEFAULT_VISION_MODEL = 'Xenova/clip-vit-base-patch32';

/** The narrow slice of transformers.js this file uses, so the import needs no types. */
type FeatureExtractor = (input: unknown, options?: Record<string, unknown>) => Promise<unknown>;
type TransformersModule = {
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<FeatureExtractor>;
  RawImage: { fromBlob: (blob: Blob) => Promise<unknown> };
};

/** Both the current package name and the one it was published under before. */
const PACKAGE_NAMES = ['@huggingface/transformers', '@xenova/transformers'];

let cached: Promise<{ module: TransformersModule; extractor: FeatureExtractor }> | null = null;

async function loadModule(): Promise<TransformersModule> {
  const failures: string[] = [];
  for (const name of PACKAGE_NAMES) {
    try {
      // Assembled at run time so a bundler does not try to resolve an absent optional
      // package at build time and fail the whole build over a disabled feature.
      const module = (await import(/* webpackIgnore: true */ /* @vite-ignore */ name)) as unknown;
      const candidate = (module as { default?: unknown }).default ?? module;
      if (isTransformersModule(candidate)) return candidate;
      failures.push(`${name}: loaded but has no pipeline()`);
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message.split('\n')[0] : 'not installed'}`);
    }
  }
  throw new Error(
    `EMBEDDING_PROVIDER=transformers but no transformers.js package could be loaded. Run "npm install @huggingface/transformers", or unset EMBEDDING_PROVIDER to use the built-in descriptor. (${failures.join('; ')})`,
  );
}

function isTransformersModule(value: unknown): value is TransformersModule {
  if (!value || typeof value !== 'object') return false;
  const shape = value as Partial<TransformersModule>;
  return typeof shape.pipeline === 'function' && typeof shape.RawImage?.fromBlob === 'function';
}

/**
 * Pull the vector out of whatever the pipeline returned.
 *
 * transformers.js has shipped several shapes across versions — a Tensor with `.data`, a
 * nested array, a flat array — and a wrong guess here produces a vector of `undefined`
 * that normalises to zeros and silently matches nothing. Checking the shape and throwing
 * is the difference between "upgrade broke recognition, here is why" and "recognition
 * quietly stopped working".
 */
export function toVector(output: unknown, expectedDimensions: number): number[] {
  const data =
    output && typeof output === 'object' && 'data' in output
      ? (output as { data: unknown }).data
      : output;

  let flat: number[] | null = null;
  if (Array.isArray(data)) {
    flat = Array.isArray(data[0]) ? (data[0] as number[]) : (data as number[]);
  } else if (ArrayBuffer.isView(data) && !(data instanceof DataView)) {
    flat = Array.from(data as unknown as ArrayLike<number>);
  }

  if (!flat || flat.length === 0 || !flat.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error('The vision model returned something that is not a vector of numbers.');
  }
  if (flat.length !== expectedDimensions) {
    throw new Error(
      `The vision model returned ${flat.length} dimensions but the stored examples have ${expectedDimensions}. Retire the old examples or pin the previous model.`,
    );
  }
  return unit(flat);
}

export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'transformers';
  readonly isDescriptorOnly = false;
  readonly model: string;
  readonly dimensions: number;

  constructor(model = process.env.VISION_MODEL || DEFAULT_VISION_MODEL, dimensions = 512) {
    this.model = model;
    this.dimensions = Number(process.env.VISION_MODEL_DIMENSIONS) || dimensions;
  }

  /** Loaded once per process. The weights are the expensive part, not the call. */
  private async extractor(): Promise<{ module: TransformersModule; extractor: FeatureExtractor }> {
    if (!cached) {
      cached = (async () => {
        const module = await loadModule();
        const extractor = await module.pipeline('image-feature-extraction', this.model);
        return { module, extractor };
      })().catch((error: unknown) => {
        // Do not cache a failure: a transient network problem while fetching weights
        // should not disable recognition for the life of the process.
        cached = null;
        throw error;
      });
    }
    return cached;
  }

  async embed(image: Buffer, mediaType: string): Promise<Embedding> {
    const { module, extractor } = await this.extractor();
    const blob = new Blob([new Uint8Array(image)], { type: mediaType });
    const raw = await module.RawImage.fromBlob(blob);
    const output = await extractor(raw, { pooling: 'mean', normalize: true });
    return { vector: toVector(output, this.dimensions), model: this.model };
  }
}
