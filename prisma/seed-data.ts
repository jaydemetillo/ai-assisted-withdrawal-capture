/**
 * The demo catalogue.
 *
 * Kept as plain data, separate from the seed script, so the tests can assert against the
 * same rows the database gets — in particular that no alias maps to two items, which is
 * the constraint the whole alias mechanism rests on.
 *
 * Two deliberate properties, both load-bearing for the demo:
 *
 *   1. "18g blue cannula" matches exactly one item, so it is confirmable.
 *   2. "blue cannula" matches TWO items (an 18G and a 22G), so it is not — even though
 *      it is also an approved alias of the 18G. Ambiguity beats an alias hit. This is
 *      the single most important behaviour in the system, and it is asserted by a test.
 */

export type SeedItem = {
  sku: string;
  displayName: string;
  unit: string;
  category: string;
  reorderThreshold: number;
  reorderQuantity: number;
  isControlled?: boolean;
  isHighRisk?: boolean;
  aliases: string[];
  /** Opening quantity at ED_RESUS_02. */
  resusQuantity: number;
  /** Opening quantity at ED_STORE_01. `null` means the item is not stocked there. */
  storeQuantity: number | null;
};

export const LOCATIONS = [
  {
    code: 'ED_RESUS_02',
    name: 'ED Resus Bay 02',
    description: 'Emergency department resuscitation bay 2 — emergency cart',
  },
  {
    code: 'ED_STORE_01',
    name: 'ED Store Room 01',
    description: 'Emergency department main store room',
  },
] as const;

