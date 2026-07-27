import { logger } from '../config/logger.js';
import { config } from '../config/config.js';
import { capitalize } from '../utils/helpers.js';
import {
  getCustomerVehicles,
  getMostRecentVehicle,
  saveVehicleSession,
  clearVehicleSession,
  getActiveManualCollection,
  updateManualCollection,
  startManualCollection,
  getNhtsaVehicle,
  saveNhtsaVehicle,
} from '../models/vehicle.model.js';
import { downloadWhatsAppMedia, sendWhatsAppButtons } from './whatsapp.service.js';
import { sendReply, sendReplyButtons } from './reply.service.js';
import { extractDataWithClaudeVision, VisionData } from './ai.service.js';
import { completeOnboardingIfNeeded, resolveMessages, Customer } from './customer.service.js';
import {
  markPartPromptSent,
  savePendingVehicleChoice,
  getPendingVehicleChoice,
  clearPendingVehicleChoice,
  saveChosenVehicle,
  markVehicleIdChoiceShown,
  clearVehicleIdChoiceShown,
  markVinDuplicateChoiceShown,
  clearVinDuplicateChoice,
  markDocumentRetryChoiceShown,
  clearDocumentRetryChoice,
  markVehicleConfirmShown,
  wasVehicleConfirmShown,
  clearVehicleConfirmShown,
  markVinDecodeFailedShown,
  getVinDecodeFailedVin,
  clearVinDecodeFailedChoice,
  saveActivePromptId,
  incrementValidationAttempts,
  clearValidationAttempts,
} from './session.service.js';
import {
  validateFreeText,
  isPlausibleYear,
  isPlausibleEngineNumber,
  isPlausibleLicensePlate,
  isValidVinChecksum,
  flagForReview,
  MAX_VALIDATION_ATTEMPTS,
} from './validation.service.js';

export { getActiveManualCollection, startManualCollection };

/**
 * Sends the "what part do you need" prompt for a customer with a
 * confirmed vehicle on file — directly if they have one vehicle, or first
 * asking which vehicle it's for when they have several.
 */
export async function sendAskPartPrompt(phone: string, greeting?: { name: string }): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const vehicles = await getCustomerVehicles(phone);
  if (!vehicles.length) return false;

  if (vehicles.length === 1) {
    const v = vehicles[0];
    const body = messages.vehicleConfirm.confirmedAskPart(v.make, v.model, v.year, greeting?.name);
    await sendReplyButtons(phone, body, [messages.vehicleConfirm.addVehicleButton()]);
    await markPartPromptSent(phone);
    return true;
  }

  await savePendingVehicleChoice(phone, vehicles.map(v => ({ id: v.id, make: v.make, model: v.model, year: v.year })));
  const chooseBody = messages.vehicleConfirm.chooseVehiclePrompt(vehicles, greeting?.name);
  await sendReply(phone, chooseBody);
  return true;
}

/**
 * Resolves a customer's reply to the "which vehicle is this for?" prompt,
 * remembering the chosen vehicle and moving on to the part-search prompt.
 */
export async function resolvePendingVehicleChoice(phone: string, reply: string): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const pending = await getPendingVehicleChoice(phone);
  if (!pending) return false;

  const idx = parseInt(reply.trim(), 10) - 1;
  const chosen = pending[idx];
  if (!chosen) {
    await sendReply(phone, messages.vehicleConfirm.vehicleChoiceNotFound());
    return true;
  }

  await clearPendingVehicleChoice(phone);
  await saveChosenVehicle(phone, chosen.id);
  await sendReplyButtons(
    phone,
    messages.vehicleConfirm.confirmedAskPart(chosen.make, chosen.model, chosen.year),
    [messages.vehicleConfirm.addVehicleButton()]
  );
  await markPartPromptSent(phone);
  return true;
}

/**
 * Reports whether a customer has at least one confirmed vehicle on file.
 */
