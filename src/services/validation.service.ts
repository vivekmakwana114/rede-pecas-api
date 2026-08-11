import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/config.js";
import { logger } from "../config/logger.js";
import { updateCustomer } from "../models/customer.model.js";
import { updateManualCollection } from "../models/vehicle.model.js";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const VALIDATION_MODEL = "claude-haiku-4-5-20251001";

export const MAX_VALIDATION_ATTEMPTS = 3;

export type FreeTextFieldKind = 'address' | 'vehicleMake' | 'vehicleModel' | 'vehicleYear';

export interface PlausibilityResult {
  valid: boolean;
  reason?: string;
}

const FIELD_PROMPTS: Record<FreeTextFieldKind, (value: string, context?: string) => string> = {
  address: (value) =>
    `Is "${value}" a plausible real-world address — anywhere in the world (any country), not just ` +
    `Angola? It should read like a genuine street/neighbourhood/city/region reference. Reject single ` +
    `characters, digits-only text, keyboard mashing, or obvious placeholder/joke answers (e.g. "asdf", ` +
    `"n/a", "don't know"). It does NOT need a postal code or a specific country to be named.`,
  vehicleMake: (value) =>
    `Is "${value}" a REAL, existing vehicle manufacturer (make) — using your actual knowledge of car ` +
    `brands, not just whether it sounds plausible? Reject anything that isn't a genuine manufacturer, ` +
    `including misspellings that don't correspond to a real brand, single letters, digits-only text, ` +
    `keyboard mashing, or made-up names.`,
  vehicleModel: (value, make) =>
    `Is "${value}" a REAL model actually manufactured by "${make ?? 'the given manufacturer'}"? Use ` +
    `your actual knowledge of ${make ?? 'that manufacturer'}'s real model lineup — reject a model name ` +
    `that isn't genuinely one of their models, even if it looks like a plausible alphanumeric car-model ` +
    `pattern (e.g. an invented combination like "M3200i" that resembles real model-naming conventions ` +
    `but isn't an actual model this manufacturer makes), plus single letters, digits-only text, or ` +
    `keyboard mashing.`,
  vehicleYear: (value, context) =>
    `Is "${value}" a REAL, plausible 4-digit manufacturing/production year for "${context ?? 'the given vehicle'}"? ` +
    `Use your actual knowledge of car production years — reject years in which this specific vehicle model was ` +
    `never manufactured or sold, future years, or 4-digit numbers outside realistic production runs for this vehicle.`,
};

/**
 * Judges whether a customer-typed free-text reply (address, vehicle
 * make/model) is plausible, via a single Claude Haiku text-only call — the
 * one architectural exception to this codebase's "no conversational AI"
 * rule (see CLAUDE.md), since these fields have no fixed format a regex
 * could check and benefit from Claude's real-world knowledge (e.g. whether a
 * model actually belongs to a given make). Fails OPEN (treats the input as
 * valid) on any network/API error so an Anthropic outage never blocks
 * onboarding — only the model's own judgment, or a malformed JSON response,
 * causes a rejection. `context` is used by 'vehicleModel' to pass the
 * already-collected make, so the model is checked against that specific
 * manufacturer's real lineup instead of validated in isolation.
 */
