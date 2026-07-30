import { getCustomerByPhone, updateCustomer } from '../models/customer.model.js';
import { sendReply, sendReplyButtons } from './reply.service.js';
import { resolveMessages } from './customer.service.js';
import { requestStockConfirmation } from './product.service.js';
import {
  savePendingOrderProfileShortcut,
  clearPendingOrderProfileShortcut,
  saveOrderProfileStage,
  clearOrderProfileStage,
  incrementValidationAttempts,
  clearValidationAttempts,
  PendingOrderProfileShortcut,
  OrderProfileStage
} from './session.service.js';
import { isPlausibleNif, validateFreeText, flagForReview, MAX_VALIDATION_ATTEMPTS } from './validation.service.js';

/**
 * Kicks off (or shortcuts) the individual/company + NIF + address capture
 * for a just-confirmed order, right before stock is checked with suppliers
 * — see CLAUDE.md's message pipeline for where this replaces the old
 * registration-time NIF/address stages.
 */
export async function startOrderProfileCapture(phone: string, orderNumber: string): Promise<void> {
  const messages = await resolveMessages(phone);
  const customer = await getCustomerByPhone(phone);
  const firstName = customer?.name?.split(' ')[0] || 'Cliente';

  const hasSavedProfile =
    !!customer?.customer_type &&
    !!customer?.address &&
    (customer.customer_type === 'individual' || !!customer.nif);

  if (hasSavedProfile && customer) {
    await savePendingOrderProfileShortcut(phone, { orderNumber });
    await sendReplyButtons(
      phone,
      messages.orderProfile.savedProfileSummary(firstName, customer.address!, customer.customer_type as 'individual' | 'company', customer.nif),
      [messages.orderProfile.savedProfileUseButton(), messages.orderProfile.savedProfileEditButton()],
      ['order_profile_use_saved', 'order_profile_edit']
    );
    return;
  }

  await saveOrderProfileStage(phone, { orderNumber, stage: 'awaiting_type' });
  await sendReplyButtons(
    phone,
    messages.orderProfile.askCustomerTypeBody(firstName),
    messages.orderProfile.askCustomerTypeButtons,
    ['customer_type_individual', 'customer_type_company']
  );
}

/**
 * Handles the customer's reply to the saved-profile shortcut: "use saved"
 * proceeds straight to stock confirmation, "edit" drops into the fresh
 * wizard (overwriting the saved profile), anything else re-sends the
 * identical prompt rather than guessing.
 */
export async function processProfileShortcutReply(
  phone: string,
  buttonReplyId: string | null,
  pending: PendingOrderProfileShortcut
): Promise<boolean> {
  if (buttonReplyId === 'order_profile_use_saved') {
    await clearPendingOrderProfileShortcut(phone);
    await requestStockConfirmation(phone, pending.orderNumber);
    return true;
  }

  if (buttonReplyId === 'order_profile_edit') {
    await clearPendingOrderProfileShortcut(phone);
    const messages = await resolveMessages(phone);
    const customer = await getCustomerByPhone(phone);
    const firstName = customer?.name?.split(' ')[0] || 'Cliente';
    await saveOrderProfileStage(phone, { orderNumber: pending.orderNumber, stage: 'awaiting_type' });
    await sendReplyButtons(
      phone,
      messages.orderProfile.askCustomerTypeBody(firstName),
      messages.orderProfile.askCustomerTypeButtons,
      ['customer_type_individual', 'customer_type_company']
    );
    return true;
  }

  const messages = await resolveMessages(phone);
  await sendReplyButtons(
    phone,
    messages.orderProfile.savedProfileNotUnderstood(),
    [messages.orderProfile.savedProfileUseButton(), messages.orderProfile.savedProfileEditButton()],
    ['order_profile_use_saved', 'order_profile_edit']
  );
  return true;
}

/**
 * Commits the captured customer_type/nif/address to the customer's profile
 * (last-known values, reused as the saved-profile shortcut on future orders)
 * and proceeds to stock confirmation for this order.
 */
async function finalizeOrderProfile(
  phone: string,
  orderNumber: string,
  customerType: 'individual' | 'company',
  nif: string | null,
  address: string | null
): Promise<void> {
  await clearOrderProfileStage(phone);
  await updateCustomer(phone, { customer_type: customerType, nif, address });
  const messages = await resolveMessages(phone);
  await sendReply(phone, messages.orderProfile.allSet());
  await requestStockConfirmation(phone, orderNumber);
}

