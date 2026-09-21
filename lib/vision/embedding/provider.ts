/**
 * Turning a photograph into a vector.
 *
 * The whole learning story rests on one idea: if two photographs of the same thing
 * produce two nearby vectors, then "have I seen this before?" is a distance calculation
 * over rows in a table, not a model that has to be retrained. Adding an example is an
 * INSERT and removing one is a soft delete, and both take effect on the next photo.
 *
 * Providers are interchangeable and their outputs are NOT. Two vectors from two
 * different models are unrelated coordinates; the cosine between them is noise that
 * looks exactly like a score. Every stored vector therefore carries the `model` that
 * produced it, and every read filters to the one currently configured. Switching
 * providers does not corrupt anything — it just means the index starts empty again,
 * which is honest and visible rather than silently wrong.
 */
export type Embedding = {
  /** Unit-length. Callers rely on this: cosine similarity is a plain dot product. */
  vector: number[];
  /** Identifies the coordinate space. Vectors with different values never mix. */
  model: string;
};

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  /** True when this is the dependency-free fallback rather than a learned model. */
  readonly isDescriptorOnly: boolean;
  embed(image: Buffer, mediaType: string): Promise<Embedding>;
}

/** Scale a vector to unit length. A zero vector is returned unchanged, not divided by 0. */
export function unit(values: number[]): number[] {
  let sum = 0;
  for (const value of values) sum += value * value;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) return values.map(() => 0);
  return values.map((value) => value / norm);
}