export async function hasVehicleOnFile(phone: string): Promise<boolean> {
  return (await getCustomerVehicles(phone)).length > 0;
}

const ADD_VEHICLE_TRIGGERS = ['outro carro', 'add vehicle', 'novo carro', 'adicionar carro'];

/**
 * Checks whether a free-text message is a customer asking to add another
 * vehicle to their account.
 */
export function isAddVehicleRequest(text: string): boolean {
  const r = text.trim().toLowerCase();
  return ADD_VEHICLE_TRIGGERS.some((trigger) => r.includes(trigger));
}

/**
 * Re-shows the vehicle-ID entry option buttons (VIN/photo/manual) for a
 * customer adding another vehicle to their account.
 */
export async function startAddVehicleFlow(phone: string): Promise<void> {
  const messages = await resolveMessages(phone);
  await sendReplyButtons(phone, messages.vehicleConfirm.addVehicleBody(), messages.onboarding.askVehicleIdButtons);
  await markVehicleIdChoiceShown(phone);
}

const NHTSA_URL = config.nhtsa.apiUrl;

export interface VINInfo {
  vin: string;
  make: string;
  model: string | null;
  year: string;
  vehicle_type?: string | null;
  engine?: string | null;
  fuel_type?: string | null;
  manufacture_country?: string | null;
}

/**
 * Checks whether a string is a syntactically valid 17-character VIN
 * (excluding the letters I, O, and Q).
 */
export function isVIN(text: string): boolean {
  const vin = text.trim().toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

/**
 * Loosely checks whether a string looks like an attempted VIN (10-20
 * alphanumeric characters), used to decide whether a failed strict VIN match
 * still deserves VIN-specific handling.
 */
export function looksLikeVinAttempt(text: string): boolean {
  return /^[A-Za-z0-9]{10,20}$/.test(text.trim());
}

/**
 * Resolves a VIN to vehicle details, serving a cached NHTSA lookup when
 * available or querying the NHTSA decode API and caching a successful
 * result, returning null if the VIN can't be decoded.
 */
export async function decodeVIN(vin: string): Promise<VINInfo | null> {
  const vinClean = vin.toUpperCase();

  const cached = await getNhtsaVehicle(vinClean);
  if (cached) {
    logger.info(`[NHTSA] Cache hit for VIN ${vinClean}`);
    return {
      vin: cached.vin,
      make: cached.make,
      model: cached.model,
      year: cached.year,
      vehicle_type: cached.vehicle_type,
      engine: cached.engine,
      fuel_type: cached.fuel_type,
      manufacture_country: cached.manufacture_country,
    };
  }

  try {
    const res = await fetch(
      `${NHTSA_URL}/${vinClean}?format=json`,
      { signal: AbortSignal.timeout(8000) }
    );

    const data = await res.json() as any;
    if (!data?.Results) return null;

    const extract = (variable: string) =>
      data.Results.find((r: any) => r.Variable === variable)?.Value || null;

    const make = extract("Make");
    const model = extract("Model");
    const year = extract("Model Year");
    const vehicleType = extract("Body Class");
    const displacement = extract("Displacement (L)");
    const fuelType = extract("Fuel Type - Primary");
    const country = extract("Plant Country");
    const errors = extract("Error Text");

    if (!make || !year || errors?.includes("No candidates")) {
      logger.warn(`[NHTSA] No match for VIN ${vin}${errors ? `: ${errors}` : ''}`);
      return null;
    }

    logger.info(`[NHTSA] Decoded VIN ${vin}: ${make} ${model || '(model unresolved)'} ${year}`);

    const result: VINInfo = {
      vin: vinClean,
      make: capitalize(make),
      model: model ? capitalize(model) : null,
      year: year,
      vehicle_type: vehicleType || null,
      engine: displacement ? `${displacement}L` : null,
      fuel_type: translateFuelType(fuelType),
      manufacture_country: country || null,
    };

    if (result.model) {
      await saveNhtsaVehicle(result.vin, result as { model: string } & VINInfo);
    }

    return result;

  } catch (error: any) {
    logger.error(`[VIN] Error decoding chassis ${vin}: ${error.message}`);
    return null;
  }
}

/**
 * Translates an NHTSA fuel-type string into its Portuguese equivalent,
 * leaving unrecognized values unchanged.
 */
function translateFuelType(fuelType: string | null): string | null {
  if (!fuelType) return null;
  const map: { [key: string]: string } = {
    "Gasoline": "Gasolina",
    "Diesel": "Diesel",
    "Electric": "Eléctrico",
    "Hybrid": "Híbrido",
    "Flex Fuel": "Flex (gasolina/etanol)",
    "Natural Gas": "Gás Natural",
  };
  return map[fuelType] || fuelType;
}

/**
 * Handles a customer's tap on the vehicle-ID entry option buttons,
 * routing them into the VIN prompt, photo prompt, or manual-collection wizard.
 */
export async function processVehicleIdOptionChoice(phone: string, reply: string): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const r = reply.toLowerCase();

  if (r.includes('vin')) {
    await sendReply(phone, messages.vin.askVinPrompt());
    return true;
  }

  if (r.includes('foto') || r.includes('photo') || r.includes('documento')) {
    await sendReply(phone, messages.document.askPhotoPrompt());
    return true;
  }

  if (r.includes('manual')) {
    await clearVehicleIdChoiceShown(phone);
    await startManualCollection(phone, 'awaiting_make');
    await sendReply(phone, messages.manual.askMakePrompt());
    return true;
  }

  return false;
}

