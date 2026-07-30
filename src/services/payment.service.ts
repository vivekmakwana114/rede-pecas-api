import { db } from '../config/db.js';
import { logger } from '../config/logger.js';
import { sendWhatsAppMessage, sendWhatsAppButtons, downloadWhatsAppMedia } from './whatsapp.service.js';
import { saveDocument } from './storage.service.js';
import { sendReply, sendReplyButtons } from './reply.service.js';
import { generateInvoicePDF, sendFinalInvoiceWhatsApp } from './pdf.service.js';
import { extractPaymentProofData } from './ai.service.js';
import { getOrderByNumber, getLatestOrderByStatus, updateOrderStatus, getOrderAmount } from '../models/order.model.js';
import { getSupplierPhoneById } from '../models/supplier.model.js';
import { getCustomerByPhone } from '../models/customer.model.js';
import { getAllAdmins, getAdminByPhone } from '../models/adminUser.model.js';
import { createAlert } from '../models/alert.model.js';
import { formatPrice } from '../utils/helpers.js';
import { t, getMessages } from '../i18n/messages.js';
import { resolveMessages, resolveLocale } from './customer.service.js';

/**
 * Builds the locale-aware catalog of available payment methods (bank
 * transfer, bank deposit, Multicaixa Express, mobile POS), each with its
 * display name, instructions text, and whether it requires a proof upload.
 */
export function getPaymentMethods(locale: 'pt' | 'en') {
  const messages = getMessages(locale);
  return {
    BANK_TRANSFER: {
      id: 'bank_transfer',
      name: messages.payment.methods.bankTransfer.name,
      emoji: '🏦',
      instructions: (orderNumber: string, amount: number) =>
        messages.payment.methods.bankTransfer.instructions(orderNumber, formatPrice(amount)),
      requiresProof: true,
    },

    BANK_DEPOSIT: {
      id: 'bank_deposit',
      name: messages.payment.methods.bankDeposit.name,
      emoji: '🏧',
      instructions: (orderNumber: string, amount: number) =>
        messages.payment.methods.bankDeposit.instructions(orderNumber, formatPrice(amount)),
      requiresProof: true,
    },

    MULTICAIXA_EXPRESS: {
      id: 'multicaixa_express',
      name: messages.payment.methods.multicaixaExpress.name,
      emoji: '📱',
      instructions: (orderNumber: string, amount: number) =>
        messages.payment.methods.multicaixaExpress.instructions(orderNumber, formatPrice(amount)),
      requiresProof: true,
    },

    MOBILE_POS: {
      id: 'mobile_pos',
      name: messages.payment.methods.mobilePOS.name,
      emoji: '💳',
      instructions: (orderNumber: string, amount: number) =>
        messages.payment.methods.mobilePOS.instructions(orderNumber, formatPrice(amount)),
      requiresProof: false,
    },
  };
}

/**
 * Sends the customer the payment-method choice buttons for an order and
 * moves the order into the awaiting_payment_method state.
 */
export async function askPaymentMethod(phone: string, orderNumber: string, amount: number): Promise<void> {
  const messages = await resolveMessages(phone);
  const message = messages.payment.askMethodBody(orderNumber, formatPrice(amount));

  await sendReplyButtons(phone, message, messages.payment.askMethodButtons);

  await db.query(
    `UPDATE orders SET status = 'awaiting_payment_method' WHERE number = $1`,
    [orderNumber]
  );
}

/**
 * Fetches the customer's most recent order still waiting on a payment
 * method or bank-subtype choice, if any.
 */
export async function getPendingPaymentOrder(phone: string) {
  return getLatestOrderByStatus(phone, [
    'awaiting_payment_method',
    'awaiting_bank_subtype',
  ]);
}

/**
 * Interprets the customer's reply to the payment-method prompt, routing
 * bank methods into the bank-subtype sub-choice and confirming Multicaixa
 * Express/Mobile POS directly, or re-asking if the reply is unrecognized.
 */
