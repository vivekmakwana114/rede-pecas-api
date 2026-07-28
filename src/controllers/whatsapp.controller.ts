import { Request, Response } from 'express';
import { logger } from '../config/logger.js';
import * as customerService from '../services/customer.service.js';
import * as vehicleService from '../services/vehicle.service.js';
import * as productService from '../services/product.service.js';
import * as paymentService from '../services/payment.service.js';
import * as sessionService from '../services/session.service.js';
import { extractProductNames } from '../services/ai.service.js';
import { sendReply, sendReplyButtons } from '../services/reply.service.js';
import { sendWhatsAppButtons, sendTypingIndicator } from '../services/whatsapp.service.js';
import { getAdminByPhone } from '../models/adminUser.model.js';
import { config } from '../config/config.js';
import { GREETING_PATTERN, detectMessageLocale } from '../utils/greeting.js';

const HUMAN_HANDOFF_PATTERN = /\b(atendente|humano|falar com (algu[eé]m|pessoa)|operador|suporte humano|human|agent|representative)\b/i;

const ACKNOWLEDGMENT_PATTERN = /^(ok(ay)?|k+|t[áa]\s*bem|obrigad[oa]s?|valeu|thanks?|thank\s*you|cool|perfeito|beleza|👍+|🙏+|✅+)[.!?\s]*$/i;

/**
 * Backs the GET webhook verification handshake required by Meta — echoes back
 * the challenge string if the request's verify token matches the configured one, otherwise responds 403.
 */
export async function verifyWebhook(req: Request, res: Response): Promise<void> {
  const verifyToken = config.whatsapp.verifyToken;
  if (
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === verifyToken
  ) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
}

/**
 * Backs the POST webhook message intake — responds 200 to Meta immediately
 * (its 5-second rule), then extracts the inbound message's text/media/button/list-reply fields and hands them off to `processMessageFlow` asynchronously.
 */
export async function receiveWebhookMessage(req: Request, res: Response): Promise<void> {
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    if (!msg) return;

    await sendTypingIndicator(msg.id);

    const phone = msg.from;
    const customerText =
      msg.type === 'text' ? msg.text?.body :
      msg.type === 'interactive' ? (msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title) :
      msg.type === 'button' ? msg.button?.text :
      null;
    const listReplyId: string | null = msg.type === 'interactive' ? (msg.interactive?.list_reply?.id || null) : null;
    const buttonReplyId: string | null = msg.type === 'interactive' ? (msg.interactive?.button_reply?.id || null) : null;
    const contextMessageId: string | null = msg.context?.id || null;
    const mediaType = msg.type;
    const mediaId = msg.image?.id || msg.document?.id || null;

    logger.debug(`[${phone}] Webhook type: ${mediaType}, text: ${customerText}`);

    await processMessageFlow(phone, customerText, mediaType, mediaId, listReplyId, buttonReplyId, contextMessageId);
  } catch (error: any) {
    logger.error('Error in WhatsApp webhook processing', error);
  }
}

/**
 * Routes a single inbound WhatsApp message through the full conversation pipeline
 * — admin short-circuit, locale detection, registration/vehicle-ID state machines, payment flow, product search,
 * and human handoff — in strict priority order, stopping at whichever stage handles the message first.
 */