/**
 * Handles a customer's reply to the "this VIN is already registered"
 * prompt, routing them to a part search or into adding a different vehicle,
 * or re-asking if the reply doesn't match either option.
 */
export async function processVinDuplicateChoice(phone: string, reply: string): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const r = reply.toLowerCase();

  if (r.includes('procurar') || r.includes('search') || r.includes('peça') || r.includes('part') || r === '1' || r.includes('btn_0')) {
    await clearVinDuplicateChoice(phone);
    await clearVehicleIdChoiceShown(phone);
    await sendAskPartPrompt(phone);
    return true;
  }

  if (r.includes('diferente') || r.includes('different') || r.includes('adicionar') || r.includes('add') || r === '2' || r.includes('btn_1')) {
    await clearVinDuplicateChoice(phone);
    await startAddVehicleFlow(phone);
    return true;
  }

  const alreadyRegisteredRes = await sendWhatsAppButtons(phone, messages.common.notUnderstood(), messages.vin.alreadyRegisteredButtons);
  await saveActivePromptId(phone, alreadyRegisteredRes?.messages?.[0]?.id);
  await markVinDuplicateChoiceShown(phone);
  return true;
}

/**
 * Advances the manual vehicle-entry step machine one step (make → model →
 * year → engine number) based on the collection's current status, saving the
 * vehicle and completing onboarding once all steps are done.
 */
