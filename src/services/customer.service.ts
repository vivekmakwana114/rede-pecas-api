import {
  getAndUpdateCustomer,
  createCustomerPreRegistration,
  updateCustomer,
  Customer
} from '../models/customer.model.js';
import { sendReply, sendReplyButtons } from './reply.service.js';
import { extractBoldTerms } from './humanize.service.js';
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
import { isPlausibleName, flagForReview, MAX_VALIDATION_ATTEMPTS } from './validation.service.js';

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
 * Advances the profile-registration state machine (name → complete) based on
 * the customer's current status and their latest reply. NIF/address/
 * customer_type are no longer collected here — they're captured per order,
 * once the customer has confirmed what they're buying (see
 * orderProfile.service.ts), not at first contact.
 */
export async function processCustomerRegistration(phone: string, customer: Customer, reply: string, _buttonReplyId?: string | null): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const r = reply.trim();
  const status = customer.registration_status;

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

    await updateCustomer(phone, { name, registration_status: 'complete' });

    await sendReplyButtons(phone, messages.onboarding.askVehicleIdBody(name), messages.onboarding.askVehicleIdButtons);
    await markVehicleIdChoiceShown(phone);
    return true;
  }

  return false;
}

/**
 * Re-sends the appropriate registration prompt for a returning customer
 * whose profile is still incomplete — only 'awaiting_name' remains today.
 */
export async function sendResumeRegistrationPrompt(phone: string, customer: Customer): Promise<void> {
  const messages = await resolveMessages(phone);
  await sendReply(phone, messages.onboarding.resumeRegistration());

  if (customer.registration_status === 'awaiting_name') {
    const askName = messages.onboarding.askNameOnly();
    await sendReply(phone, askName, { preserve: extractBoldTerms(askName) });
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
