import {
  getAndUpdateCustomer,
  createCustomerPreRegistration,
  updateCustomer,
  getCustomerByPhone,
  Customer
} from '../models/customer.model.js';
import { sendReply, sendReplyButtons } from './reply.service.js';
import { sendWhatsAppMessage } from './whatsapp.service.js';
import {
  markSessionActive,
  markPartPromptSent,
  markVehicleIdChoiceShown,
  getLocale,
  saveCustomerName,
  incrementValidationAttempts,
  clearValidationAttempts
} from './session.service.js';
import { capitalize } from '../utils/helpers.js';
import { getMessages, DEFAULT_LOCALE } from '../i18n/messages.js';
import { validateFreeText, isPlausibleName, isPlausibleNif, flagForReview, MAX_VALIDATION_ATTEMPTS } from './validation.service.js';

export type { Customer };

/**
 * Resolves the locale to use for a phone's customer-facing replies, falling
 * back to the app's default locale when nothing has been detected yet this session.
 */
export async function resolveLocale(phone: string): Promise<'pt' | 'en'> {
  return (await getLocale(phone)) ?? DEFAULT_LOCALE;
}

/**
 * Resolves the full localized message bundle for a phone number, based on
 * its currently resolved locale.
 */
export async function resolveMessages(phone: string) {
  return getMessages(await resolveLocale(phone));
}

/**
 * Loads an existing customer by phone, caching their first name into the
 * session, or starts pre-registration and sends the welcome message for a brand-new one.
 */
export async function getOrCreateCustomer(phone: string): Promise<Customer | null> {
  const customer = await getAndUpdateCustomer(phone);
  if (customer) {
    if (customer.name) await saveCustomerName(phone, customer.name.split(' ')[0]);
    return customer;
  }

  await createCustomerPreRegistration(phone, 'awaiting_name');
  await markSessionActive(phone);
  await sendWhatsAppMessage(phone, (await resolveMessages(phone)).onboarding.welcome());
  return null;
}

/**
 * Advances the profile-registration state machine one step (name → NIF →
 * NIF number → address → complete) based on the customer's current status and their latest reply.
 */
export async function processCustomerRegistration(phone: string, customer: Customer, reply: string): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const r = reply.trim();
  const status = customer.registration_status;
  const firstName = customer.name?.split(' ')[0] || 'Cliente';

  if (status === 'awaiting_name') {
    const name = capitalize(r);

    if (!isPlausibleName(name)) {
      const attempts = await incrementValidationAttempts(phone, 'name');
      if (attempts < MAX_VALIDATION_ATTEMPTS) {
        await sendReply(phone, messages.validation.invalidName());
        return true;
      }
      await flagForReview('customer', phone, 'name', `Failed format check after ${MAX_VALIDATION_ATTEMPTS} attempts: "${name}"`);
    } else {
      await clearValidationAttempts(phone, 'name');
    }

    await updateCustomer(phone, { name, registration_status: 'awaiting_nif' });
    await sendReplyButtons(phone, messages.onboarding.askNifBody(name), messages.onboarding.askNifButtons);
    return true;
  }

  if (status === 'awaiting_nif') {
    const rLower = r.toLowerCase();
    // \b-bounded "no" avoids false substring matches on words like "not" or
    // "know" — plain .includes('no') would wrongly treat those as declining.
    const noNif = rLower.includes('não') || rLower.includes('nao') || rLower.includes('❌')
      || /\bno\b/.test(rLower) || rLower.includes('nope') || rLower === 'n' || r === '2';

    if (noNif) {
      await updateCustomer(phone, { nif: null, registration_status: 'awaiting_address' });
      await sendReply(phone, messages.onboarding.askAddress(firstName));
    } else {
      await updateCustomer(phone, { registration_status: 'awaiting_nif_number' });
      await sendReply(phone, messages.onboarding.askNifNumber());
    }
    return true;
  }

  if (status === 'awaiting_nif_number') {
    const nif = r.replace(/\s/g, '').toUpperCase();

    if (!isPlausibleNif(nif)) {
      const attempts = await incrementValidationAttempts(phone, 'nif');
      if (attempts < MAX_VALIDATION_ATTEMPTS) {
        await sendReply(phone, messages.validation.invalidNif());
        return true;
      }
      await flagForReview('customer', phone, 'nif', `Failed format check after ${MAX_VALIDATION_ATTEMPTS} attempts: "${nif}"`);
    } else {
      await clearValidationAttempts(phone, 'nif');
    }

    await updateCustomer(phone, { nif, registration_status: 'awaiting_address' });
    await sendReply(phone, messages.onboarding.askAddress(firstName));
    return true;
  }

  if (status === 'awaiting_address') {
    const rLower = r.toLowerCase();
    const skipped = rLower === 'saltar' || rLower === 'skip';

    if (!skipped) {
      const result = await validateFreeText('address', r);
      if (!result.valid) {
        const attempts = await incrementValidationAttempts(phone, 'address');
        if (attempts < MAX_VALIDATION_ATTEMPTS) {
          await sendReply(phone, messages.validation.invalidAddress());
          return true;
        }
        await flagForReview('customer', phone, 'address', result.reason || `Failed plausibility check after ${MAX_VALIDATION_ATTEMPTS} attempts: "${r}"`);
      } else {
        await clearValidationAttempts(phone, 'address');
      }
    }

    const address = skipped ? null : r;

    await updateCustomer(phone, {
      address,
      registration_status: 'complete',
    });

    const cust = await getCustomerByPhone(phone);
    const name = cust?.name?.split(' ')[0] || 'Cliente';

    await sendReplyButtons(phone, messages.onboarding.askVehicleIdBody(name), messages.onboarding.askVehicleIdButtons);
    await markVehicleIdChoiceShown(phone);
    return true;
  }

  return false;
}

/**
 * Re-sends the appropriate registration prompt for a returning customer
 * whose profile is still incomplete, based on whichever status they stopped at.
 */
export async function sendResumeRegistrationPrompt(phone: string, customer: Customer): Promise<void> {
  const messages = await resolveMessages(phone);
  await sendReply(phone, messages.onboarding.resumeRegistration());

  if (customer.registration_status === 'awaiting_name') {
    await sendReply(phone, messages.onboarding.askNameOnly());
  } else if (customer.registration_status === 'awaiting_nif') {
    const name = customer.name?.split(' ')[0] || 'Cliente';
    await sendReplyButtons(phone, messages.onboarding.askNifBody(name), messages.onboarding.askNifButtons);
  } else if (customer.registration_status === 'awaiting_nif_number') {
    await sendReply(phone, messages.onboarding.askNifNumber());
  } else if (customer.registration_status === 'awaiting_address') {
    const firstName = customer.name?.split(' ')[0] || 'Cliente';
    await sendReply(phone, messages.onboarding.askAddress(firstName));
  }
}

/**
 * Stamps a customer's registered_at timestamp and sends the combined
 * welcome/onboarding-complete message the first time they get a confirmed vehicle on file.
 */
export async function completeOnboardingIfNeeded(
  phone: string,
  customer: Customer,
  vehicleSummary: string
): Promise<boolean> {
  if (customer.registered_at) return false;

  const messages = await resolveMessages(phone);
  await updateCustomer(phone, { registered_at: new Date() });

  const name = customer.name?.split(' ')[0] || 'Cliente';
  await sendReplyButtons(
    phone,
    messages.onboarding.onboardingComplete(name, vehicleSummary),
    [messages.vehicleConfirm.addVehicleButton()]
  );
  await markPartPromptSent(phone);
  return true;
}