export async function processManualCollectionStep(
  phone: string,
  collection: any,
  reply: string,
  customer: Customer
): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const r = reply.trim();

  if (collection.status === 'awaiting_make') {
    const make = capitalize(r);
    const result = await validateFreeText('vehicleMake', make);

    if (!result.valid) {
      const attempts = await incrementValidationAttempts(phone, 'vehicleMake');
      if (attempts < MAX_VALIDATION_ATTEMPTS) {
        await sendReply(phone, messages.validation.invalidMake());
        return true;
      }
      await flagForReview('vehicle', collection.id, 'make', result.reason || `Failed plausibility check after ${MAX_VALIDATION_ATTEMPTS} attempts: "${make}"`);
    } else {
      await clearValidationAttempts(phone, 'vehicleMake');
    }

    await updateManualCollection(collection.id, { make, status: 'awaiting_model' });
    await sendReply(phone, messages.manual.askModel(make));
    return true;
  }

  if (collection.status === 'awaiting_model') {
    const model = capitalize(r);
    const result = await validateFreeText('vehicleModel', model, collection.make);

    if (!result.valid) {
      const attempts = await incrementValidationAttempts(phone, 'vehicleModel');
      if (attempts < MAX_VALIDATION_ATTEMPTS) {
        await sendReply(phone, messages.validation.invalidModel());
        return true;
      }
      await flagForReview('vehicle', collection.id, 'model', result.reason || `Failed plausibility check after ${MAX_VALIDATION_ATTEMPTS} attempts: "${model}"`);
    } else {
      await clearValidationAttempts(phone, 'vehicleModel');
    }

    await updateManualCollection(collection.id, { model, status: 'awaiting_year' });
    await sendReply(phone, messages.manual.askYear(collection.make, model));
    return true;
  }

  if (collection.status === 'awaiting_year') {
    const yearClean = r.replace(/\D/g, '');

    if (!isPlausibleYear(yearClean)) {
      await sendReply(phone, messages.manual.invalidYear());
      return true;
    }

    await updateManualCollection(collection.id, { year: yearClean, status: 'awaiting_engine_number' });
    await sendReply(phone, messages.manual.askEngineNumber(collection.make, collection.model, yearClean));
    return true;
  }

  if (collection.status === 'awaiting_engine_number') {
    // Strip straight/curly apostrophes so "don't know" and "dont know" both
    // match — the en prompt itself tells the customer to type "don't know",
    // which the old pt-only skip-phrase list never recognized, so it fell
    // through to engine-number validation and got rejected as invalid.
    const normalized = r.toLowerCase().replace(/['’]/g, '').trim();
    const SKIP_PHRASES = new Set([
      'não sei', 'nao sei', 'não', 'nao', 'n', 'skip',
      'dont know', 'do not know', 'idk', 'unknown', 'not sure',
    ]);
    const skipped = SKIP_PHRASES.has(normalized);

    let engineNumber: string | null = null;
    if (!skipped) {
      const candidate = r.toUpperCase();
      if (!isPlausibleEngineNumber(candidate)) {
        const attempts = await incrementValidationAttempts(phone, 'engineNumber');
        if (attempts < MAX_VALIDATION_ATTEMPTS) {
          await sendReply(phone, messages.validation.invalidEngineNumber());
          return true;
        }
        await flagForReview('vehicle', collection.id, 'engine_number', `Failed format check after ${MAX_VALIDATION_ATTEMPTS} attempts: "${candidate}"`);
        engineNumber = candidate;
      } else {
        await clearValidationAttempts(phone, 'engineNumber');
        engineNumber = candidate;
      }
    }

    await saveVehicleSession(phone, {
      make: collection.make,
      model: collection.model,
      year: collection.year,
      engine_number: engineNumber,
    }, collection.id);

    const summary = [
      `🚗 *${collection.make} ${collection.model} ${collection.year}*`,
      engineNumber ? messages.manual.engineLabel(engineNumber) : null,
    ].filter(Boolean).join('\n');

    await clearVehicleIdChoiceShown(phone);

    const completedOnboarding = await completeOnboardingIfNeeded(phone, customer, summary);
    if (!completedOnboarding) {
      await sendReplyButtons(phone, messages.manual.collectionComplete(summary), [messages.vehicleConfirm.addVehicleButton()]);
      await markPartPromptSent(phone);
    }
    return true;
  }

  return false;
}

/**
 * Handles a detected 17-character VIN: short-circuits to the
 * already-registered flow if it matches an existing vehicle, otherwise decodes
 * it via NHTSA and either asks the customer to confirm the result or offers
 * the decode-failed fallback.
 */
export async function processVIN(phone: string, vin: string): Promise<void> {
  const messages = await resolveMessages(phone);
  const vinClean = vin.trim().toUpperCase();

  const existing = (await getCustomerVehicles(phone)).find((v) => v.vin === vinClean);
  if (existing) {
    const description = [
      `${existing.make} ${existing.model} ${existing.year}`,
      existing.engine_size || null,
      existing.fuel_type || null,
    ].filter(Boolean).join(' · ');

    await sendReplyButtons(phone, messages.vin.alreadyRegistered(description), messages.vin.alreadyRegisteredButtons);
    await saveChosenVehicle(phone, existing.id);
    await markVinDuplicateChoiceShown(phone);
    return;
  }

  await sendReply(phone, messages.vin.identifying());

  const vehicle = await decodeVIN(vinClean);

  if (!vehicle) {
    await sendReplyButtons(phone, messages.vin.decodeFailed(), messages.vin.decodeFailedButtons);
    await markVinDecodeFailedShown(phone, vinClean);
    return;
  }

  await saveVehicleSession(phone, {
    vin: vinClean,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    fuel_type: vehicle.fuel_type,
    engine_size: vehicle.engine,
  });

  if (!isValidVinChecksum(vinClean)) {
    // NHTSA still resolved this VIN, so we don't block the customer — the
    // check digit isn't reliably populated on non-US-market VINs — but we
    // flag it so staff can double-check for a transcription error.
    const saved = await getMostRecentVehicle(phone);
    if (saved) {
      await flagForReview('vehicle', saved.id, 'vin', `NHTSA decoded this VIN, but it failed the ISO 3779 check-digit verification: "${vinClean}"`);
    }
  }

  const description = [
    vehicle.model
      ? `${vehicle.make} ${vehicle.model} ${vehicle.year}`
      : `${vehicle.make} ${vehicle.year}`,
    vehicle.model ? null : messages.vin.modelUnknownNote(),
    vehicle.engine ? `${vehicle.engine}` : null,
    vehicle.fuel_type ? `${vehicle.fuel_type}` : null,
    vehicle.vehicle_type ? `${vehicle.vehicle_type}` : null,
  ].filter(Boolean).join(' · ');

  await sendReplyButtons(phone, messages.vin.confirmBody(description), messages.vin.confirmButtons);
  await markVehicleConfirmShown(phone);
}

/**
 * Handles a customer's reply to the VIN-decode-failed prompt, routing
 * them into manual collection or back to the vehicle-ID choice buttons, or
 * re-asking if the reply doesn't match either option.
 */
export async function processVinDecodeFailedChoice(phone: string, reply: string): Promise<boolean> {
  const attemptedVin = await getVinDecodeFailedVin(phone);
  if (attemptedVin === null) return false;

  const messages = await resolveMessages(phone);
  const r = reply.toLowerCase();

  if (r.includes('manual') || r === '2' || r.includes('btn_1')) {
    await clearVinDecodeFailedChoice(phone);
    await clearVehicleIdChoiceShown(phone);
    await startManualCollection(phone, 'awaiting_make', attemptedVin);
    await sendReply(phone, messages.manual.askMakePrompt());
    return true;
  }

  if (r.includes('tentar') || r.includes('try again') || r.includes('novamente') || r === '1' || r.includes('btn_0')) {
    await clearVinDecodeFailedChoice(phone);
    await sendReplyButtons(phone, messages.vin.restartChoiceBody(), messages.onboarding.askVehicleIdButtons);
    await markVehicleIdChoiceShown(phone);
    return true;
  }

  const decodeFailedRes = await sendWhatsAppButtons(phone, messages.common.notUnderstood(), messages.vin.decodeFailedButtons);
  await saveActivePromptId(phone, decodeFailedRes?.messages?.[0]?.id);
  await markVinDecodeFailedShown(phone, attemptedVin);
  return true;
}

/**
 * Sends a document-processing failure message along with retry/manual
 * buttons and marks that choice as shown.
 */
async function sendRetryOrManualPrompt(phone: string, body: string): Promise<void> {
  const messages = await resolveMessages(phone);
  await sendReplyButtons(phone, body, messages.document.retryButtons);
  await markDocumentRetryChoiceShown(phone);
}

/**
 * Downloads a vehicle document/VIN photo and runs it through Claude
 * Vision, cross-checking any extracted VIN against NHTSA, then either bounces
 * back a retry/manual prompt on failure or asks the customer to confirm the extracted vehicle.
 */
export async function processVehicleDocument(phone: string, mediaId: string): Promise<void> {
  const messages = await resolveMessages(phone);
  await sendReply(phone, messages.document.received());

  const imageBase64 = await downloadWhatsAppMedia(mediaId);
  if (!imageBase64) {
    await sendRetryOrManualPrompt(phone, messages.document.downloadFailed());
    return;
  }

  let extracted: VisionData | null;
  try {
    extracted = await extractDataWithClaudeVision(imageBase64);
  } catch (error: any) {
    logger.error(`[VISION] Error processing document for ${phone}: ${error.message}`);
    await sendRetryOrManualPrompt(phone, messages.document.processingError());
    return;
  }

  if (!extracted) {
    await sendRetryOrManualPrompt(phone, messages.document.notRecognized());
    return;
  }

  let make = extracted.make || null;
  let model = extracted.model || null;
  let year = extracted.year || null;
  let fuelType = extracted.fuel_type || null;
  let engineSize = extracted.engine_size || null;
  let nhtsaConfirmed = false;
  let chassisChecksumValid: boolean | null = null;

  if (extracted.chassis_number && isVIN(extracted.chassis_number)) {
    chassisChecksumValid = isValidVinChecksum(extracted.chassis_number);
    const decoded = await decodeVIN(extracted.chassis_number.toUpperCase());
    if (decoded) {
      make = decoded.make;
      model = decoded.model;
      year = decoded.year;
      fuelType = decoded.fuel_type;
      engineSize = decoded.engine;
      nhtsaConfirmed = true;
    }
  }

  if (!extracted.valid && !nhtsaConfirmed) {
    logger.info(`[VISION] Document extraction invalid for ${phone}: ${extracted.reason || 'no reason given'}`);
    await sendRetryOrManualPrompt(phone, messages.document.invalid());
    return;
  }

  if (!make || !model) {
    await sendRetryOrManualPrompt(phone, messages.document.missingEssentialData());
    return;
  }

  // Non-essential extracted fields are discarded (not retried) when
  // implausible, same treatment as a missing field — there's no
  // photo-retry loop for a single bad field once make/model are in hand.
  if (year && !isPlausibleYear(year)) {
    logger.info(`[VISION] Implausible year extracted for ${phone}, discarding: "${year}"`);
    year = null;
  }

  let engineNumber = extracted.engine_number || null;
  if (engineNumber && !isPlausibleEngineNumber(engineNumber)) {
    logger.info(`[VISION] Implausible engine number extracted for ${phone}, discarding: "${engineNumber}"`);
    engineNumber = null;
  }

  let licensePlate = extracted.license_plate || null;
  if (licensePlate && !isPlausibleLicensePlate(licensePlate)) {
    logger.info(`[VISION] Implausible license plate extracted for ${phone}, discarding: "${licensePlate}"`);
    licensePlate = null;
  }

  await saveVehicleSession(phone, {
    vin: extracted.chassis_number || null,
    make,
    model,
    year: year || null,
    fuel_type: fuelType,
    engine_size: engineSize,
    engine_number: engineNumber,
    license_plate: licensePlate,
  });

  if (nhtsaConfirmed && chassisChecksumValid === false) {
    // Same non-blocking treatment as the VIN-entry path — NHTSA already
    // confirmed this vehicle, so we flag rather than reject.
    const saved = await getMostRecentVehicle(phone);
    if (saved) {
      await flagForReview('vehicle', saved.id, 'vin', `NHTSA decoded this chassis number, but it failed the ISO 3779 check-digit verification: "${extracted.chassis_number}"`);
    }
  }

  const description = [
    `${make} ${model}${year ? ` ${year}` : ''}`,
    engineSize || null,
    fuelType || null,
    licensePlate ? messages.document.licensePlateLabel(licensePlate) : null,
    extracted.chassis_number ? messages.document.chassisLabel(extracted.chassis_number.toUpperCase()) : null,
  ].filter(Boolean).join(' · ');

  await sendReplyButtons(phone, messages.document.confirmBody(description), messages.vin.confirmButtons);
  await markVehicleConfirmShown(phone);
}

/**
 * Handles a customer's reply to the document-processing retry prompt,
 * routing them into manual collection or back to the photo-upload prompt, or
 * re-asking if the reply doesn't match either option.
 */
export async function processDocumentRetryChoice(phone: string, reply: string): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const r = reply.toLowerCase();

  if (r.includes('manual') || r === '2' || r.includes('btn_1')) {
    await clearDocumentRetryChoice(phone);
    await clearVehicleIdChoiceShown(phone);
    await startManualCollection(phone, 'awaiting_make');
    await sendReply(phone, messages.manual.askMakePrompt());
    return true;
  }

  if (r.includes('tentar') || r.includes('try again') || r.includes('novamente') || r === '1' || r.includes('btn_0')) {
    await clearDocumentRetryChoice(phone);
    await sendReply(phone, messages.document.askPhotoPrompt());
    return true;
  }

  const retryRes = await sendWhatsAppButtons(phone, messages.common.notUnderstood(), messages.document.retryButtons);
  await saveActivePromptId(phone, retryRes?.messages?.[0]?.id);
  await markDocumentRetryChoiceShown(phone);
  return true;
}