const NIF_YES_PATTERN = /\b(sim|yes)\b|✅|^s$|^y$|^1$/i;
const NIF_NO_PATTERN = /\b(n[ãa]o|no|nope)\b|❌|^n$|^2$/i;

/**
 * Advances the in-progress individual/company + NIF + address wizard one
 * step, branching by path: company asks NIF first (required, validated,
 * re-asked on failure) then address; individual asks address first, then an
 * optional NIF yes/no, then the NIF number only if yes. The final step of
 * either path commits the profile and moves on to stock confirmation.
 */
export async function processOrderProfileStep(
  phone: string,
  customerText: string,
  buttonReplyId: string | null,
  stage: OrderProfileStage
): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const r = customerText.trim();

  if (stage.stage === 'awaiting_type') {
    if (buttonReplyId === 'customer_type_individual') {
      const customer = await getCustomerByPhone(phone);
      const firstName = customer?.name?.split(' ')[0] || 'Cliente';
      await saveOrderProfileStage(phone, { ...stage, stage: 'awaiting_individual_address', customerType: 'individual' });
      await sendReply(phone, messages.orderProfile.askIndividualAddressBody(firstName));
      return true;
    }
    if (buttonReplyId === 'customer_type_company') {
      await saveOrderProfileStage(phone, { ...stage, stage: 'awaiting_company_nif', customerType: 'company' });
      await sendReply(phone, messages.orderProfile.askCompanyNifBody());
      return true;
    }
    await sendReplyButtons(phone, messages.common.notUnderstood(), messages.orderProfile.askCustomerTypeButtons, ['customer_type_individual', 'customer_type_company']);
    return true;
  }

  if (stage.stage === 'awaiting_company_nif') {
    const nif = r.replace(/\s/g, '').toUpperCase();
    if (!isPlausibleNif(nif)) {
      const attempts = await incrementValidationAttempts(phone, 'nif');
      if (attempts < MAX_VALIDATION_ATTEMPTS) {
        await sendReply(phone, messages.orderProfile.askCompanyNifInvalid());
        return true;
      }
      await flagForReview('customer', phone, 'nif', `Failed format check after ${MAX_VALIDATION_ATTEMPTS} attempts: "${nif}"`);
    } else {
      await clearValidationAttempts(phone, 'nif');
    }

    const customer = await getCustomerByPhone(phone);
    const firstName = customer?.name?.split(' ')[0] || 'Cliente';
    await saveOrderProfileStage(phone, { ...stage, stage: 'awaiting_company_address', nif });
    await sendReply(phone, messages.orderProfile.askCompanyAddressBody(firstName));
    return true;
  }

  if (stage.stage === 'awaiting_company_address') {
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

    await finalizeOrderProfile(phone, stage.orderNumber, 'company', stage.nif ?? null, r);
    return true;
  }

  if (stage.stage === 'awaiting_individual_address') {
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

    await saveOrderProfileStage(phone, { ...stage, stage: 'awaiting_individual_nif_choice', address: r });
    await sendReplyButtons(phone, messages.orderProfile.askIndividualNifBody(), messages.orderProfile.askIndividualNifButtons, ['order_nif_yes', 'order_nif_no']);
    return true;
  }

  if (stage.stage === 'awaiting_individual_nif_choice') {
    const noNif = buttonReplyId === 'order_nif_no' || NIF_NO_PATTERN.test(r);
    const yesNif = buttonReplyId === 'order_nif_yes' || NIF_YES_PATTERN.test(r);

    if (noNif) {
      await finalizeOrderProfile(phone, stage.orderNumber, 'individual', null, stage.address ?? null);
      return true;
    }
    if (yesNif) {
      await saveOrderProfileStage(phone, { ...stage, stage: 'awaiting_individual_nif_number' });
      await sendReply(phone, messages.orderProfile.askIndividualNifNumberBody());
      return true;
    }
    await sendReplyButtons(phone, messages.common.notUnderstood(), messages.orderProfile.askIndividualNifButtons, ['order_nif_yes', 'order_nif_no']);
    return true;
  }

  if (stage.stage === 'awaiting_individual_nif_number') {
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

    await finalizeOrderProfile(phone, stage.orderNumber, 'individual', nif, stage.address ?? null);
    return true;
  }

  return false;
}
