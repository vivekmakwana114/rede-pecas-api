import { logger } from '../config/logger.js';
import { getOrderByNumber, getLatestOrderByStatus, getOrderAmount } from '../models/order.model.js';
import { getCustomerByPhone, Customer } from '../models/customer.model.js';
import { getAllAdmins } from '../models/adminUser.model.js';
import { createAlert } from '../models/alert.model.js';
import { sendWhatsAppMessage } from './whatsapp.service.js';
import { sendReply } from './reply.service.js';
import { resolveMessages } from './customer.service.js';
import { formatPrice } from '../utils/helpers.js';
import { t } from '../i18n/messages.js';

/**
 * Formats a Date as DD/MM/YYYY HH:MM for the admin-facing order-status push.
 */
function formatOrderDate(date: Date): string {
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Builds a numbered parts list for the admin push — one line per item for a
 * multi-item "basket" order, or the single product for a legacy order.
 */
function buildPartsSummary(order: any): string {
  if (order.items) {
    return order.items
      .map((i: any, idx: number) => `${idx + 1}. ${i.productName}${i.serviceName ? ` (+ ${i.serviceName})` : ''}`)
      .join('\n');
  }
  return `1. ${order.product_name || 'N/A'}${order.service_name ? ` (+ ${order.service_name})` : ''}`;
}

/**
 * Notifies every admin with the order's full detail (never sent to the
 * customer) and sends the customer a generic acknowledgment — the customer
 * is never told the real status, only that staff will follow up.
 */
async function notifyAdminsAndAckCustomer(order: any, customer: Customer | null): Promise<void> {
  const amount = await getOrderAmount(order.number);
  const customerName = customer?.name || 'Cliente';
  const message = t.admin.orderStatusRequested(
    order.number,
    formatOrderDate(order.created_at),
    order.status,
    buildPartsSummary(order),
    formatPrice(amount),
    customerName,
    order.customer_phone,
    customer?.address || 'N/A'
  );

  await createAlert('order_status_request', order.number, message);

  const admins = await getAllAdmins();
  for (const admin of admins) {
    try {
      await sendWhatsAppMessage(admin.phone, message);
    } catch (error: any) {
      logger.error(`[ORDER STATUS] Error notifying admin ${admin.phone} for order ${order.number}`, error);
    }
  }

  const messages = await resolveMessages(order.customer_phone);
  await sendReply(order.customer_phone, messages.order.statusRequestAck());
}

/**
 * Handles a tap on the "Order status" button attached to the final invoice
 * message (id `order_status_<orderNumber>`).
 */
export async function processOrderStatusButton(phone: string, buttonReplyId: string): Promise<void> {
  const match = buttonReplyId.match(/^order_status_(.+)$/);
  const orderNumber = match ? match[1] : null;
  if (!orderNumber) return;

  const order = await getOrderByNumber(orderNumber);
  if (!order) {
    logger.error(`[ORDER STATUS] Button tap for unknown order ${orderNumber}`);
    return;
  }

  const customer = await getCustomerByPhone(phone);
  await notifyAdminsAndAckCustomer(order, customer);
}

/**
 * Handles the "order status"/"where is my order" keyword — always resolves
 * to the customer's most recent approved order, never asking for an order
 * number.
 */
export async function handleOrderStatusRequest(phone: string, customer: Customer): Promise<void> {
  const latest = await getLatestOrderByStatus(phone, ['approved']);
  if (!latest) {
    const messages = await resolveMessages(phone);
    await sendReply(phone, messages.order.statusNotFound());
    return;
  }

  const order = await getOrderByNumber(latest.number);
  if (!order) return;

  await notifyAdminsAndAckCustomer(order, customer);
}