async function processMessageFlow(
  phone: string,
  customerText: string | null,
  mediaType: string,
  mediaId: string | null,
  listReplyId: string | null = null,
  buttonReplyId: string | null = null,
  contextMessageId: string | null = null
): Promise<void> {
  const admin = await getAdminByPhone(phone);
  if (admin) {
    logger.debug(`[ADMIN] Inbound message from admin ${phone} (${admin.name}) routed to admin handler, buttonReplyId=${buttonReplyId}`);
    if (buttonReplyId?.startsWith('admin_approve_payment_') || buttonReplyId?.startsWith('admin_reject_payment_')) {
      await paymentService.processAdminPaymentReply(phone, buttonReplyId);
    } else if (buttonReplyId?.startsWith('admin_item_')) {
      await productService.processAdminItemStockReply(phone, buttonReplyId);
    } else {
      await productService.processAdminStockReply(phone, buttonReplyId);
    }
    return;
  }

  if (customerText) {
    const detected = detectMessageLocale(customerText);
    if (detected) await sessionService.saveLocale(phone, detected);
    await sessionService.saveLastMessage(phone, customerText);
  }

  const chatLogText = customerText || (mediaId ? `[${mediaType}]` : null);
  if (chatLogText) {
    await sessionService.appendChatMessage(phone, 'in', chatLogText);
  }

  const customer = await customerService.getOrCreateCustomer(phone);
  if (!customer) return;

  const firstName = customer.name?.split(' ')[0] || 'Cliente';
  const messages = await customerService.resolveMessages(phone);

  const freshSession = await sessionService.isNewSession(phone);
  await sessionService.markSessionActive(phone);

  const activeCollection = await vehicleService.getActiveManualCollection(phone);
  const needsVehicleId = customer.registration_status === 'complete' && !activeCollection
    ? !(await vehicleService.hasVehicleOnFile(phone))
    : false;

  if (freshSession && customer.registration_status === 'complete' && !needsVehicleId) {
    const firstName = customer.name?.split(' ')[0] || 'Cliente';
    await sendReply(phone, messages.onboarding.welcomeBack(firstName), { contextual: true });
    if (!mediaId) {
      const askedPart = await vehicleService.sendAskPartPrompt(phone);
      if (askedPart) return;
    }
  }

  if (freshSession && needsVehicleId) {
    const firstName = customer.name?.split(' ')[0] || 'Cliente';
    await sendReplyButtons(phone, messages.onboarding.resumeVehicleIdBody(firstName), messages.onboarding.askVehicleIdButtons);
    return;
  }

  if (freshSession && customer.registration_status !== 'complete') {
    await customerService.sendResumeRegistrationPrompt(phone, customer);
    return;
  }

  if (mediaType === 'interactive' && contextMessageId) {
    const activePromptId = await sessionService.getActivePromptId(phone);
    if (activePromptId && activePromptId !== contextMessageId) {
      await sendReply(phone, messages.common.alreadyAnswered());
      return;
    }
  }

  if (customer.registration_status !== 'complete') {
    if (!customerText) return;
    const handled = await customerService.processCustomerRegistration(phone, customer, customerText);
    if (handled) return;
  }

  if (!needsVehicleId && customerText && vehicleService.isAddVehicleRequest(customerText)) {
    await vehicleService.startAddVehicleFlow(phone);
    return;
  }

  const documentRetryChoiceShown = await sessionService.wasDocumentRetryChoiceShown(phone);
  if (documentRetryChoiceShown && customerText) {
    const handled = await vehicleService.processDocumentRetryChoice(phone, customerText);
    if (handled) return;
  }

  const vinDecodeFailedChoiceShown = await sessionService.wasVinDecodeFailedShown(phone);
  if (vinDecodeFailedChoiceShown && customerText) {
    const handled = await vehicleService.processVinDecodeFailedChoice(phone, customerText);
    if (handled) return;
  }

  const vehicleIdChoiceShown = await sessionService.wasVehicleIdChoiceShown(phone);

  if ((needsVehicleId || vehicleIdChoiceShown) && customerText) {
    const handled = await vehicleService.processVehicleIdOptionChoice(phone, customerText);
    if (handled) return;
  }

  const awaitingVehicleId = needsVehicleId || !!activeCollection || vehicleIdChoiceShown;

  if (mediaType === 'image' && mediaId && awaitingVehicleId) {
    await vehicleService.processVehicleDocument(phone, mediaId);
    return;
  }

  if (mediaType === 'image' || mediaType === 'document') {
    if (mediaId) {
      const proofFirstName = customer.name?.split(' ')[0] || 'Cliente';
      const handled = await paymentService.processPaymentProof(phone, mediaId, mediaType, proofFirstName);
      if (handled) return;
    }
  }

  if (!customerText) return;

  if (activeCollection) {
    const handled = await vehicleService.processManualCollectionStep(phone, activeCollection, customerText, customer);
    if (handled) return;
  }

  if (vehicleService.isVIN(customerText)) {
    await vehicleService.processVIN(phone, customerText);
    return;
  }

  const vehicleChoiceHandled = await vehicleService.resolvePendingVehicleChoice(phone, customerText);
  if (vehicleChoiceHandled) return;

  const vinDuplicateChoiceShown = await sessionService.wasVinDuplicateChoiceShown(phone);
  if (vinDuplicateChoiceShown) {
    const handled = await vehicleService.processVinDuplicateChoice(phone, customerText);
    if (handled) return;
  }

  const pendingWaitlistOffer = await sessionService.getPendingWaitlistOffer(phone);
  if (pendingWaitlistOffer) {
    const handled = await productService.processWaitlistOptIn(phone, customerText, pendingWaitlistOffer);
    if (handled) return;
  }

  const pendingServiceOffer = await sessionService.getPendingServiceOffer(phone);
  if (pendingServiceOffer) {
    const handled = await productService.processServiceSelection(phone, customerText, listReplyId, pendingServiceOffer);
    if (handled) return;
  }

  const pendingStockUnavailableOffer = await sessionService.getPendingStockUnavailableOffer(phone);
  if (pendingStockUnavailableOffer) {
    const stockUnavailableFirstName = customer.name?.split(' ')[0] || 'Cliente';
    const handled = await productService.processStockUnavailableChoice(phone, customerText, pendingStockUnavailableOffer, stockUnavailableFirstName);
    if (handled) return;
  }

  const basketConfirmShown = await sessionService.wasBasketConfirmShown(phone);
  if (basketConfirmShown) {
    const basket = await sessionService.getPendingBasket(phone);
    if (basket) {
      const handled = await productService.processBasketConfirmation(phone, customerText, basket);
      if (handled) return;
    }
  }

  const pendingRestockOrderOffer = await sessionService.getPendingRestockOrderOffer(phone);
  if (pendingRestockOrderOffer) {
    const handled = await productService.processRestockOrderChoice(phone, customerText, pendingRestockOrderOffer);
    if (handled) return;
  }

  const confirmedVehicle = await vehicleService.processVehicleConfirmation(phone, customerText, customer);
  if (confirmedVehicle) return;

  if (needsVehicleId || vehicleIdChoiceShown) {
    if (GREETING_PATTERN.test(customerText.trim())) {
      if (needsVehicleId) {
        const firstName = customer.name?.split(' ')[0] || 'Cliente';
        await sendReplyButtons(phone, messages.onboarding.resumeVehicleIdBody(firstName), messages.onboarding.askVehicleIdButtons);
        return;
      }
      await sessionService.clearVehicleIdChoiceShown(phone);
    } else {
      const trimmed = customerText.trim();
      if (vehicleService.looksLikeVinAttempt(trimmed)) {
        await sendReplyButtons(phone, messages.vin.invalidLength(trimmed.length), messages.onboarding.askVehicleIdButtons);
      } else {
        const notUnderstoodRes = await sendWhatsAppButtons(phone, messages.common.notUnderstood(), messages.onboarding.askVehicleIdButtons);
        await sessionService.saveActivePromptId(phone, notUnderstoodRes?.messages?.[0]?.id);
      }
      await sessionService.markVehicleIdChoiceShown(phone);
      return;
    }
  }

  const latestOrder = await paymentService.getPendingPaymentOrder(phone);

  if (latestOrder) {
    const handled = latestOrder.status === 'awaiting_payment_method'
      ? await paymentService.processMethodChoice(phone, customerText)
      : await paymentService.processMethodSubtype(phone, customerText);
    if (handled) return;
  }

  const invitedToAskForPart = await sessionService.wasPartPromptSent(phone);
  const isGreeting = GREETING_PATTERN.test(customerText.trim());
  if (!invitedToAskForPart || isGreeting) {
    const greeting = isGreeting ? { name: customer.name?.split(' ')[0] || 'Cliente' } : undefined;
    const asked = await vehicleService.sendAskPartPrompt(phone, greeting);
    if (asked) return;
  }

  const pendingProductOptions = await sessionService.getPendingOptions(phone);
  if (pendingProductOptions) {
    const alternativeOffer = await sessionService.getPendingAlternativeOffer(phone);
    if (alternativeOffer) {
      const handled = await productService.processAlternativeSelection(phone, customerText, listReplyId, pendingProductOptions, alternativeOffer);
      if (handled) return;
    } else {
      const basket = await sessionService.getPendingBasket(phone);
      const handled = basket
        ? await productService.processBasketProductSelection(phone, customerText, listReplyId, pendingProductOptions, basket)
        : await productService.processProductSelection(phone, customerText, listReplyId, pendingProductOptions);
      if (handled) return;
    }
  }

  if (HUMAN_HANDOFF_PATTERN.test(customerText)) {
    await sendReply(phone, messages.agent.transferToHuman(), { contextual: true });
    logger.info(`[SUPPORT] Customer ${phone} requested human support.`);
    return;
  }

  if (ACKNOWLEDGMENT_PATTERN.test(customerText.trim())) {
    logger.debug(`[PRODUCT SEARCH] ${phone} sent a filler acknowledgment ("${customerText}") — not treating it as a search.`);
    return;
  }

  const productNames = await extractProductNames(customerText);
  if (productNames && productNames.length > 1) {
    await productService.startBasketSearch(phone, productNames, firstName);
    return;
  }

  await productService.searchAndRespond(phone, customerText, firstName);
}