/**
 * Handles a customer's Sim/Não reply confirming a decoded/extracted
 * vehicle: on yes, saves the vehicle as chosen and completes onboarding or
 * moves to the part-search prompt; on no, deletes only that rejected vehicle
 * and restarts manual collection; otherwise re-asks the same confirmation.
 */
export async function processVehicleConfirmation(phone: string, reply: string, customer: Customer): Promise<boolean> {
  if (!(await wasVehicleConfirmShown(phone))) return false;

  const messages = await resolveMessages(phone);
  const r = reply.toLowerCase();

  if (r.includes('sim') || r.includes('yes') || r.includes('✅') || r === '1' || r.includes('btn_0')) {
    const v = await getMostRecentVehicle(phone);
    if (!v) return false;

    await saveChosenVehicle(phone, v.id);

    await clearVehicleIdChoiceShown(phone);
    await clearVehicleConfirmShown(phone);

    const summary = `🚗 *${v.make} ${v.model} ${v.year}*`;
    const completedOnboarding = await completeOnboardingIfNeeded(phone, customer, summary);
    if (!completedOnboarding) {
      await sendReplyButtons(
        phone,
        messages.vehicleConfirm.confirmedAskPart(v.make, v.model, v.year),
        [messages.vehicleConfirm.addVehicleButton()]
      );
      await markPartPromptSent(phone);
    }
    return true;
  }

  if (r.includes('não') || r.includes('nao') || r.includes('❌') || r === '2' || r.includes('btn_1')) {
    const rejected = await getMostRecentVehicle(phone);
    if (rejected) await clearVehicleSession(rejected.id);

    await clearVehicleIdChoiceShown(phone);
    await clearVehicleConfirmShown(phone);

    await startManualCollection(phone, 'awaiting_make');
    await sendReply(phone, messages.manual.askMakePrompt());
    return true;
  }

  const pending = await getMostRecentVehicle(phone);
  if (!pending) return false;
  const description = [pending.make, pending.model, pending.year].filter(Boolean).join(' ');
  const confirmRetryRes = await sendWhatsAppButtons(
    phone,
    `${messages.common.notUnderstood()}\n\n🚗 *${description}*`,
    messages.vin.confirmButtons
  );
  await saveActivePromptId(phone, confirmRetryRes?.messages?.[0]?.id);
  await markVehicleConfirmShown(phone);
  return true;
}