export async function processMethodChoice(phone: string, customerReply: string): Promise<boolean> {
  const locale = await resolveLocale(phone);
  const messages = getMessages(locale);
  const paymentMethods = getPaymentMethods(locale);
  const { rows } = await db.query(
    `SELECT number FROM orders
     WHERE customer_phone = $1
       AND status = 'awaiting_payment_method'
     ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );
  if (!rows.length) return false;

  const { number } = rows[0];
  const amount = await getOrderAmount(number);
  const reply = customerReply.toLowerCase();

  if (reply.includes('transfer') || reply.includes('deposit') || reply.includes('depósito') || reply.includes('banco') || reply.includes('bank') || reply === '1') {
    await sendReplyButtons(phone, messages.payment.askBankSubtypeBody(), messages.payment.askBankSubtypeButtons);
    await db.query(
      `UPDATE orders SET status = 'awaiting_bank_subtype' WHERE number = $1`,
      [number]
    );
    return true;
  } else if (reply.includes('multicaixa') || reply.includes('express') || reply === '2') {
    await confirmMethodAndSendInstructions(phone, number, amount, paymentMethods.MULTICAIXA_EXPRESS);
    return true;
  } else if (reply.includes('tpa') || reply.includes('terminal') || reply.includes('mobile') || reply.includes('pos') || reply === '3') {
    await confirmMethodAndSendInstructions(phone, number, amount, paymentMethods.MOBILE_POS);
    return true;
  } else {
    await askPaymentMethod(phone, number, amount);
    return true;
  }
}

/**
 * Interprets the customer's reply to the bank-subtype prompt (transfer vs
 * deposit) and confirms the chosen method, re-showing the subtype buttons if
 * the reply doesn't match either option.
 */
export async function processMethodSubtype(phone: string, reply: string): Promise<boolean> {
  const locale = await resolveLocale(phone);
  const messages = getMessages(locale);
  const paymentMethods = getPaymentMethods(locale);
  const { rows } = await db.query(
    `SELECT number FROM orders
     WHERE customer_phone = $1
       AND status = 'awaiting_bank_subtype'
     ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );
  if (!rows.length) return false;

  const { number } = rows[0];
  const amount = await getOrderAmount(number);
  const r = reply.toLowerCase();

  const isDeposit = r.includes('deposit') || r.includes('depósito') || r.includes('deposito') || r === '2';
  const isTransfer = r.includes('transfer') || r.includes('transferência') || r.includes('transferencia') || r === '1';

  if (isDeposit) {
    await confirmMethodAndSendInstructions(phone, number, amount, paymentMethods.BANK_DEPOSIT);
    return true;
  }
  if (isTransfer) {
    await confirmMethodAndSendInstructions(phone, number, amount, paymentMethods.BANK_TRANSFER);
    return true;
  }

  await sendReplyButtons(phone, messages.payment.askBankSubtypeBody(), messages.payment.askBankSubtypeButtons);
  return true;
}

/**
 * Records the chosen payment method on the order, moves it to
 * awaiting-proof or awaiting-agent-confirmation depending on the method, sends
 * the payment instructions, and notifies staff if no proof upload is required.
 */
export async function confirmMethodAndSendInstructions(
  phone: string,
  orderNumber: string,
  amount: number,
  method: any
): Promise<void> {
  await db.query(
    `UPDATE orders
     SET payment_method = $1,
         status = $2
     WHERE number = $3`,
    [
      method.id,
      method.requiresProof ? 'awaiting_payment_proof' : 'awaiting_agent_confirmation',
      orderNumber,
    ]
  );

  await sendWhatsAppMessage(phone, method.instructions(orderNumber, amount));

  if (!method.requiresProof) {
    await notifyAgentInPersonPayment(orderNumber, phone, amount, method);
  }
}

/**
 * Downloads a customer's uploaded payment-proof media, validates it via
 * Claude Vision, and either bounces it back for a retry or marks the order
 * payment_proof_received, alerts the admin panel, and pushes it to admins for approval.
 */