export const ITEMS: SeedItem[] = [
  // ── IV access ───────────────────────────────────────────────────────────────
  {
    sku: 'IVC-18G-BLUE',
    displayName: 'IV cannula 18G blue',
    unit: 'each',
    category: 'iv_access',
    reorderThreshold: 10,
    reorderQuantity: 40,
    aliases: ['18g blue cannula', 'blue cannula', '18g cannula', '18g ivc'],
    resusQuantity: 24,
    storeQuantity: 120,
  },
  {
    sku: 'IVC-22G-BLUE',
    displayName: 'IV cannula 22G blue',
    unit: 'each',
    category: 'iv_access',
    reorderThreshold: 10,
    reorderQuantity: 40,
    aliases: ['22g blue cannula', '22g cannula'],
    resusQuantity: 18,
    storeQuantity: 90,
  },
  {
    sku: 'IVC-20G-PINK',
    displayName: 'IV cannula 20G pink',
    unit: 'each',
    category: 'iv_access',
    reorderThreshold: 10,
    reorderQuantity: 40,
    aliases: ['pink cannula', '20g cannula'],
    resusQuantity: 20,
    storeQuantity: 100,
  },
  {
    sku: 'GIVING-SET-STD',
    displayName: 'IV giving set standard',
    unit: 'each',
    category: 'iv_access',
    reorderThreshold: 6,
    reorderQuantity: 20,
    aliases: ['giving set', 'iv set'],
    resusQuantity: 12,
    storeQuantity: 40,
  },
  {
    sku: 'DRESS-IV-TRANSP',
    displayName: 'Transparent IV dressing',
    unit: 'each',
    category: 'dressings',
    reorderThreshold: 20,
    reorderQuantity: 60,
    aliases: ['iv dressing', 'clear dressing'],
    resusQuantity: 30,
    storeQuantity: 150,
  },

  // ── Fluids and flushes ──────────────────────────────────────────────────────
  {
    sku: 'NS-FLUSH-10ML',
    displayName: 'Sodium chloride 0.9% flush 10 mL',
    unit: 'each',
    category: 'fluids',
    reorderThreshold: 20,
    reorderQuantity: 60,
    aliases: ['saline flush', 'ns flush', 'normal saline flush', '10ml saline flush'],
    // Opening stock sits one unit above the reorder threshold so the demo's
    // "saline flush x2" crosses it and raises a replenishment task.
    resusQuantity: 21,
    storeQuantity: 200,
  },
  {
    sku: 'NS-500ML',
    displayName: 'Sodium chloride 0.9% infusion 500 mL',
    unit: 'bag',
    category: 'fluids',
    reorderThreshold: 6,
    reorderQuantity: 24,
    aliases: ['normal saline 500ml', 'saline 500ml', 'ns 500ml'],
    resusQuantity: 10,
    storeQuantity: 60,
  },
  {
    sku: 'HARTMANNS-1L',
    displayName: "Compound sodium lactate Hartmanns 1 L",
    unit: 'bag',
    category: 'fluids',
    reorderThreshold: 4,
    reorderQuantity: 12,
    aliases: ['hartmanns', 'hartmanns 1l', 'compound sodium lactate'],
    resusQuantity: 8,
    storeQuantity: 36,
  },

  // ── Syringes and needles ────────────────────────────────────────────────────
  {
    sku: 'SYR-10ML',
    displayName: 'Syringe 10 mL luer lock',
    unit: 'each',
    category: 'syringes',
    reorderThreshold: 25,
    reorderQuantity: 100,
    aliases: ['10ml syringe', '10 ml syringe'],
    resusQuantity: 40,
    storeQuantity: 250,
  },
  {
    sku: 'SYR-5ML',
    displayName: 'Syringe 5 mL luer lock',
    unit: 'each',
    category: 'syringes',
    reorderThreshold: 25,
    reorderQuantity: 100,
    aliases: ['5ml syringe', '5 ml syringe'],
    resusQuantity: 40,
    storeQuantity: 250,
  },
  {
    sku: 'NEEDLE-21G-GREEN',
    displayName: 'Hypodermic needle 21G green',
    unit: 'each',
    category: 'syringes',
    reorderThreshold: 25,
    reorderQuantity: 100,
    aliases: ['green needle', '21g needle'],
    resusQuantity: 50,
    storeQuantity: 300,
  },
  {
    sku: 'NEEDLE-23G-BLUE',
    displayName: 'Hypodermic needle 23G blue',
    unit: 'each',
    category: 'syringes',
    reorderThreshold: 25,
    reorderQuantity: 100,
    aliases: ['blue needle', '23g needle'],
    resusQuantity: 50,
    storeQuantity: 300,
  },

  // ── Dressings ───────────────────────────────────────────────────────────────
  {
    sku: 'GAUZE-10X10',
    displayName: 'Gauze swabs 10 x 10 cm pack of 5',
    unit: 'pack',
    category: 'dressings',
    reorderThreshold: 15,
    reorderQuantity: 50,
    aliases: ['10x10 gauze', 'large gauze'],
    resusQuantity: 25,
    storeQuantity: 120,
  },
  {
    sku: 'GAUZE-5X5',
    displayName: 'Gauze swabs 5 x 5 cm pack of 5',
    unit: 'pack',
    category: 'dressings',
    reorderThreshold: 15,
    reorderQuantity: 50,
    aliases: ['5x5 gauze', 'small gauze'],
    resusQuantity: 25,
    storeQuantity: 120,
  },
  {
    sku: 'TAPE-MICRO-25',
    displayName: 'Microporous tape 2.5 cm',
    unit: 'roll',
    category: 'dressings',
    reorderThreshold: 10,
    reorderQuantity: 30,
    aliases: ['micropore', 'microporous tape'],
    resusQuantity: 14,
    storeQuantity: 60,
  },

  // ── PPE ─────────────────────────────────────────────────────────────────────
  {
    sku: 'GLOVE-NITRILE-M',
    displayName: 'Nitrile gloves medium',
    unit: 'pair',
    category: 'ppe',
    reorderThreshold: 40,
    reorderQuantity: 200,
    aliases: ['medium gloves', 'gloves m'],
    resusQuantity: 80,
    storeQuantity: 500,
  },
  {
    sku: 'GLOVE-NITRILE-L',
    displayName: 'Nitrile gloves large',
    unit: 'pair',
    category: 'ppe',
    reorderThreshold: 40,
    reorderQuantity: 200,
    aliases: ['large gloves', 'gloves l'],
    resusQuantity: 80,
    storeQuantity: 500,
  },
  {
    sku: 'MASK-SURG-L2',
    displayName: 'Surgical mask level 2',
    unit: 'each',
    category: 'ppe',
    reorderThreshold: 50,
    reorderQuantity: 200,
    aliases: ['surgical mask', 'face mask'],
    resusQuantity: 100,
    storeQuantity: 600,
  },

  // ── Airway and breathing ────────────────────────────────────────────────────
  {
    sku: 'OXY-MASK-NRB',
    displayName: 'Oxygen mask non-rebreather adult',
    unit: 'each',
    category: 'airway',
    reorderThreshold: 5,
    reorderQuantity: 20,
    aliases: ['non rebreather', 'nrb mask', 'oxygen mask'],
    resusQuantity: 10,
    storeQuantity: 40,
  },
  {
    sku: 'NPA-7MM',
    displayName: 'Nasopharyngeal airway 7.0 mm',
    unit: 'each',
    category: 'airway',
    reorderThreshold: 4,
    reorderQuantity: 12,
    aliases: ['npa', 'nasal airway'],
    resusQuantity: 6,
    storeQuantity: 18,
  },
  {
    sku: 'BVM-ADULT',
    displayName: 'Bag valve mask resuscitator adult',
    unit: 'each',
    category: 'airway',
    reorderThreshold: 2,
    reorderQuantity: 4,
    aliases: ['bvm', 'bag valve mask', 'ambu bag'],
    resusQuantity: 3,
    storeQuantity: 8,
  },

  // ── Monitoring ──────────────────────────────────────────────────────────────
  {
    sku: 'ECG-ELECTRODE',
    displayName: 'ECG electrodes pack of 3',
    unit: 'pack',
    category: 'monitoring',
    reorderThreshold: 20,
    reorderQuantity: 60,
    aliases: ['ecg dots', 'ecg electrodes'],
    resusQuantity: 30,
    storeQuantity: 150,
  },
  {
    sku: 'DEFIB-PADS-ADULT',
    displayName: 'Defibrillator pads adult pair',
    unit: 'pair',
    category: 'monitoring',
    reorderThreshold: 2,
    reorderQuantity: 8,
    // High-risk: the wrong pads on the wrong patient is a consequential error, and a
    // resus bay running out is worse. Never self-confirmed by a nurse.
    isHighRisk: true,
    aliases: ['defib pads', 'defibrillator pads'],
    // Deliberately below what the demo's reviewer flow withdraws, so the
    // insufficient-stock discrepancy path is reachable by following the demo script.
    resusQuantity: 1,
    storeQuantity: 6,
  },

  // ── Emergency and controlled drugs ──────────────────────────────────────────
  {
    sku: 'ADREN-1MG-10ML',
    displayName: 'Adrenaline 1 mg in 10 mL prefilled syringe',
    unit: 'each',
    category: 'emergency_drugs',
    reorderThreshold: 4,
    reorderQuantity: 12,
    isHighRisk: true,
    aliases: ['adrenaline', 'epinephrine', 'adrenaline 1mg'],
    resusQuantity: 6,
    storeQuantity: 20,
  },
  {
    sku: 'MORPH-10MG',
    displayName: 'Morphine sulfate 10 mg in 1 mL ampoule',
    unit: 'each',
    category: 'controlled_drugs',
    reorderThreshold: 2,
    reorderQuantity: 6,
    isControlled: true,
    aliases: ['morphine', 'morphine 10mg'],
    resusQuantity: 4,
    // Not stocked in the general store room — controlled drugs live in the CD cupboard.
    // This also gives the tests a real "not stocked at this location" case.
    storeQuantity: null,
  },
];

export const DEMO_USERS = [
  { email: 'nurse@demo.local', name: 'Alex Tan', role: 'nurse' as const },
  { email: 'reviewer@demo.local', name: 'Sam Rivera', role: 'supply_reviewer' as const },
  { email: 'admin@demo.local', name: 'Jordan Blake', role: 'admin' as const },
];
