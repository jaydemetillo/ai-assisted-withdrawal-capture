/**
 * The mock scenarios, in a module with no Node imports.
 *
 * The capture screen is a client component and needs these labels; the provider itself
 * hashes image bytes and so can only run on the server. Keeping the names here means the
 * browser bundle never has to reach for `node:crypto`.
 */
export const MOCK_SCENARIOS = [
  'high_confidence',
  'ambiguous',
  'visible_items',
  'single_item',
  'unreadable',
] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export function isMockScenario(value: unknown): value is MockScenario {
  return typeof value === 'string' && (MOCK_SCENARIOS as readonly string[]).includes(value);
}

export const MOCK_SCENARIO_LABELS: Record<MockScenario, { title: string; note: string }> = {
  high_confidence: {
    title: 'Clear note',
    note: '"18G blue cannula x1 / saline flush x2" — both lines match one item each.',
  },
  ambiguous: {
    title: 'Ambiguous note',
    note: '"blue cannula x1" — more than one blue cannula is stocked here.',
  },
  visible_items: {
    title: 'Photo of the items',
    note: 'No writing at all — used packaging on a tray. Always needs a check.',
  },
  single_item: {
    title: 'Photo of one item',
    note: 'One thing in shot, nothing written. The only shape the recogniser can learn from.',
  },
  unreadable: {
    title: 'Unreadable note',
    note: '"? gauze maybe" — the writing cannot be made out.',
  },
};