export async function processPaymentProof(
  phone: string,
  mediaId: string,
  mediaType: string | null,
  customerName: string
): Promise<boolean> {
  const locale = await resolveLocale(phone);
  const messages = getMessages(locale);
  const { rows } = await db.query(
    `SELECT number, payment_method FROM orders
     WHERE customer_phone = $1
       AND status = 'awaiting_payment_proof'
     ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );
  if (!rows.length) return false;
  if (mediaType !== 'image' && mediaType !== 'document') return false;

  const { number, payment_method } = rows[0];
  const amount = await getOrderAmount(number);

  await updateOrderStatus(number, 'awaiting_proof_verification');

  const fileBase64 = await downloadWhatsAppMedia(mediaId);
  if (fileBase64) {
    // Persist the proof locally regardless of whether it validates below —
    // never kept before this — so it's still reachable after Meta's ~30-day
    // media id/URL expiry, without a second Graph API round trip.
    await saveDocument(
      phone,
      'payment_proof',
      Buffer.from(fileBase64, 'base64'),
      mediaType === 'document' ? 'application/pdf' : 'image/jpeg',
      number,
      mediaId
    );
  }

  let extracted: Awaited<ReturnType<typeof extractPaymentProofData>> = null;
  if (fileBase64) {
    try {
      extracted = await extractPaymentProofData(fileBase64, mediaType);
    } catch (error: any) {
      logger.error(`[PAYMENT] Vision error validating proof for order ${number} from ${phone}: ${error.message}`);
    }
  }

  if (!extracted || extracted.valid === false) {
    logger.info(
      `[PAYMENT] Rejected proof for order ${number} from ${phone}: ${extracted?.reason || 'could not download/read file'}`
    );
    await updateOrderStatus(number, 'awaiting_payment_proof');
    await sendReply(phone, messages.payment.proofInvalid());
    return true;
  }

  logger.info(
    `[PAYMENT] Proof extracted for order ${number}: amount=${extracted.amount} date=${extracted.date} reference=${extracted.reference}`
  );

  await db.query(
    `UPDATE orders
     SET payment_proof_media_id = $2,
         payment_proof_media_type = $3,
         status = 'payment_proof_received',
         updated_at = NOW()
     WHERE number = $1`,
    [number, mediaId, mediaType]
  );

  const methodName = Object.values(getPaymentMethods(locale))
    .find(m => m.id === payment_method)?.name || payment_method;

  await sendReply(phone, messages.payment.proofReceivedCustomer(customerName));

  await createAlert(
    'payment_proof',
    number,
    `Comprovativo de pagamento recebido para o pedido ${number} (${methodName}, ${formatPrice(amount)}) — cliente ${phone}.`
  );

  await notifyAdminsPaymentProofReceived(number, phone, mediaId, mediaType, amount, methodName, customerName);

  return true;
}

/**
 * Pushes an interactive WhatsApp message to every admin with the payment
 * proof as the header image/document and Approve/Reject buttons attached.
 */
async function notifyAdminsPaymentProofReceived(
  orderNumber: string,
  customerPhone: string,
  mediaId: string,
  mediaType: 'image' | 'document',
  amount: number,
  methodName: string,
  customerName: string
): Promise<void> {
  const body = t.admin.paymentProofReceived(orderNumber, methodName, formatPrice(amount), customerName, customerPhone);
  const admins = await getAllAdmins();

  for (const admin of admins) {
    try {
      await sendWhatsAppButtons(
        admin.phone,
        body,
        [t.admin.approvePaymentButtonLabel(), t.admin.rejectPaymentButtonLabel()],
        [`admin_approve_payment_${orderNumber}`, `admin_reject_payment_${orderNumber}`],
        { type: mediaType, id: mediaId }
      );
    } catch (error: any) {
      logger.error(`Error forwarding payment proof for order ${orderNumber} to admin ${admin.phone}: ${error.message}`);
    }
  }
}

/**
 * Handles an admin's tap on the Approve/Reject payment buttons sent over
 * WhatsApp, approving or rejecting the matching order and confirming back to
 * the admin, or telling them if the order was already handled.
 */
export async function processAdminPaymentReply(adminPhone: string, buttonReplyId: string | null): Promise<void> {
  const match = buttonReplyId?.match(/^admin_(approve|reject)_payment_(.+)$/);
  if (!match) {
    await sendWhatsAppMessage(adminPhone, t.admin.useButtonsPrompt());
    return;
  }

  const [, action, orderNumber] = match;
  logger.info(`[ADMIN PAYMENT] Admin ${adminPhone} tapped "${action}" for order ${orderNumber}`);

  const order = await getOrderByNumber(orderNumber);
  if (!order || order.status !== 'payment_proof_received') {
    logger.debug(`[ADMIN PAYMENT] Order ${orderNumber} already handled (status=${order?.status ?? 'not found'}) — telling ${adminPhone}`);
    await sendWhatsAppMessage(adminPhone, t.admin.alreadyHandled(orderNumber));
    return;
  }

  if (action === 'approve') {
    const admin = await getAdminByPhone(adminPhone);
    await approveOrder(orderNumber, admin?.id ?? 0);
    await sendWhatsAppMessage(adminPhone, t.admin.paymentApprovedAck(orderNumber));
    logger.info(`[ADMIN PAYMENT] Order ${orderNumber} approved by ${adminPhone} — invoice sent to customer`);
  } else {
    await updateOrderStatus(orderNumber, 'rejected');
    const customerMessages = await resolveMessages(order.customer_phone);
    await sendReply(order.customer_phone, customerMessages.order.rejected(orderNumber));
    await sendWhatsAppMessage(adminPhone, t.admin.paymentRejectedAck(orderNumber));
    logger.info(`[ADMIN PAYMENT] Order ${orderNumber} rejected by ${adminPhone} — customer notified`);
  }
}

/**
 * Marks an order approved, generates and sends the final invoice PDF to
 * the customer in their locale, and notifies the supplier to deliver.
 */
export async function approveOrder(orderNumber: string, employeeId: number): Promise<any> {
  const { rows } = await db.query(
    `UPDATE orders
     SET status = 'approved', approved_by = $2, approved_at = NOW()
     WHERE number = $1
     RETURNING *`,
    [orderNumber, employeeId]
  );

  if (!rows.length) throw new Error(`Order ${orderNumber} not found`);
  const order = rows[0];

  const details = await getOrderByNumber(orderNumber);
  const fullOrder = details ? { ...order, ...details } : order;

  const customer = await getCustomerByPhone(order.customer_phone);
  const firstName = customer?.name?.split(' ')[0] || 'Cliente';
  const locale = await resolveLocale(order.customer_phone);
  const mc = getMessages(locale).pdf.invoice;

  const invoiceLineItems = fullOrder.items
    ? fullOrder.items
        .filter((i: any) => i.availabilityStatus === 'available')
        .flatMap((i: any) => [
          { description: i.productName, reference: i.reference, price: Number(i.unitPrice) },
          ...(i.serviceName ? [{ description: i.serviceName, reference: '—', price: Number(i.servicePrice || 0), isService: true }] : []),
        ])
    : [
        { description: fullOrder.product_name || mc.defaultProductName, reference: fullOrder.reference || 'PEC-GEN', price: Number(fullOrder.unit_price) },
        ...(fullOrder.service_price ? [{ description: fullOrder.service_name || 'Serviço', reference: '—', price: Number(fullOrder.service_price), isService: true }] : []),
      ];

  const invoicePDF = await generateInvoicePDF(fullOrder, invoiceLineItems, locale);

  await sendFinalInvoiceWhatsApp(order.customer_phone, invoicePDF, orderNumber, firstName, locale);

  await notifySupplierDelivery(fullOrder);

  return { success: true, orderNumber };
}

/**
 * Records an in-person payment method on an order and immediately runs it
 * through the same approval flow as a verified proof.
 */
export async function confirmInPersonPayment(orderNumber: string, employeeId: number, method: string): Promise<void> {
  await db.query(
    `UPDATE orders
     SET status = 'payment_proof_received',
         payment_method = $2
     WHERE number = $1`,
    [orderNumber, method]
  );

  await approveOrder(orderNumber, employeeId);
}

/**
 * Creates an in-panel alert and pushes a plain WhatsApp message to every
 * admin when a customer chooses an in-person payment method requiring staff confirmation.
 */
async function notifyAgentInPersonPayment(
  orderNumber: string,
  customerPhone: string,
  amount: number,
  method: any
): Promise<void> {
  await createAlert(
    'in_person_payment',
    orderNumber,
    `Pagamento presencial solicitado para o pedido ${orderNumber} (${method.name}, ${formatPrice(amount)}) — cliente ${customerPhone}.`
  );

  const customer = await getCustomerByPhone(customerPhone);
  const customerName = customer?.name?.split(' ')[0] || 'Cliente';
  const address = customer?.address || 'N/D';

  const body = t.admin.inPersonPaymentRequested(
    orderNumber,
    method.name,
    formatPrice(amount),
    customerName,
    customerPhone,
    address
  );

  const admins = await getAllAdmins();
  for (const admin of admins) {
    try {
      await sendWhatsAppMessage(admin.phone, body);
    } catch (error: any) {
      logger.error(`Error notifying admin ${admin.phone} about in-person payment for order ${orderNumber}: ${error.message}`);
    }
  }
}

/**
 * Sends the assigned supplier a WhatsApp delivery notice for an approved
 * order, silently skipping if the order has no supplier phone on file.
 */
async function notifySupplierDelivery(order: any): Promise<void> {
  const supplierPhone = await getSupplierPhoneById(order.supplier_id);
  if (!supplierPhone) return;

  try {
    await sendWhatsAppMessage(
      supplierPhone,
      t.payment.supplierDeliveryNotice(order.product_name, order.reference, order.quantity, order.number)
    );
  } catch (error: any) {
    logger.error(`Error notifying supplier for delivery: ${error.message}`);
  }
}
