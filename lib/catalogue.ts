/**
 * The invented ward-supply catalogue.
 *
 * Lives here rather than in the seed script because two callers need it: the seed
 * (which writes it into the database) and the database-free demo route, which reads
 * handwriting without any database at all.
 *
 * `aliases` is the load-bearing field - it is what lets a nurse write "3x Masks" and
 * have it land on "Surgical Mask (Level 2)". Write the sloppy, abbreviated, pluralised
 * forms people actually put on paper, not the tidy procurement name.
 */
export type CatalogueItem = {
  sku: string;
  name: string;
  category: string;
  unit: string;
  reorder: number;
  opening: number;
  aliases: string[];
  description: string;
};

export const CATALOGUE: CatalogueItem[] = [
  { sku: 'MASK-L2', name: 'Surgical Mask (Level 2)', category: 'PPE', unit: 'piece', reorder: 200, opening: 130, aliases: ['mask', 'masks', 'face mask', 'face masks', 'surgical mask', 'surg mask'], description: 'Fluid-resistant 3-ply surgical mask, ear-loop.' },
  { sku: 'N95-RESP', name: 'N95 Respirator', category: 'PPE', unit: 'piece', reorder: 100, opening: 240, aliases: ['n95', 'n-95', 'respirator', 'n95 mask'], description: 'NIOSH-approved particulate respirator.' },
  { sku: 'GLOVE-NIT-M', name: 'Nitrile Gloves (Medium)', category: 'PPE', unit: 'box', reorder: 40, opening: 88, aliases: ['gloves', 'glove', 'nitrile', 'nitrile gloves', 'gloves m', 'gloves (m)', 'gloves medium'], description: 'Powder-free nitrile examination gloves, 100 per box.' },
  { sku: 'GLOVE-NIT-L', name: 'Nitrile Gloves (Large)', category: 'PPE', unit: 'box', reorder: 40, opening: 61, aliases: ['gloves l', 'gloves (l)', 'gloves large', 'large gloves'], description: 'Powder-free nitrile examination gloves, 100 per box.' },
  { sku: 'GOWN-ISO', name: 'Isolation Gown', category: 'PPE', unit: 'piece', reorder: 60, opening: 150, aliases: ['gown', 'gowns', 'isolation gown'], description: 'Disposable fluid-resistant isolation gown.' },
  { sku: 'SYR-10ML', name: 'Syringe 10ml', category: 'Consumables', unit: 'piece', reorder: 80, opening: 88, aliases: ['syringe', 'syringes', 'syringe 10ml', '10ml syringe', 'syr 10ml', '10cc syringe'], description: 'Sterile single-use luer-slip syringe, 10ml.' },
  { sku: 'SYR-5ML', name: 'Syringe 5ml', category: 'Consumables', unit: 'piece', reorder: 80, opening: 174, aliases: ['syringe 5ml', '5ml syringe', 'syr 5ml'], description: 'Sterile single-use luer-slip syringe, 5ml.' },
  { sku: 'NEEDLE-21G', name: 'Hypodermic Needle 21G', category: 'Consumables', unit: 'piece', reorder: 100, opening: 320, aliases: ['needle', 'needles', '21g', 'needle 21g'], description: 'Sterile hypodermic needle, 21 gauge.' },
  { sku: 'SAL-09-500', name: 'Normal Saline 0.9% 500ml', category: 'IV Fluids', unit: 'bag', reorder: 60, opening: 210, aliases: ['saline', 'salines', 'ns', 'n/s', 'normal saline', 'ns 500ml', 'iv saline', 'saline 500ml', 'sodium chloride'], description: 'IV sodium chloride 0.9%, 500ml bag.' },
  { sku: 'DEX-5-500', name: 'Dextrose 5% 500ml', category: 'IV Fluids', unit: 'bag', reorder: 40, opening: 95, aliases: ['dextrose', 'd5', 'd5w', 'dextrose 5%'], description: 'IV dextrose 5%, 500ml bag.' },
  { sku: 'IV-CAN-20G', name: 'IV Cannula 20G', category: 'Consumables', unit: 'piece', reorder: 60, opening: 140, aliases: ['cannula', 'iv cannula', 'venflon', '20g cannula', 'branula'], description: 'Peripheral IV cannula, 20 gauge.' },
  { sku: 'GAUZE-10', name: 'Absorbent Gauze Pad 10x10cm', category: 'Wound Care', unit: 'pack', reorder: 50, opening: 96, aliases: ['gauze', 'gauze pad', 'gauze pads', 'absorbent gauze', 'swab gauze'], description: 'Sterile absorbent gauze pads, 5 per pack.' },
  { sku: 'SWAB-ALC', name: 'Alcohol Swab', category: 'Consumables', unit: 'piece', reorder: 200, opening: 480, aliases: ['alcohol swab', 'alcohol swabs', 'alc swab', 'swab', 'swabs', 'spirit swab'], description: '70% isopropyl alcohol prep pad.' },
  { sku: 'BAND-CREPE', name: 'Crepe Bandage 10cm', category: 'Wound Care', unit: 'roll', reorder: 40, opening: 76, aliases: ['bandage', 'bandages', 'crepe', 'crepe bandage'], description: 'Cotton crepe conforming bandage, 10cm x 4.5m.' },
  { sku: 'TAPE-MICRO', name: 'Micropore Tape 2.5cm', category: 'Wound Care', unit: 'roll', reorder: 40, opening: 132, aliases: ['tape', 'micropore', 'micropore tape', 'surgical tape'], description: 'Hypoallergenic paper surgical tape.' },
  { sku: 'CHX-WIPE', name: 'Chlorhexidine Wipe', category: 'Consumables', unit: 'piece', reorder: 100, opening: 260, aliases: ['chlorhexidine', 'chx', 'chx wipe', 'chlorhex wipe'], description: '2% chlorhexidine gluconate cleansing wipe.' },
  { sku: 'ETCO2-AD', name: 'Adult ETCO2 Sensor', category: 'Monitoring', unit: 'piece', reorder: 15, opening: 42, aliases: ['etco2', 'etco2 sensor', 'capnography sensor', 'co2 sensor', 'adult etco2'], description: 'Mainstream capnography sensor, adult airway adapter.' },
  { sku: 'ECG-ELEC', name: 'ECG Electrodes', category: 'Monitoring', unit: 'pack', reorder: 40, opening: 118, aliases: ['ecg', 'ecg electrodes', 'electrodes', 'ekg electrodes', 'ecg dots'], description: 'Pre-gelled disposable ECG electrodes, 50 per pack.' },
  { sku: 'THERM-COVER', name: 'Thermometer Probe Cover', category: 'Monitoring', unit: 'box', reorder: 30, opening: 64, aliases: ['probe cover', 'probe covers', 'thermometer cover', 'thermmtr prb cvrs', 'temp probe cover'], description: 'Disposable oral/rectal thermometer probe covers.' },
  { sku: 'BP-CUFF-AD', name: 'Blood Pressure Cuff (Adult)', category: 'Monitoring', unit: 'piece', reorder: 10, opening: 26, aliases: ['bp cuff', 'blood pressure cuff', 'cuff', 'nibp cuff'], description: 'Reusable adult NIBP cuff, 25-35cm.' },
  { sku: 'PULSE-OX-SENS', name: 'Pulse Oximeter Sensor', category: 'Monitoring', unit: 'piece', reorder: 15, opening: 38, aliases: ['spo2 sensor', 'pulse ox', 'oximeter sensor', 'sats probe'], description: 'Adult reusable SpO2 finger sensor.' },
  { sku: 'O2-MASK-AD', name: 'Oxygen Mask (Adult)', category: 'Respiratory', unit: 'piece', reorder: 30, opening: 84, aliases: ['oxygen mask', 'o2 mask', 'non rebreather', 'nrb mask'], description: 'Adult non-rebreather oxygen mask with tubing.' },
  { sku: 'NASAL-CANN', name: 'Nasal Cannula', category: 'Respiratory', unit: 'piece', reorder: 40, opening: 156, aliases: ['nasal cannula', 'nasal prongs', 'np', 'oxygen prongs'], description: 'Adult soft-tip nasal oxygen cannula.' },
  { sku: 'NEB-KIT', name: 'Nebuliser Kit', category: 'Respiratory', unit: 'piece', reorder: 25, opening: 58, aliases: ['nebuliser', 'nebulizer', 'neb kit', 'neb'], description: 'Disposable nebuliser cup, mask and tubing.' },
  { sku: 'SUCT-TUBE', name: 'Suction Tubing', category: 'Respiratory', unit: 'piece', reorder: 25, opening: 70, aliases: ['suction tubing', 'suction tube', 'yankauer'], description: 'Sterile suction connecting tubing, 2m.' },
  { sku: 'FOLEY-16', name: 'Foley Catheter 16Fr', category: 'Consumables', unit: 'piece', reorder: 20, opening: 54, aliases: ['foley', 'foley catheter', 'catheter', 'foly cath', 'idc'], description: 'Silicone-coated latex Foley catheter, 16 French.' },
  { sku: 'URINE-BAG-2L', name: 'Urine Drainage Bag 2L', category: 'Consumables', unit: 'piece', reorder: 25, opening: 66, aliases: ['urine bag', 'drainage bag', 'catheter bag'], description: 'Sterile closed-system urine drainage bag, 2 litre.' },
  { sku: 'BLADE-15', name: 'Surgical Blade No.15', category: 'Surgical', unit: 'piece', reorder: 30, opening: 92, aliases: ['blade', 'blades', 'scalpel', 'surgical blade', 'no 15 blade'], description: 'Sterile carbon steel surgical blade, size 15.' },
  { sku: 'SUTURE-3-0', name: 'Suture 3-0 Nylon', category: 'Surgical', unit: 'piece', reorder: 30, opening: 74, aliases: ['suture', 'sutures', 'nylon suture', '3-0 nylon'], description: 'Non-absorbable monofilament nylon suture, 3-0.' },
  { sku: 'SPEC-CONT', name: 'Specimen Container 60ml', category: 'Laboratory', unit: 'piece', reorder: 50, opening: 188, aliases: ['specimen container', 'specimen pot', 'sample container', 'urine pot'], description: 'Sterile screw-top specimen container, 60ml.' },
  { sku: 'BLOOD-EDTA', name: 'Blood Collection Tube (EDTA)', category: 'Laboratory', unit: 'piece', reorder: 80, opening: 244, aliases: ['edta', 'edta tube', 'purple top', 'fbc tube', 'blood tube'], description: 'K2 EDTA vacuum blood collection tube, 4ml.' },
  { sku: 'BIOHAZ-BAG', name: 'Biohazard Bag', category: 'Waste', unit: 'piece', reorder: 60, opening: 20, aliases: ['biohazard bag', 'biohazard bags', 'biohzd bags', 'yellow bag', 'clinical waste bag'], description: 'Yellow clinical-waste bag, 30 litre.' },
  { sku: 'SHARPS-5L', name: 'Sharps Bin 5L', category: 'Waste', unit: 'piece', reorder: 15, opening: 34, aliases: ['sharps bin', 'sharps', 'sharps container'], description: 'Puncture-resistant sharps disposal container, 5 litre.' },
  { sku: 'PARA-500', name: 'Paracetamol 500mg Tablet', category: 'Medication', unit: 'tablet', reorder: 200, opening: 640, aliases: ['paracetamol', 'panadol', 'pcm', 'acetaminophen'], description: 'Paracetamol 500mg film-coated tablet.' },
  { sku: 'STER-WATER-10', name: 'Sterile Water 10ml', category: 'Medication', unit: 'vial', reorder: 60, opening: 190, aliases: ['sterile water', 'water for injection', 'wfi'], description: 'Sterile water for injection, 10ml ampoule.' },
];
