/**
 * A crude, deterministic check for "this photo is not a supply note".
 *
 * It is NOT a classifier and makes no clinical judgement. It looks for the furniture of a
 * dispensing prescription — Rx, Sig:, a dosing abbreviation, a prescriber licence line —
 * and it exists for one reason: when somebody photographs a prescription, the app should
 * say so plainly and remind them not to capture patient information, rather than showing
 * four blank "Cannot identify" cards that look like a malfunction.
 *
 * It never blocks anything and never resolves anything. Its only output is a sentence.
 */
const PRESCRIPTION_MARKERS: RegExp[] = [
  /\brx\b/i,
  /\bsig\b\s*[:.]/i,
  /\b(bid|tid|qid|qd|prn|po|hs)\b/i,
  /\bmg\s*\/\s*tab\b/i,
  /\b\d+\s*mg\b.*\btabs?\b/i,
  /\bcap\s*#\s*\d+/i,
  /\brefill\b/i,
  /\b(physician|prescriber)('s)?\s*(sig|signature)\b/i,
  /\b(lic|dea|ptr)\.?\s*(no\.?|#)/i,
  /\btake one\b/i,
];

/** Fields that identify a person. Their presence is the thing worth warning about. */
const IDENTIFIER_MARKERS: RegExp[] = [
  /\bname\s*[:.]/i,
  /\baddress\s*[:.]/i,
  /\bage\s*[:.]/i,
  /\bsex\s*[:.]/i,
  /\bpatient\b/i,
  /\bdate of birth\b|\bdob\b/i,
];

export type DocumentHint = {
  looksLikePrescription: boolean;
  mayContainPatientDetails: boolean;
};

export function inspectDocument(rawText: string | null | undefined): DocumentHint {
  const text = (rawText ?? '').trim();
  if (!text) return { looksLikePrescription: false, mayContainPatientDetails: false };

  const prescriptionHits = PRESCRIPTION_MARKERS.filter((r) => r.test(text)).length;
  const identifierHits = IDENTIFIER_MARKERS.filter((r) => r.test(text)).length;

  return {
    // Two markers, not one: "Rx" alone appears on plenty of supply paperwork, and a
    // false alarm on every note would teach people to ignore the warning.
    looksLikePrescription: prescriptionHits >= 2,
    mayContainPatientDetails: identifierHits >= 1,
  };
}