export async function validateFreeText(kind: FreeTextFieldKind, value: string, context?: string): Promise<PlausibilityResult> {
  const prompt = FIELD_PROMPTS[kind](value, context);

  try {
    const response = await anthropic.messages.create({
      model: VALIDATION_MODEL,
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `${prompt}\n\nRespond ONLY with valid JSON, no additional text:\n` +
          `{"valid": true or false, "reason": "short one-sentence reason in Portuguese if invalid, otherwise null"}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      return { valid: !!parsed.valid, reason: parsed.reason || undefined };
    } catch {
      logger.error(`Error parsing validation model JSON for ${kind}: ${text}`);
      return { valid: true };
    }
  } catch (error: any) {
    logger.error(`Claude text-validation error for ${kind}: ${error.message}`);
    return { valid: true };
  }
}

/**
 * Deterministic person-name plausibility check — no AI call, since a name's
 * shape (letters/spaces only, sane length, not a repeated character) is a
 * pattern a regex can check just as well, without the latency/cost of a
 * Claude round-trip.
 */
export function isPlausibleName(value: string): boolean {
  const clean = value.trim();
  if (clean.length < 3 || clean.length > 60) return false;
  if (!/^[\p{L}\s'.-]+$/u.test(clean)) return false;
  return !/^(.)\1*$/.test(clean.replace(/[\s'.-]/g, ''));
}

/**
 * Angola NIF format check — for individuals this mirrors the Bilhete de
 * Identidade (BI) number: 9 digits + a 2-letter province code + 3 digits
 * (e.g. "005123456LA042"). Collective/company NIFs are typically a plain
 * 9-10 digit number instead, so both shapes are accepted.
 */
export function isPlausibleNif(value: string): boolean {
  const clean = value.replace(/\s/g, '').toUpperCase();
  return /^\d{9}[A-Z]{2}\d{3}$/.test(clean) || /^\d{9,10}$/.test(clean);
}

/**
 * Lenient engine-number shape check — arbitrary alphanumeric codes have no
 * semantic content an AI could judge, so this stays a simple format check:
 * length 4-20, alphanumeric (dashes allowed), at least one digit (real engine
 * numbers virtually always include one — this rejects plain-word guesses
 * like "Whfa"), and not a single repeated character.
 */
export function isPlausibleEngineNumber(value: string): boolean {
  const clean = value.trim();
  if (clean.length < 4 || clean.length > 20) return false;
  if (!/^[A-Za-z0-9-]+$/.test(clean)) return false;
  if (!/\d/.test(clean)) return false;
  return !/^(.)\1*$/.test(clean.replace(/-/g, ''));
}

/**
 * Lenient license-plate shape check — deliberately not a strict Angola
 * plate-format regex, since that format isn't confirmed anywhere in this
 * repo and a wrong strict pattern would reject real plates. Just requires
 * a plausible length with both letters and digits present.
 */
export function isPlausibleLicensePlate(value: string): boolean {
  // Length bound applies to the alphanumeric content only — real plates
  // commonly include dashes/spaces as separators (e.g. "LD-23-45-AB").
  const alphanumeric = value.replace(/[^A-Za-z0-9]/g, '');
  if (alphanumeric.length < 5 || alphanumeric.length > 8) return false;
  return /[A-Za-z]/.test(alphanumeric) && /\d/.test(alphanumeric);
}

/**
 * Year-plausibility check shared by the manual vehicle-entry wizard and the
 * vision-extracted-year check — extracted from what was previously an
 * inline check only in the manual-entry path. Range is strictly 1980 through
 * the current calendar year (no next-year allowance).
 */
export function isPlausibleYear(value: string): boolean {
  const yearClean = value.replace(/\D/g, '');
  const yearInt = parseInt(yearClean, 10);
  const currentYear = new Date().getFullYear();
  return !!yearClean && yearClean.length === 4 && yearInt >= 1980 && yearInt <= currentYear;
}

const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Verifies a 17-character VIN's ISO 3779 check digit (position 9) via the
 * standard transliteration + weighted mod-11 algorithm. Note: the check
 * digit is an SAE/NHTSA requirement enforced strictly on North American
 * VINs, but not all manufacturers elsewhere populate it correctly — a
 * genuine non-US-market VIN (common for vehicles imported into Angola from
 * Europe/Asia) can legitimately fail this. Callers should treat a failure
 * as "needs confirmation", not an automatic hard rejection.
 */
export function isValidVinChecksum(vin: string): boolean {
  const clean = vin.trim().toUpperCase();
  if (clean.length !== 17) return false;

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const char = clean[i];
    const value = /\d/.test(char) ? Number(char) : VIN_TRANSLITERATION[char];
    if (value === undefined) return false;
    sum += value * VIN_WEIGHTS[i];
  }

  const remainder = sum % 11;
  const expected = remainder === 10 ? 'X' : String(remainder);
  return clean[8] === expected;
}

/**
 * Flags a customer or vehicle record for staff follow-up after a field kept
 * failing validation past `MAX_VALIDATION_ATTEMPTS` — sets `needs_review` and
 * records which field/why directly on the row. No alert or WhatsApp push:
 * the admin panel is expected to surface these columns from the customer/vehicle
 * data it already fetches.
 */
export async function flagForReview(
  kind: 'customer' | 'vehicle',
  recordId: string | number,
  field: string,
  reason: string
): Promise<void> {
  const message = `${field}: ${reason}`;

  if (kind === 'customer') {
    await updateCustomer(recordId as string, { needs_review: true, needs_review_reason: message });
  } else {
    await updateManualCollection(recordId as number, { needs_review: true, needs_review_reason: message });
  }
}
