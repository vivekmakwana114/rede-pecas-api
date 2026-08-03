import * as XLSX from 'xlsx';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';
import {
  searchProductsInInventory,
  addToProductWaitlist,
  findZeroQuantityProductMatch,
  getProductById,
  getProductByIdAnyStatus,
  getMatchingServicesForProduct,
  decrementOfferStock,
  Product
} from '../models/product.model.js';
import { Service } from '../models/service.model.js';
import {
  importProductsBatch,
  ImportItem,
  RestockNotification
} from '../models/supplier.model.js';
import {
  createOrder,
  createMultiItemOrder,
  addServiceToOrder,
  generateOrderNumber,
  updateOrderStatus,
  getOrderByNumber,
  getOrderRaw,
  getOrderAmount,
  setOrderItemAvailability,
  replaceOrderItemWithAlternative,
  declineOrderItem,
  OrderItemEntry,
  getOrdersAwaitingCourtesyMessage,
  markCourtesyMessageSent,
  getOrdersAwaitingAdminReminder,
  markAdminReminderSent
} from '../models/order.model.js';
import { getCustomerVehicles } from '../models/vehicle.model.js';
import { getCustomerByPhone } from '../models/customer.model.js';
import { getAllAdmins } from '../models/adminUser.model.js';
import { resolveMessages, resolveLocale } from './customer.service.js';
import { sendWhatsAppMessage, sendWhatsAppButtons } from './whatsapp.service.js';
import { sendReply, sendReplyButtons, sendReplyList } from './reply.service.js';
import { generateProformaPDF, sendProformaWhatsApp } from './pdf.service.js';
import { askPaymentMethod } from './payment.service.js';
import { startOrderProfileCapture } from './orderProfile.service.js';
import {
  savePendingOptions,
  clearPendingOptions,
  savePendingWaitlistOffer,
  clearPendingWaitlistOffer,
  savePendingServiceOffer,
  clearPendingServiceOffer,
  savePendingStockUnavailableOffer,
  clearPendingStockUnavailableOffer,
  savePendingRestockOrderOffer,
  clearPendingRestockOrderOffer,
  getChosenVehicle,
  savePendingBasket,
  getPendingBasket,
  clearPendingBasket,
  savePendingAlternativeOffer,
  getPendingAlternativeOffer,
  clearPendingAlternativeOffer,
  savePendingAlternativeResolution,
  getPendingAlternativeResolution,
  clearPendingAlternativeResolution,
  clearPendingPartTypeChoice,
  savePendingBasketWaitlistOffer,
  clearPendingBasketWaitlistOffer,
  PendingServiceOffer,
  PendingStockUnavailableOffer,
  PendingBasket,
  PendingBasketWaitlistOffer,
  PendingAlternativeOffer,
  PendingPartTypeChoice
} from './session.service.js';
import { formatPrice } from '../utils/helpers.js';
import { t, getMessages } from '../i18n/messages.js';

/**
 * Determines which of a customer's vehicles a product search should be
 * scoped to — the customer's only vehicle, or their previously chosen one
 * when they have several, falling back to the first if none was chosen.
 */
async function resolveSearchVehicle(phone: string) {
  const vehicles = await getCustomerVehicles(phone);
  if (vehicles.length === 0) return null;
  if (vehicles.length === 1) return vehicles[0];

  const chosenId = await getChosenVehicle(phone);
  return vehicles.find((v) => v.id === chosenId) || vehicles[0];
}

/**
 * Runs the deterministic full-text inventory search for a part query,
 * scoped to the customer's resolved vehicle — the shared DB-search step
 * behind both a plain single-product search and each item of a multi-product basket search.
 */
async function runProductSearch(phone: string, part: string, productType?: string | null) {
  const vehicle = await resolveSearchVehicle(phone);
  const options = await searchProductsInInventory({ part, vehicle, productType });
  return { vehicle, options };
}

/**
 * Runs the deterministic full-text inventory search for the customer's
 * message, then either sends a WhatsApp list of matches, offers a waitlist
 * for an out-of-stock match, or reports no results found.
 */
export async function searchAndRespond(phone: string, customerText: string, customerName: string, partType: string = ''): Promise<void> {
  const messages = await resolveMessages(phone);
  logger.info(`[PRODUCT SEARCH] ${phone} searching for: "${customerText}"`);
  await sendReply(phone, messages.agent.checkingStock());

  const { vehicle, options } = await runProductSearch(phone, customerText, partType || null);

  if (!options || options.length === 0) {
    logger.info(`[PRODUCT SEARCH] ${phone} no matches for "${customerText}"`);

    const candidate = await findZeroQuantityProductMatch({ part: customerText, productType: partType || null });
    if (candidate) {
      logger.info(`[PRODUCT SEARCH] ${phone} offering waitlist for out-of-stock match: ${candidate.name}`);
      await sendReplyButtons(phone, messages.agent.noStockFound(), messages.agent.noStockFoundButtons);
      await savePendingWaitlistOffer(phone, { productId: candidate.id, productName: candidate.name, query: customerText });
    } else {
      // Nothing at all matched — not even an out-of-stock listing — so
      // there's no real product to waitlist against. Distinct wording from
      // noStockFound() above: no question, no promise we can't keep.
      await sendReply(phone, messages.agent.noStockFoundNoWaitlist());
    }
    return;
  }

  logger.info(`[PRODUCT SEARCH] ${phone} found ${options.length} match(es) for "${customerText}": ${options.map(o => o.name).join(', ')}`);

  await savePendingOptions(phone, options);
  // A single-product search still goes through the basket mechanism (with an
  // already-empty queue) so its selection is summarized and turned into an
  // order through the exact same path as a multi-item basket — see
  // processBasketProductSelection/advanceBasket below.
  await savePendingBasket(phone, { queue: [], items: [], partType, unmatched: [] });

  const body = vehicle
    ? messages.agent.searchListBodyForVehicle(options.length, customerText, vehicle.make, vehicle.model, vehicle.year, customerName)
    : messages.agent.searchListBody(options.length, customerText, customerName);
  await sendReplyList(phone, body, messages.agent.searchListButton(), buildProductListRows(options));
}

/**
 * Starts a multi-product "basket" — one order that will end up holding every
 * product the customer named in a single message. Saves the queue of
 * still-to-resolve product-name phrases and searches the first one.
 */
export async function startBasketSearch(phone: string, productNames: string[], customerName: string, partType: string = ''): Promise<void> {
  const messages = await resolveMessages(phone);
  await sendReply(phone, messages.agent.basketRequestSummary(productNames, customerName));

  await savePendingBasket(phone, { queue: productNames, items: [], partType, unmatched: [] });
  await searchNextBasketItem(phone, customerName);
}

// List-row id -> canonical products.product_type vocabulary. Fixed set —
// WhatsApp List Messages need concrete rows, and there's no backing table
// for this (a deliberate choice: kept simple since a 5th part type isn't
// expected). Row ids stay fixed across locales; only the row title/
// description text (messages.agent.partTypeRows) is translated.
const PART_TYPE_ROW_TO_VALUE: Record<string, string> = {
  oem: 'OEM',
  aftermarket: 'Aftermarket',
  new: 'New',
  second_hand: 'Second Hand',
};

/**
 * Converts the fixed part-type catalog (messages.agent.partTypeRows) into
 * WhatsApp List Message rows, prefixing each row's id for reply routing.
 */
function buildPartTypeListRows(rows: { id: string; title: string; description: string }[]): { id: string; title: string; description: string }[] {
  return rows.map((row) => ({ id: `part_type_${row.id}`, title: row.title, description: row.description }));
}

/**
 * Sends the one-time-per-order "what type of parts?" list, asked once
 * Claude has identified the part(s) from the customer's message and before
 * any search runs.
 */
export async function sendPartTypePrompt(phone: string, productNames: string[] | null): Promise<void> {
  const messages = await resolveMessages(phone);
  const count = productNames?.length || 1;
  await sendReplyList(
    phone,
    messages.agent.askPartTypeBody(count),
    messages.agent.askPartTypeButton(),
    buildPartTypeListRows(messages.agent.partTypeRows)
  );
}

/**
 * Handles the customer's reply to the part-type list: on a match, clears the
 * pending choice and runs the search (single- or multi-item) with the chosen
 * type; on anything else (a stray typed reply instead of a tap), re-sends
 * the same list rather than guessing or falling through to a fresh search.
 */
export async function processPartTypeChoice(
  phone: string,
  listReplyId: string | null,
  pending: PendingPartTypeChoice
): Promise<boolean> {
  const match = listReplyId?.match(/^part_type_(.+)$/);
  const rowId = match ? match[1] : null;
  const partType = rowId ? PART_TYPE_ROW_TO_VALUE[rowId] : undefined;

  if (!partType) {
    const messages = await resolveMessages(phone);
    await sendReplyList(
      phone,
      messages.agent.partTypeNotUnderstood(),
      messages.agent.askPartTypeButton(),
      buildPartTypeListRows(messages.agent.partTypeRows)
    );
    return true;
  }

  await clearPendingPartTypeChoice(phone);

  if (pending.productNames && pending.productNames.length > 1) {
    await startBasketSearch(phone, pending.productNames, pending.customerName, partType);
  } else {
    await searchAndRespond(phone, pending.customerText, pending.customerName, partType);
  }
  return true;
}

/**
 * Pops the next queued product-name phrase off the basket, runs the shared
 * search, and either sends its results list (same UX as a plain single-
 * product search), or — if nothing matches at all — records it as unmatched
 * (with a waitlist-eligible candidate if one exists) and silently moves on
 * to the next queued item, without a per-item message. Once the whole
 * queue has been worked through, advanceBasket sends one consolidated
 * notice/waitlist-offer for everything that came back unmatched, instead of
 * repeating the same question once per failed item.
 */
async function searchNextBasketItem(phone: string, customerName: string): Promise<void> {
  const basket = await getPendingBasket(phone);
  if (!basket || basket.queue.length === 0) return;

  const [part, ...rest] = basket.queue;

  const messages = await resolveMessages(phone);
  logger.info(`[PRODUCT SEARCH][BASKET] ${phone} searching basket item: "${part}"`);
  await sendReply(phone, messages.agent.checkingStock());

  const { vehicle, options } = await runProductSearch(phone, part, basket.partType || null);

  if (!options || options.length === 0) {
    logger.info(`[PRODUCT SEARCH][BASKET] ${phone} no matches for "${part}"`);

    const candidate = await findZeroQuantityProductMatch({ part, productType: basket.partType || null });
    await savePendingBasket(phone, {
      ...basket,
      queue: rest,
      unmatched: [...basket.unmatched, { query: part, candidateId: candidate?.id ?? null, candidateName: candidate?.name ?? null }],
    });
    await advanceBasket(phone);
    return;
  }

  await savePendingBasket(phone, { ...basket, queue: rest });

  logger.info(`[PRODUCT SEARCH][BASKET] ${phone} found ${options.length} match(es) for "${part}": ${options.map(o => o.name).join(', ')}`);
  await savePendingOptions(phone, options);

  const body = vehicle
    ? messages.agent.searchListBodyForVehicle(options.length, part, vehicle.make, vehicle.model, vehicle.year, customerName)
    : messages.agent.searchListBody(options.length, part, customerName);
  await sendReplyList(phone, body, messages.agent.searchListButton(), buildProductListRows(options));
}

/**
 * Handles the customer's reply to a basket item's search-results list —
 * resolves the picked product exactly like a plain single-product search,
 * but instead of creating an order immediately, offers matching services (if
 * any) or appends the product straight to the basket and moves on to the
 * next queued item.
 */
export async function processBasketProductSelection(
  phone: string,
  customerText: string | null,
  listReplyId: string | null,
  pendingOptions: Product[],
  basket: PendingBasket
): Promise<boolean> {
  const idx = resolveOptionIndex(customerText, listReplyId);
  if (idx === null) return false;

  const choice = pendingOptions[idx];
  const messages = await resolveMessages(phone);
  if (!choice) {
    await sendReply(phone, messages.agent.optionNotFound());
    return true;
  }

  await clearPendingOptions(phone);

  const matchingServices = choice.id ? await getMatchingServicesForProduct(choice.id) : [];
  const offeredServices = matchingServices.slice(0, 3);

  if (offeredServices.length > 0) {
    await sendReply(phone, messages.agent.productSelected(choice.name, formatPrice(choice.price)));
    await savePendingServiceOffer(phone, { product: choice, services: offeredServices });
    await sendReplyList(
      phone,
      messages.agent.serviceListBody(offeredServices.length),
      messages.agent.serviceListButton(),
      buildServiceListRows(offeredServices, messages.agent.serviceSkipOption())
    );
    return true;
  }

  await savePendingBasket(phone, { ...basket, items: [...basket.items, { product: choice, service: null }] });
  await advanceBasket(phone);
  return true;
}

/**
 * Formats a basket's resolved items into the {description, price} lines and
 * running total `basketSummaryBody` expects — one line per product,
 * appending its attached service (if any) to the same line.
 */
function summarizeBasket(basket: PendingBasket): { lines: { description: string; price: string }[]; total: number } {
  const lines = basket.items.map((i) => ({
    description: i.service ? `${i.product.name} + ${i.service.name}` : i.product.name,
    price: formatPrice(Number(i.product.price) + Number(i.service?.price || 0)),
  }));
  const total = basket.items.reduce((sum, i) => sum + Number(i.product.price) + Number(i.service?.price || 0), 0);
  return { lines, total };
}

/**
 * Sends the basket summary (products + total) as a plain informational
 * message — no confirm/cancel step; the order is created and NIF/address
 * capture starts right after this, in the same turn.
 */
async function sendBasketSummary(phone: string, basket: PendingBasket, customerName: string): Promise<void> {
  const messages = await resolveMessages(phone);
  const { lines, total } = summarizeBasket(basket);
  await sendReply(phone, messages.agent.basketSummaryBody(lines, customerName, formatPrice(total)));
}

/**
 * Moves the basket forward once a product (and its service decision) has
 * just been resolved: searches the next queued product name, or — once the
 * queue is empty — either creates the order and moves straight into
 * NIF/address capture (if at least one item matched — no confirm/cancel
 * step, per 2026-07-31 product decision), or, when every single item came
 * back unmatched, skips the (nonsensical, empty) cart summary entirely and
 * instead sends one consolidated notice — a waitlist offer covering every
 * unmatched item that has a real out-of-stock product behind it, or a plain
 * "couldn't find any of these" otherwise.
 */
async function advanceBasket(phone: string): Promise<void> {
  const basket = await getPendingBasket(phone);
  if (!basket) return;

  const customer = await getCustomerByPhone(phone);
  const customerName = customer?.name?.split(' ')[0] || 'Cliente';

  if (basket.queue.length > 0) {
    await searchNextBasketItem(phone, customerName);
    return;
  }

  const messages = await resolveMessages(phone);

  if (basket.items.length === 0) {
    await clearPendingBasket(phone);

    const candidates = new Map<number, string>();
    for (const u of basket.unmatched) {
      if (u.candidateId !== null) candidates.set(u.candidateId, u.candidateName ?? u.query);
    }

    if (candidates.size > 0) {
      await sendReplyButtons(phone, messages.agent.basketSearchAllUnavailableWaitlistOffer(), messages.agent.noStockFoundButtons);
      await savePendingBasketWaitlistOffer(phone, {
        candidates: Array.from(candidates, ([productId, productName]) => ({ productId, productName })),
      });
    } else {
      await sendReply(phone, messages.agent.basketSearchAllUnavailableNoWaitlist());
    }
    return;
  }

  if (basket.unmatched.length > 0) {
    await sendReply(phone, messages.agent.basketSearchPartialNotice(basket.unmatched.map((u) => u.query)));
  }

  await sendBasketSummary(phone, basket, customerName);

  await clearPendingBasket(phone);
  const orderNumber = await generateOrderNumber();
  const partType = basket.partType || null;
  if (basket.items.length === 1) {
    const only = basket.items[0];
    await createOrder(orderNumber, phone, only.product, partType);
    if (only.service) {
      await addServiceToOrder(orderNumber, only.service.name, only.service.price);
    }
  } else {
    await createMultiItemOrder(orderNumber, phone, basket.items, partType);
  }
  await startOrderProfileCapture(phone, orderNumber);
}

/**
 * Truncates a string to a maximum length, appending an ellipsis when it
 * had to cut text off.
 */
function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/**
 * Converts a list of matched products into WhatsApp List Message rows,
 * each carrying a selectable option id, truncated title, and reference/price/supplier description.
 */
function buildProductListRows(options: Product[]): { id: string; title: string; description: string }[] {
  return options.map((item, i) => {
    const parts = [
      item.reference ? `Ref: ${item.reference}` : null,
      item.brand ? `Brand: ${item.brand}` : null,
      formatPrice(item.price),
      item.delivery_time ? `Delivery: ${item.delivery_time}` : null,
      item.supplier || null,
    ].filter(Boolean);

    return {
      id: `option_${i + 1}`,
      title: truncate(item.name, 24),
      description: truncate(parts.join(' • '), 72),
    };
  });
}

/**
 * Resolves which product-search result the customer picked, from either a
 * tapped list row's option id or a typed digit, returning null if neither matches.
 */
function resolveOptionIndex(customerText: string | null, listReplyId: string | null): number | null {
  const idMatch = listReplyId?.match(/^option_(\d+)$/);
  if (idMatch) return parseInt(idMatch[1], 10) - 1;

  const digitMatch = customerText?.trim().match(/^(\d+)$/);
  if (digitMatch) return parseInt(digitMatch[1], 10) - 1;

  return null;
}

/**
 * Converts a list of matching services into WhatsApp List Message rows,
 * appending a final "skip" row so the customer can decline all of them.
 */
function buildServiceListRows(
  services: Service[],
  skipLabel: string
): { id: string; title: string; description: string }[] {
  const rows = services.map((s, i) => ({
    id: `service_option_${i + 1}`,
    title: truncate(s.service_name, 24),
    description: truncate(
      `${formatPrice(s.service_base_price)}${s.provider_name ? ` • ${s.provider_name}` : ''}`,
      72
    ),
  }));
  rows.push({ id: `service_option_${services.length + 1}`, title: truncate(skipLabel, 24), description: '' });
  return rows;
}

/**
 * Resolves the customer's reply to a service-offer list into a chosen
 * service index, an explicit 'skip', or null if the reply doesn't match anything offered.
 */
function resolveServiceSelection(
  customerText: string | null,
  listReplyId: string | null,
  serviceCount: number
): number | 'skip' | null {
  const r = customerText?.trim().toLowerCase() ?? '';
  if (r.includes('não') || r.includes('nao') || r.includes('no thanks') || r === 'no' || r.includes('❌')) return 'skip';

  const idMatch = listReplyId?.match(/^service_option_(\d+)$/);
  if (idMatch) {
    const idx = parseInt(idMatch[1], 10) - 1;
    return idx === serviceCount ? 'skip' : idx;
  }

  const digitMatch = r.match(/^(\d+)$/);
  if (digitMatch) {
    const idx = parseInt(digitMatch[1], 10) - 1;
    if (idx === serviceCount) return 'skip';
    if (idx >= 0 && idx < serviceCount) return idx;
  }

  return null;
}

/**
 * Moves an order into awaiting_stock_confirmation, tells the customer
 * stock is being checked, and notifies admins to confirm or reject availability.
 */
export async function requestStockConfirmation(
  phone: string,
  orderNumber: string
): Promise<void> {
  const messages = await resolveMessages(phone);
  await updateOrderStatus(orderNumber, 'awaiting_stock_confirmation');
  await sendReply(phone, messages.agent.confirmingAvailability());

  const order = await getOrderRaw(orderNumber);
  if (order?.items) {
    await notifyAdminsItemStockConfirmationNeeded(orderNumber, order.items);
  } else {
    await notifyAdminsStockConfirmationNeeded(orderNumber);
  }
}

/**
 * Pushes a stock-confirmation request with Confirm/Unavailable buttons to
 * every admin for an order that needs its stock verified.
 */
async function notifyAdminsStockConfirmationNeeded(orderNumber: string): Promise<void> {
  const order = await getOrderByNumber(orderNumber);
  if (!order) {
    logger.error(`[ADMIN STOCK] notifyAdminsStockConfirmationNeeded: order ${orderNumber} not found`);
    return;
  }

  const customer = await getCustomerByPhone(order.customer_phone);
  const customerName = customer?.name?.split(' ')[0] || 'Cliente';
  const total = Number(order.unit_price) + Number(order.service_price || 0);

  const admins = await getAllAdmins();
  logger.debug(`[ADMIN STOCK] Notifying ${admins.length} admin(s) about order ${orderNumber} (${order.product_name})`);

  for (const admin of admins) {
    try {
      await sendWhatsAppButtons(
        admin.phone,
        t.admin.stockConfirmationNeeded(
          orderNumber,
          order.product_name,
          order.reference,
          order.supplier_name,
          formatPrice(total),
          customerName,
          order.customer_phone
        ),
        [t.admin.confirmButtonLabel(), t.admin.unavailableButtonLabel()],
        [`admin_confirm_${orderNumber}`, `admin_unavailable_${orderNumber}`]
      );
      logger.info(`[ADMIN STOCK] Sent stock-confirmation request for order ${orderNumber} to admin ${admin.phone}`);
    } catch (error: any) {
      logger.error(`[ADMIN STOCK] Error notifying admin ${admin.phone} about stock confirmation for order ${orderNumber}`, error);
    }
  }
}

/**
 * Pushes one item's Confirm/Unavailable buttons to every admin — the shared
 * per-item sender behind both the initial bulk notification
 * (`notifyAdminsItemStockConfirmationNeeded`, one call per item) and the
 * single re-notification after a customer swaps a rejected item for an
 * alternative (`startAlternativeResolution`'s pick branch), since both need
 * the exact same button/message shape for one item at a time.
 */
async function notifyAdminsForItem(orderNumber: string, customerPhone: string, customerName: string, item: OrderItemEntry): Promise<void> {
  const admins = await getAllAdmins();
  for (const admin of admins) {
    try {
      await sendWhatsAppButtons(
        admin.phone,
        t.admin.stockConfirmationNeeded(
          orderNumber,
          item.productName,
          item.reference,
          item.supplierName,
          formatPrice(item.unitPrice + (item.servicePrice || 0)),
          customerName,
          customerPhone
        ),
        [t.admin.confirmButtonLabel(), t.admin.unavailableButtonLabel()],
        [`admin_item_confirm_${orderNumber}_${item.itemId}`, `admin_item_unavailable_${orderNumber}_${item.itemId}`]
      );
    } catch (error: any) {
      logger.error(`[ADMIN STOCK][BASKET] Error notifying admin ${admin.phone} about item ${item.itemId} on order ${orderNumber}`, error);
    }
  }
}

/**
 * Pushes a stock-confirmation request with Confirm/Unavailable buttons to
 * every admin, one WhatsApp message per line item, for a multi-item
 * "basket" order — the WhatsApp-native equivalent of
 * `notifyAdminsStockConfirmationNeeded` for the multi-product case. Button
 * ids carry both the order number and the item id
 * (`admin_item_confirm_<orderNumber>_<itemId>`), since items aren't rows in
 * their own table — see `processAdminItemStockReply`.
 */
async function notifyAdminsItemStockConfirmationNeeded(orderNumber: string, items: OrderItemEntry[]): Promise<void> {
  const order = await getOrderByNumber(orderNumber);
  if (!order) {
    logger.error(`[ADMIN STOCK][BASKET] notifyAdminsItemStockConfirmationNeeded: order ${orderNumber} not found`);
    return;
  }

  const customer = await getCustomerByPhone(order.customer_phone);
  const customerName = customer?.name?.split(' ')[0] || 'Cliente';

  logger.debug(`[ADMIN STOCK][BASKET] Notifying admins about ${items.length} item(s) on order ${orderNumber}`);
  for (const item of items) {
    await notifyAdminsForItem(orderNumber, order.customer_phone, customerName, item);
  }
}

/**
 * Handles an admin's tap on a per-item Confirm/Unavailable button for a
 * multi-item "basket" order: records that one item's availability, and —
 * once every item on the order has moved past 'pending' — finalizes the
 * whole order (proforma for the available items + payment flow, or a plain
 * "not available" notice if every item turned out unavailable).
 */
export async function processAdminItemStockReply(adminPhone: string, buttonReplyId: string | null): Promise<boolean> {
  const match = buttonReplyId?.match(/^admin_item_(confirm|unavailable)_(.+)_(\d+)$/);
  if (!match) return false;

  const [, action, orderNumber, itemIdStr] = match;
  const itemId = parseInt(itemIdStr, 10);
  logger.info(`[ADMIN STOCK][BASKET] Admin ${adminPhone} tapped "${action}" for item ${itemId} on order ${orderNumber}`);

  const order = await getOrderRaw(orderNumber);
  if (!order?.items || order.status !== 'awaiting_stock_confirmation') {
    logger.debug(`[ADMIN STOCK][BASKET] Order ${orderNumber} already handled or not found (status=${order?.status ?? 'not found'}) — telling ${adminPhone}`);
    await sendWhatsAppMessage(adminPhone, t.admin.alreadyHandled(orderNumber));
    return true;
  }

  await setOrderItemAvailability(orderNumber, itemId, action === 'confirm');
  // Finalize before acking the admin — sendWhatsAppMessage rethrows on
  // failure (e.g. sandbox/rate-limit error), and if that happened first, the
  // item would already be past 'pending' with no retry path left to ever
  // trigger finalization. Same ordering as processAdminStockReply below.
  await finalizeMultiItemOrderIfComplete(orderNumber);

  // confirmedAck/unavailableAck ("proforma sent" / "customer notified") were
  // written for the single-item flow, where a stock decision is always the
  // whole order's decision. Reusing them here unconditionally was wrong: on
  // a multi-item basket, this tap might be only one of several items still
  // needed before finalizeMultiItemOrderIfComplete does anything at all, or
  // finalization might have gone down the alternate-search branch instead of
  // sending a proforma. Re-check the order's actual resulting state so the
  // admin is told what really happened, not what's true for a single item.
  const updated = await getOrderRaw(orderNumber);
  const items: OrderItemEntry[] | undefined = updated?.items;
  const stillPending = items?.some((i) => i.availabilityStatus === 'pending');

  let ack: string;
  if (stillPending) {
    ack = t.admin.itemRecordedWaitingOnOthers(orderNumber);
  } else if (updated?.status === 'stock_unavailable') {
    ack = t.admin.itemRecordedAllUnavailable(orderNumber);
  } else if (updated?.status === 'awaiting_payment_method') {
    ack = action === 'confirm' ? t.admin.confirmedAck(orderNumber) : t.admin.unavailableAck(orderNumber);
  } else {
    // Not pending, not stock_unavailable, not sent to payment — every item
    // has a decision but at least one was unavailable, so finalization
    // started the alternative-resolution sub-flow instead of a proforma.
    ack = t.admin.itemRecordedAlternativeSearch(orderNumber);
  }
  await sendWhatsAppMessage(adminPhone, ack);
  return true;
}

/**
 * Checks whether every item on a multi-item order now has an admin
 * decision (none left `pending`) and, if so, finalizes it — shared by both
 * the WhatsApp per-item button flow above and the admin-panel REST
 * endpoint (`POST /orders/:number/confirm/stock` with an `items` body),
 * which can apply several items' availability in one request.
 */
export async function finalizeMultiItemOrderIfComplete(orderNumber: string): Promise<void> {
  const order = await getOrderRaw(orderNumber);
  if (!order?.items) return;

  const items: OrderItemEntry[] = order.items;
  if (items.some((i) => i.availabilityStatus === 'pending')) return;

  // No item is 'pending', but one can still be 'unavailable' while genuinely
  // awaiting the CUSTOMER's own alternative pick, not the admin — e.g. two
  // items were rejected in the same round; the admin has just confirmed the
  // first swapped-in alternative while the second item's alternatives list
  // is still sitting unanswered in the customer's WhatsApp. Re-running
  // finalizeMultiItemOrder here would treat that leftover 'unavailable' item
  // as a brand-new rejection and kick off a second, duplicate alternative
  // search for it, silently overwriting the list the customer already has in
  // front of them. Bail out and let the in-flight resolution finish on its
  // own — advanceAlternativeResolution calls back into this function once
  // every item is truly settled (see below).
  const [resolution, offer] = await Promise.all([
    getPendingAlternativeResolution(order.customer_phone),
    getPendingAlternativeOffer(order.customer_phone),
  ]);
  const resolutionInProgress =
    (resolution?.orderNumber === orderNumber && resolution.queue.length > 0) ||
    offer?.orderNumber === orderNumber;
  if (resolutionInProgress) return;

  await finalizeMultiItemOrder(orderNumber, items);
}

/**
 * Once every item on a multi-item order has an admin decision: if any item
 * came back 'unavailable' (rejected, not yet resolved by the customer),
 * pauses here and starts the alternative-resolution sub-flow instead of
 * finalizing — the order only proceeds to a proforma once every rejected
 * item has either been swapped for an alternative (and re-confirmed by
 * admin) or explicitly declined by the customer.
 */
async function finalizeMultiItemOrder(orderNumber: string, items: OrderItemEntry[]): Promise<void> {
  const order = await getOrderByNumber(orderNumber);
  if (!order) throw new ApiError(404, `Order ${orderNumber} not found`);

  const phone = order.customer_phone;
  const locale = await resolveLocale(phone);
  const messages = getMessages(locale);
  const customer = await getCustomerByPhone(phone);
  const firstName = customer?.name?.split(' ')[0] || 'Cliente';

  const available = items.filter((i) => i.availabilityStatus === 'available');
  const unavailable = items.filter((i) => i.availabilityStatus === 'unavailable');
  const declined = items.filter((i) => i.availabilityStatus === 'declined');

  if (unavailable.length > 0) {
    await sendReply(
      phone,
      available.length > 0
        ? messages.agent.basketPartialAvailability(available.map((i) => i.productName), unavailable.map((i) => i.productName))
        : messages.agent.basketNoneAvailableYet(unavailable.map((i) => i.productName))
    );
    // Every currently-known item has an admin decision, but the order isn't
    // actually done — it's waiting on the customer to pick a substitute (or
    // skip) for each unavailable item. Moving off 'awaiting_stock_confirmation'
    // here means a stray duplicate WhatsApp button tap for an already-decided
    // item correctly gets "already handled" from processAdminItemStockReply's
    // status check, instead of silently re-recording it. The order stays
    // visible in the admin panel's stock-confirmation view either way —
    // getOrdersPendingStockConfirmation fetches both statuses — just rendered
    // as "waiting on customer" instead of actionable (see the frontend fix in
    // rede-pecas-admin). Moves back to 'awaiting_stock_confirmation' once a
    // swapped-in alternative needs its own admin confirmation (see
    // processAlternativeSelection below).
    await updateOrderStatus(orderNumber, 'awaiting_alternative_resolution');
    await savePendingAlternativeResolution(phone, { orderNumber, queue: unavailable.map((i) => i.itemId) });
    await searchAlternativesForNextItem(orderNumber, phone);
    return;
  }

  if (available.length === 0) {
    await updateOrderStatus(orderNumber, 'stock_unavailable');
    await sendReply(phone, messages.agent.basketAllUnavailable());
    logger.info(`[ADMIN STOCK][BASKET] Order ${orderNumber} — every item unavailable or declined, customer notified`);
    return;
  }

  if (declined.length > 0) {
    await sendReply(phone, messages.agent.basketDeclinedNotice(declined.map((i) => i.productName)));
  }

  await sendReply(phone, messages.agent.stockConfirmedIntro(available.map((i) => i.productName).join(', '), firstName));

  const proformaLineItems: { description: string; reference: string; price: number; supplierNote?: string | null; isService?: boolean }[] = [];
  for (const item of available) {
    await decrementOfferStock(item.productId, item.quantity || 1);
    proformaLineItems.push({
      description: item.productName,
      reference: item.reference,
      price: item.unitPrice,
      supplierNote: messages.pdf.proforma.supplierLabel(item.supplierName || 'Rede Peças'),
    });
    if (item.serviceName) {
      proformaLineItems.push({ description: item.serviceName, reference: '—', price: item.servicePrice || 0, supplierNote: null, isService: true });
    }
  }

  const proformaPath = await generateProformaPDF(orderNumber, phone, proformaLineItems, locale);
  await sendProformaWhatsApp(phone, proformaPath, orderNumber, locale);

  const total = await getOrderAmount(orderNumber);
  await askPaymentMethod(phone, orderNumber, total);

  logger.info(`[ADMIN STOCK][BASKET] Order ${orderNumber} finalized — ${available.length} available, ${declined.length} declined`);
}

/**
 * Converts alternative product candidates into WhatsApp List Message rows,
 * appending a final "skip this item" row — same UX pattern as
 * `buildServiceListRows`, reusing the `option_N` id scheme
 * `resolveOptionIndex` already expects.
 */
function buildAlternativeListRows(options: Product[], skipLabel: string): { id: string; title: string; description: string }[] {
  const rows = buildProductListRows(options);
  rows.push({ id: `option_${options.length + 1}`, title: truncate(skipLabel, 24), description: '' });
  return rows;
}

/**
 * Pops the next rejected item off a multi-item order's alternative-
 * resolution queue and searches for in-stock alternatives (excluding every
 * product already tried for that slot), sending the results as a
 * selectable list with a skip option — or, if nothing matches at all,
 * automatically declines the item and moves straight to the next one.
 */
async function searchAlternativesForNextItem(orderNumber: string, phone: string): Promise<void> {
  const resolution = await getPendingAlternativeResolution(phone);
  if (!resolution || resolution.queue.length === 0) return;

  const [itemId, ...rest] = resolution.queue;
  await savePendingAlternativeResolution(phone, { ...resolution, queue: rest });

  const order = await getOrderRaw(orderNumber);
  const items: OrderItemEntry[] = order?.items || [];
  const item = items.find((i) => i.itemId === itemId);
  if (!item) {
    await advanceAlternativeResolution(orderNumber, phone);
    return;
  }

  const messages = await resolveMessages(phone);
  const vehicle = await resolveSearchVehicle(phone);
  const excludeProductIds = [item.productId, ...(item.excludedProductIds || [])];
  // Constrain to the rejected product's own subcategory (e.g. 'Brakes') —
  // otherwise the OR-joined full-text query can match on just one common
  // word in its name and surface a completely unrelated part as an
  // "alternative". See searchProductsInInventory's subcategory param.
  const rejectedProduct = await getProductByIdAnyStatus(item.productId);
  const options = await searchProductsInInventory({
    part: item.productName,
    vehicle,
    excludeProductIds,
    subcategory: rejectedProduct?.subcategory,
  });

  if (!options.length) {
    await declineOrderItem(orderNumber, itemId);
    await sendReply(phone, messages.agent.noAlternativesFound(item.productName));
    await advanceAlternativeResolution(orderNumber, phone);
    return;
  }

  await savePendingOptions(phone, options);
  await savePendingAlternativeOffer(phone, { orderNumber, itemId });
  await sendReplyList(
    phone,
    messages.agent.alternativesListBody(item.productName, options.length),
    messages.agent.searchListButton(),
    buildAlternativeListRows(options, messages.agent.alternativeSkipOption())
  );
}

/**
 * Moves the alternative-resolution queue forward after one item is
 * resolved (picked or skipped): searches alternatives for the next
 * rejected item, or — once the queue is empty — clears it and re-checks
 * whether the order can now finalize (it may still be waiting on admin for
 * a just-picked alternative).
 */
async function advanceAlternativeResolution(orderNumber: string, phone: string): Promise<void> {
  const resolution = await getPendingAlternativeResolution(phone);
  if (!resolution) return;

  if (resolution.queue.length > 0) {
    await searchAlternativesForNextItem(orderNumber, phone);
    return;
  }

  await clearPendingAlternativeResolution(phone);
  await finalizeMultiItemOrderIfComplete(orderNumber);
}

/**
 * Handles the customer's reply to an unavailable item's alternatives list:
 * on a pick, swaps the item for the chosen product and sends it back to
 * admin for its own stock confirmation; on skip, marks the item declined.
 * Either way, moves on to the next rejected item in the queue (if any).
 */
export async function processAlternativeSelection(
  phone: string,
  customerText: string | null,
  listReplyId: string | null,
  pendingOptions: Product[],
  offer: PendingAlternativeOffer
): Promise<boolean> {
  const idx = resolveOptionIndex(customerText, listReplyId);
  if (idx === null) return false;

  const messages = await resolveMessages(phone);

  if (idx === pendingOptions.length) {
    await clearPendingOptions(phone);
    await clearPendingAlternativeOffer(phone);
    await declineOrderItem(offer.orderNumber, offer.itemId);
    await advanceAlternativeResolution(offer.orderNumber, phone);
    return true;
  }

  const choice = pendingOptions[idx];
  if (!choice) {
    await sendReply(phone, messages.agent.optionNotFound());
    return true;
  }

  await clearPendingOptions(phone);
  await clearPendingAlternativeOffer(phone);

  await replaceOrderItemWithAlternative(offer.orderNumber, offer.itemId, {
    id: choice.id!,
    name: choice.name,
    reference: choice.reference,
    price: choice.price,
    supplier_id: choice.supplier_id!,
    supplier: choice.supplier,
  });

  const order = await getOrderRaw(offer.orderNumber);
  const items: OrderItemEntry[] = order?.items || [];
  const item = items.find((i) => i.itemId === offer.itemId);
  if (item) {
    // The swapped-in alternative is 'pending' again and needs its own admin
    // confirmation — move the order back to 'awaiting_stock_confirmation' so
    // it re-enters the admin queue and so processAdminItemStockReply's
    // "already handled" guard (which checks this exact status) doesn't
    // reject the admin's upcoming Confirm/Unavailable tap for it.
    await updateOrderStatus(offer.orderNumber, 'awaiting_stock_confirmation');
    const customer = await getCustomerByPhone(phone);
    const customerName = customer?.name?.split(' ')[0] || 'Cliente';
    await notifyAdminsForItem(offer.orderNumber, phone, customerName, item);
  }

  await advanceAlternativeResolution(offer.orderNumber, phone);
  return true;
}

/**
 * Finalizes an order once staff confirm stock is available: sends the
 * customer a confirmation message, generates and sends the proforma PDF, and
 * kicks off the payment-method flow.
 */
export async function confirmStockAndFinalizeOrder(orderNumber: string): Promise<void> {
  const order = await getOrderByNumber(orderNumber);
  if (!order) throw new ApiError(404, `Order ${orderNumber} not found`);

  // The moment admin confirms the unit is actually on the shelf is when it's
  // committed to this order — not at order creation (before anyone's
  // checked) and not at payment approval (too late; it'd already be
  // double-sellable to another customer in the meantime).
  await decrementOfferStock(order.product_id, order.quantity || 1);

  const phone = order.customer_phone;
  const product: Product = {
    name: order.product_name,
    reference: order.reference,
    price: Number(order.unit_price),
    quantity: order.quantity,
    supplier: order.supplier_name,
  };
  const service = order.service_price
    ? { name: order.service_name, price: Number(order.service_price) }
    : null;
  const total = product.price + (service?.price ?? 0);

  const customer = await getCustomerByPhone(phone);
  const firstName = customer?.name?.split(' ')[0] || 'Cliente';
  const locale = await resolveLocale(phone);
  const messages = getMessages(locale);
  await sendReply(phone, messages.agent.stockConfirmedIntro(product.name, firstName));

  const proformaLineItems = [
    { description: product.name, reference: product.reference, price: product.price, supplierNote: messages.pdf.proforma.supplierLabel(product.supplier || 'Rede Peças') },
    ...(service ? [{ description: service.name, reference: '—', price: service.price, supplierNote: null, isService: true }] : []),
  ];
  const proformaPath = await generateProformaPDF(orderNumber, phone, proformaLineItems, locale);
  await sendProformaWhatsApp(phone, proformaPath, orderNumber, locale);
  await askPaymentMethod(phone, orderNumber, total);
}

/**
 * Marks an order's stock as unavailable and offers the customer a choice
 * between an alternative product search or joining the waitlist.
 */
export async function markStockUnavailableAndOfferAlternative(orderNumber: string): Promise<void> {
  const order = await getOrderByNumber(orderNumber);
  if (!order) throw new ApiError(404, `Order ${orderNumber} not found`);

  await updateOrderStatus(orderNumber, 'stock_unavailable');

  const phone = order.customer_phone;
  const messages = await resolveMessages(phone);
  await sendReplyButtons(phone, messages.agent.stockUnavailable(order.product_name, order.reference), messages.agent.stockUnavailableButtons);
  await savePendingStockUnavailableOffer(phone, {
    orderNumber,
    productId: order.product_id,
    productName: order.product_name,
  });
}

const GENERIC_YES_PATTERN = /\b(sim|yes|yeah|yep|yup|sure|ok(ay)?|certo|pode|podes|quero|aceito|est[áa]\s*bem)\b/i;
const GENERIC_NO_PATTERN = /\b(n[ãa]o|no|nope|not\s*(interested|now)|dispensa)\b/i;

/**
 * Checks whether a customer's reply reads as a "yes" — a button tap, a
 * generic affirmative word, or an optional prompt-specific extra pattern.
 */
function isAffirmativeReply(reply: string, extra?: RegExp): boolean {
  const r = reply.toLowerCase().trim();
  if (r === '1' || r.includes('✅') || r.includes('btn_0')) return true;
  if (GENERIC_YES_PATTERN.test(r)) return true;
  return extra ? extra.test(r) : false;
}

/**
 * Checks whether a customer's reply reads as a "no" — a button tap, a
 * generic negative word, or an optional prompt-specific extra pattern.
 */
function isNegativeReply(reply: string, extra?: RegExp): boolean {
  const r = reply.toLowerCase().trim();
  if (r === '2' || r.includes('❌') || r.includes('btn_1')) return true;
  if (GENERIC_NO_PATTERN.test(r)) return true;
  return extra ? extra.test(r) : false;
}

const STOCK_UNAVAILABLE_YES_EXTRA = /\b(alternative|alternativa|other\s*option|outra\s*op[çc][ãa]o)\b/i;
const STOCK_UNAVAILABLE_NO_EXTRA = /\b(wait\s*list|waitlist|join\s*(the\s*)?waitlist|lista\s*de\s*espera)\b/i;

/**
 * Handles the customer's reply to the "stock unavailable" offer: on yes,
 * searches for an alternative product (or falls back to the waitlist); on
 * no, adds them to the waitlist; otherwise leaves the offer pending.
 */
export async function processStockUnavailableChoice(
  phone: string,
  reply: string,
  offer: PendingStockUnavailableOffer,
  customerName: string
): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const isYes = isAffirmativeReply(reply, STOCK_UNAVAILABLE_YES_EXTRA);
  const isNo = isNegativeReply(reply, STOCK_UNAVAILABLE_NO_EXTRA);

  if (isYes) {
    await clearPendingStockUnavailableOffer(phone);
    const vehicle = await resolveSearchVehicle(phone);
    // Constrain to the rejected product's own subcategory — see the same
    // reasoning in searchAlternativesForNextItem (multi-item basket flow).
    const rejectedProduct = await getProductByIdAnyStatus(offer.productId);
    const options = await searchProductsInInventory({
      part: offer.productName,
      vehicle,
      excludeProductIds: [offer.productId],
      subcategory: rejectedProduct?.subcategory,
    });
    if (!options.length) {
      await sendReplyButtons(phone, messages.agent.noStockFound(), messages.agent.noStockFoundButtons);
      await savePendingWaitlistOffer(phone, { productId: offer.productId, productName: offer.productName });
      return true;
    }
    await savePendingOptions(phone, options);
    await sendReplyList(
      phone,
      messages.agent.searchListBody(options.length, offer.productName, customerName),
      messages.agent.searchListButton(),
      buildProductListRows(options)
    );
    return true;
  }
  if (isNo) {
    await clearPendingStockUnavailableOffer(phone);
    await addToProductWaitlist(offer.productId, phone);
    await sendReply(phone, messages.agent.waitlistConfirmed(offer.productName));
    return true;
  }
  return false;
}

/**
 * Handles an admin's tap on the Confirm/Unavailable stock buttons sent
 * over WhatsApp, finalizing or marking-unavailable the matching order and
 * telling the admin if it was already handled.
 */
export async function processAdminStockReply(adminPhone: string, buttonReplyId: string | null): Promise<void> {
  logger.debug(`[ADMIN STOCK] Reply from admin ${adminPhone}: buttonReplyId=${buttonReplyId}`);

  const match = buttonReplyId?.match(/^admin_(confirm|unavailable)_(.+)$/);
  if (!match) {
    logger.debug(`[ADMIN STOCK] Reply from ${adminPhone} did not match a stock-confirmation button (buttonReplyId=${buttonReplyId}) — sending nudge`);
    await sendWhatsAppMessage(adminPhone, t.admin.useButtonsPrompt());
    return;
  }

  const [, action, orderNumber] = match;
  logger.info(`[ADMIN STOCK] Admin ${adminPhone} tapped "${action}" for order ${orderNumber}`);

  const order = await getOrderByNumber(orderNumber);
  if (!order || order.status !== 'awaiting_stock_confirmation') {
    logger.debug(`[ADMIN STOCK] Order ${orderNumber} already handled (status=${order?.status ?? 'not found'}) — telling ${adminPhone}`);
    await sendWhatsAppMessage(adminPhone, t.admin.alreadyHandled(orderNumber));
    return;
  }

  if (action === 'confirm') {
    await confirmStockAndFinalizeOrder(orderNumber);
    await sendWhatsAppMessage(adminPhone, t.admin.confirmedAck(orderNumber));
    logger.info(`[ADMIN STOCK] Order ${orderNumber} confirmed by ${adminPhone} — proforma sent to customer`);
  } else {
    await markStockUnavailableAndOfferAlternative(orderNumber);
    await sendWhatsAppMessage(adminPhone, t.admin.unavailableAck(orderNumber));
    logger.info(`[ADMIN STOCK] Order ${orderNumber} marked unavailable by ${adminPhone} — customer notified`);
  }
}

/**
 * Sweeps orders overdue by 20+ minutes awaiting stock confirmation and
 * sends each customer a courtesy "still checking" message.
 */
export async function sendStockConfirmationCourtesyMessages(): Promise<void> {
  const overdue = await getOrdersAwaitingCourtesyMessage(20);
  for (const order of overdue) {
    try {
      const messages = await resolveMessages(order.customer_phone);
      await sendReply(order.customer_phone, messages.agent.stockConfirmationCourtesy());
      await markCourtesyMessageSent(order.number);
    } catch (error: any) {
      logger.error(`Error sending stock-confirmation courtesy message for order ${order.number}`, error);
    }
  }
}

/**
 * Sweeps orders overdue by 15+ minutes awaiting stock confirmation and
 * re-pushes the Confirm/Unavailable buttons to all admins as a reminder.
 */
export async function sendStockConfirmationAdminReminders(): Promise<void> {
  const overdue = await getOrdersAwaitingAdminReminder(15);
  if (overdue.length) {
    logger.debug(`[ADMIN STOCK] Admin reminder sweep: ${overdue.length} order(s) overdue past 15 minutes`);
  }
  for (const order of overdue) {
    try {
      const admins = await getAllAdmins();
      for (const admin of admins) {
        await sendWhatsAppButtons(
          admin.phone,
          t.admin.reminderBody(order.customer_first_name, order.product_name, order.number),
          [t.admin.confirmButtonLabel(), t.admin.unavailableButtonLabel()],
          [`admin_confirm_${order.number}`, `admin_unavailable_${order.number}`]
        );
      }
      await markAdminReminderSent(order.number);
      logger.info(`[ADMIN STOCK] Sent 15-min reminder for order ${order.number} to ${admins.length} admin(s)`);
    } catch (error: any) {
      logger.error(`[ADMIN STOCK] Error sending stock-confirmation admin reminder for order ${order.number}`, error);
    }
  }
}

/**
 * Creates a new order for a chosen product directly (no search-results-list
 * confirm/cancel step — used only by the restock-reorder path, where the
 * customer already made their yes/no decision on the restock notification
 * itself) and either offers the customer matching add-on services first, or
 * goes straight to requesting stock confirmation.
 */
async function startOrderForProduct(phone: string, product: Product, partType: string | null = null): Promise<void> {
  const messages = await resolveMessages(phone);
  const orderNumber = await generateOrderNumber();
  await createOrder(orderNumber, phone, product, partType);

  const matchingServices = product.id ? await getMatchingServicesForProduct(product.id) : [];
  const offeredServices = matchingServices.slice(0, 3);

  if (offeredServices.length > 0) {
    await sendReply(phone, messages.agent.productSelected(product.name, formatPrice(product.price)));
    await savePendingServiceOffer(phone, { orderNumber, product, services: offeredServices });
    await sendReplyList(
      phone,
      messages.agent.serviceListBody(offeredServices.length),
      messages.agent.serviceListButton(),
      buildServiceListRows(offeredServices, messages.agent.serviceSkipOption())
    );
    return;
  }

  await startOrderProfileCapture(phone, orderNumber);
}

/**
 * Handles the customer's reply to a service-offer list, adding the chosen
 * service to the order (or skipping) and then requesting stock confirmation.
 */
export async function processServiceSelection(
  phone: string,
  customerText: string | null,
  listReplyId: string | null,
  offer: PendingServiceOffer
): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const selection = resolveServiceSelection(customerText, listReplyId, offer.services.length);
  if (selection === null) return false;

  await clearPendingServiceOffer(phone);

  if (!offer.orderNumber) {
    // Basket mode: no order exists yet — append the choice/skip to the
    // in-progress basket and move on to the next queued product (or the
    // final summary) instead of requesting stock confirmation directly.
    const basket = await getPendingBasket(phone);
    if (!basket) return true;

    if (selection === 'skip') {
      await sendReply(phone, messages.agent.serviceDeclined());
      await savePendingBasket(phone, { ...basket, items: [...basket.items, { product: offer.product, service: null }] });
    } else {
      const chosen = offer.services[selection];
      const total = Number(offer.product.price) + Number(chosen.service_base_price);
      await sendReply(phone, messages.agent.serviceAdded(chosen.service_name, formatPrice(total)));
      await savePendingBasket(phone, {
        ...basket,
        items: [...basket.items, { product: offer.product, service: { name: chosen.service_name, price: Number(chosen.service_base_price) } }],
      });
    }
    await advanceBasket(phone);
    return true;
  }

  if (selection === 'skip') {
    await sendReply(phone, messages.agent.serviceDeclined());
    await startOrderProfileCapture(phone, offer.orderNumber);
    return true;
  }

  const chosen = offer.services[selection];
  await addServiceToOrder(offer.orderNumber, chosen.service_name, chosen.service_base_price);
  const total = Number(offer.product.price) + Number(chosen.service_base_price);
  await sendReply(phone, messages.agent.serviceAdded(chosen.service_name, formatPrice(total)));
  await startOrderProfileCapture(phone, offer.orderNumber);
  return true;
}

const WAITLIST_YES_EXTRA = /\b(add\s*me|notify\s*me|wait\s*list|waitlist|join\s*(the\s*)?waitlist|avisa[- ]?me|lista\s*de\s*espera)\b/i;

/**
 * Handles the customer's reply to a "join the waitlist?" offer for an
 * out-of-stock product, opting them in or acknowledging their decline.
 */
export async function processWaitlistOptIn(
  phone: string,
  reply: string,
  offer: { productId: number; productName: string; query?: string }
): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const isYes = isAffirmativeReply(reply, WAITLIST_YES_EXTRA);
  const isNo = isNegativeReply(reply);

  if (isYes) {
    await addToProductWaitlist(offer.productId, phone);
    await clearPendingWaitlistOffer(phone);
    await sendReply(phone, messages.agent.waitlistConfirmed(offer.query ?? offer.productName));
    if (await getPendingBasket(phone)) await advanceBasket(phone);
    return true;
  }
  if (isNo) {
    await clearPendingWaitlistOffer(phone);
    await sendReply(phone, messages.agent.waitlistDeclined());
    if (await getPendingBasket(phone)) await advanceBasket(phone);
    return true;
  }
  return false;
}

/**
 * Handles the customer's reply to the consolidated basket waitlist offer —
 * sent once, after every item in a multi-part search came back unmatched
 * (see advanceBasket) — opting them into the waitlist for every candidate
 * product at once instead of one at a time. The basket itself is already
 * cleared by the time this offer was sent (there's nothing left to confirm
 * or advance), so this is a self-contained yes/no with no follow-up step.
 */
export async function processBasketWaitlistOptIn(
  phone: string,
  reply: string,
  offer: PendingBasketWaitlistOffer
): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const isYes = isAffirmativeReply(reply, WAITLIST_YES_EXTRA);
  const isNo = isNegativeReply(reply);

  if (isYes) {
    for (const candidate of offer.candidates) {
      await addToProductWaitlist(candidate.productId, phone);
    }
    await clearPendingBasketWaitlistOffer(phone);
    await sendReply(phone, messages.agent.basketWaitlistConfirmed());
    return true;
  }
  if (isNo) {
    await clearPendingBasketWaitlistOffer(phone);
    await sendReply(phone, messages.agent.waitlistDeclined());
    return true;
  }
  return false;
}

/**
 * After an inventory import restocks products, sends each waitlisted
 * customer a restock notification with order/decline buttons, in their own locale.
 */
export async function notifyWaitlistedCustomers(restockNotifications: RestockNotification[]): Promise<void> {
  for (const { productId, productName, phones } of restockNotifications) {
    const product = await getProductById(productId);
    if (!product) continue;

    for (const phone of phones) {
      try {
        const customer = await getCustomerByPhone(phone);
        const firstName = customer?.name?.split(' ')[0] || 'Cliente';
        const messages = getMessages(await resolveLocale(phone));

        const vehicles = await getCustomerVehicles(phone);
        const vehicleSummary = vehicles.length ? `${vehicles[0].make} ${vehicles[0].model} ${vehicles[0].year}` : null;

        await sendReplyButtons(
          phone,
          messages.agent.restockNotification(firstName, productName, vehicleSummary, formatPrice(product.price), product.supplier || ''),
          messages.agent.restockNotificationButtons
        );
        await savePendingRestockOrderOffer(phone, { productId, productName });
      } catch (error: any) {
        logger.error(`Error sending restock notification to ${phone} for product ${productName}`, error);
      }
    }
  }
}

const RESTOCK_YES_EXTRA = /\b(order\s*now|order\s*it|pedir\s*agora|quero\s*encomendar|comprar)\b/i;
const RESTOCK_NO_EXTRA = /\b(not\s*now|maybe\s*later|agora\s*n[ãa]o)\b/i;

/**
 * Handles the customer's reply to a restock notification: on yes, starts
 * an order for the product (or falls back to the waitlist if it's out of
 * stock again); on no, acknowledges the decline.
 */
export async function processRestockOrderChoice(
  phone: string,
  reply: string,
  offer: { productId: number; productName: string }
): Promise<boolean> {
  const messages = await resolveMessages(phone);
  const isYes = isAffirmativeReply(reply, RESTOCK_YES_EXTRA);
  const isNo = isNegativeReply(reply, RESTOCK_NO_EXTRA);

  if (isYes) {
    await clearPendingRestockOrderOffer(phone);
    const product = await getProductById(offer.productId);
    if (!product || product.quantity <= 0) {
      await addToProductWaitlist(offer.productId, phone);
      await sendReply(phone, messages.agent.waitlistConfirmed(offer.productName));
      return true;
    }
    await startOrderForProduct(phone, product);
    return true;
  }
  if (isNo) {
    await clearPendingRestockOrderOffer(phone);
    await sendReply(phone, messages.agent.waitlistDeclined());
    return true;
  }
  return false;
}

export interface InventoryImportResult {
  inserted: number;
  updated: number;
  restockNotifications: RestockNotification[];
  skipped?: { row: number; reasons: string[] }[];
}

/**
 * Imports a batch of parsed inventory items into the DB and notifies any
 * waitlisted customers whose products were restocked as a result.
 */
export async function importInventoryBatch(
  items: ImportItem[],
  defaultSupplierId: number | null
): Promise<InventoryImportResult> {
  const result = await importProductsBatch(items, defaultSupplierId);
  await notifyWaitlistedCustomers(result.restockNotifications);
  return result;
}

const HEADER_ALIASES: Record<string, string[]> = {
  reference: ['sku', 'reference', 'referencia', 'ref'],
  name: ['product', 'produto', 'name', 'nome'],
  price: ['price', 'preco', 'preço'],
  quantity: ['quantity', 'quantidade', 'qty', 'stock'],
  supplierName: ['supplier name', 'supplier', 'supplier_name', 'fornecedor', 'nome_fornecedor'],
  supplierAddress: ['supplier address', 'supplier_address', 'endereco_fornecedor', 'supplier_province', 'provincia_fornecedor'],
  supplierPhone: ['supplier phone', 'supplier_phone', 'telefone_fornecedor'],
  category: ['category', 'categoria'],
  subcategory: ['subcategory', 'subcategoria'],
  productType: ['product_type', 'part_type', 'product type', 'part type', 'tipo_peca'],
  vehicleMake: ['vehicle_make', 'vehicle make', 'marca_veiculo'],
  vehicleModel: ['vehicle_model', 'vehicle model', 'modelo_veiculo'],
  yearStart: ['year_start', 'year start', 'ano_inicio'],
  yearEnd: ['year_end', 'year end', 'ano_fim'],
  engine: ['engine', 'motor'],
  deliveryTime: ['delivery_time', 'delivery time', 'prazo_entrega'],
  brand: ['part_brand', 'brand', 'marca'],
  oemReference: ['oem_reference', 'oem reference', 'referencia_oem'],
  engineNumber: ['engine_number', 'engine number', 'numero_motor'],
  viscosity: ['viscosity', 'viscosidade'],
  engineType: ['engine_type', 'engine type', 'tipo_motor'],
  volumeLiters: ['volume_liters', 'volume liters', 'volume_litros'],
  specification: ['specification', 'especificacao'],
  intervalKm: ['interval_km', 'interval km', 'intervalo_km'],
  imageUrl: ['image_url', 'image url', 'url_imagem'],
  synonyms: ['synonyms', 'sinonimos'],
  description: ['description', 'descricao', 'descrição'],
};

const REQUIRED_COLUMNS: { field: keyof typeof HEADER_ALIASES; label: string }[] = [
  { field: 'reference', label: 'SKU' },
  { field: 'name', label: 'Product' },
  { field: 'price', label: 'Price' },
  { field: 'quantity', label: 'Quantity' },
  { field: 'supplierName', label: 'Supplier Name' },
  { field: 'category', label: 'Category' },
  { field: 'subcategory', label: 'Subcategory' },
  { field: 'productType', label: 'Part Type' },
  { field: 'vehicleMake', label: 'Vehicle Make' },
  { field: 'deliveryTime', label: 'Delivery Time' },
  { field: 'synonyms', label: 'Synonyms' },
  { field: 'description', label: 'Description' },
];

/**
 * Checks an uploaded spreadsheet's header row against the required
 * inventory columns (accepting any known alias) and returns the labels of any that are missing.
 */
function getMissingRequiredColumns(headerRow: unknown[]): string[] {
  const headerSet = new Set(headerRow.map((h) => String(h ?? '').trim().toLowerCase()));
  return REQUIRED_COLUMNS.filter(({ field }) => !HEADER_ALIASES[field].some((alias) => headerSet.has(alias))).map(
    ({ label }) => label
  );
}

/**
 * Validates and normalizes a single spreadsheet row into an ImportItem,
 * resolving header aliases, or returns the list of validation failure
 * reasons if the row is invalid. subcategory/product_type are free text —
 * only checked for presence, not against any allow-list.
 */
function validateRow(row: Record<string, any>, rowNumber: number): { item: ImportItem } | { reasons: string[] } {
  const lowerRow = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  const pick = (field: string) => {
    for (const alias of HEADER_ALIASES[field]) {
      if (lowerRow[alias] !== undefined && lowerRow[alias] !== '') return lowerRow[alias];
    }
    return undefined;
  };
  const pickStr = (field: string) => {
    const v = pick(field);
    return v !== undefined ? String(v) : undefined;
  };
  const pickNum = (field: string) => {
    const v = pick(field);
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  };
  const pickInt = (field: string) => {
    const n = pickNum(field);
    return n !== undefined && Number.isInteger(n) ? n : undefined;
  };

  const reasons: string[] = [];

  const reference = pick('reference');
  if (!reference) reasons.push('Reference is required.');

  const name = pick('name');
  if (!name) reasons.push('Name is required.');

  const priceRaw = pick('price');
  const price = Number(priceRaw);
  if (priceRaw === undefined || Number.isNaN(price) || price < 0) {
    reasons.push('Price is required and must be a non-negative number.');
  }

  const quantityRaw = pick('quantity');
  const quantity = Number(quantityRaw);
  if (quantityRaw === undefined || !Number.isInteger(quantity) || quantity < 0) {
    reasons.push('Quantity is required and must be a non-negative whole number.');
  }

  const supplierName = pick('supplierName');
  if (!supplierName) reasons.push('Supplier is required.');

  const category = pick('category');
  if (!category) reasons.push('Category is required.');

  const subcategory = pick('subcategory');
  // service_category tracks subcategory directly now (see db/schema.sql's
  // products table comment) — no more subcategory→bucket lookup.
  const serviceCategory = subcategory ? String(subcategory) : undefined;
  if (!subcategory) reasons.push('Subcategory is required.');

  const productType = pick('productType');
  if (!productType) reasons.push('Part Type is required.');

  const vehicleMake = pick('vehicleMake');
  if (!vehicleMake) reasons.push('Vehicle Make is required.');

  const deliveryTime = pick('deliveryTime');
  if (!deliveryTime) reasons.push('Delivery Time is required.');

  const synonyms = pick('synonyms');
  if (!synonyms) reasons.push('Synonyms is required.');

  const description = pick('description');
  if (!description) reasons.push('Description is required.');

  if (reasons.length) return { reasons: reasons.map((r) => `Row ${rowNumber}: ${r}`) };

  return {
    item: {
      reference: String(reference),
      name: String(name),
      price,
      quantity,
      supplierName: String(supplierName),
      supplierAddress: pickStr('supplierAddress'),
      supplierPhone: pickStr('supplierPhone'),
      category: String(category),
      subcategory: String(subcategory),
      serviceCategory: serviceCategory!,
      productType: String(productType),
      vehicleMake: String(vehicleMake),
      vehicleModel: pickStr('vehicleModel'),
      yearStart: pickInt('yearStart'),
      yearEnd: pickInt('yearEnd'),
      engine: pickStr('engine'),
      deliveryTime: String(deliveryTime),
      brand: pickStr('brand'),
      oemReference: pickStr('oemReference'),
      engineNumber: pickStr('engineNumber'),
      viscosity: pickStr('viscosity'),
      engineType: pickStr('engineType'),
      volumeLiters: pickNum('volumeLiters'),
      specification: pickStr('specification'),
      intervalKm: pickInt('intervalKm'),
      imageUrl: pickStr('imageUrl'),
      synonyms: String(synonyms),
      description: String(description),
    },
  };
}

/**
 * Parses an uploaded Excel inventory file, validates its header and every
 * data row, then imports the valid rows and returns the import result
 * alongside any rows that had to be skipped.
 */
export async function importInventoryFromFile(fileBuffer: Buffer): Promise<InventoryImportResult> {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const headerRow = (XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })[0] as unknown[] | undefined) ?? [];
  const missingColumns = getMissingRequiredColumns(headerRow);
  if (missingColumns.length) {
    throw new ApiError(400, `Missing required column(s): ${missingColumns.join(', ')}.`);
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
  if (!rawRows.length) {
    throw new ApiError(400, 'The file has no data rows.');
  }

  const items: ImportItem[] = [];
  const skipped: { row: number; reasons: string[] }[] = [];
  rawRows.forEach((row, i) => {
    const rowNumber = i + 2;
    const result = validateRow(row, rowNumber);
    if ('reasons' in result) skipped.push({ row: rowNumber, reasons: result.reasons });
    else items.push(result.item);
  });

  const result = await importInventoryBatch(items, null);
  return { ...result, skipped };
}

const TEMPLATE_HEADER_ROW = [
  'SKU',
  'Product',
  'Price',
  'Quantity',
  'Supplier Name',
  'Supplier Address',
  'Supplier Phone',
  'Category',
  'Subcategory',
  'Part Type',
  'Vehicle Make',
  'Vehicle Model',
  'Year Start',
  'Year End',
  'Engine',
  'Delivery Time',
  'Brand',
  'OEM Reference',
  'Engine Number',
  'Viscosity',
  'Engine Type',
  'Volume Liters',
  'Specification',
  'Interval Km',
  'Image Url',
  'Synonyms',
  'Description',
];

/**
 * Generates a blank Excel workbook containing only the expected inventory
 * import header row, for staff to download as a starting template.
 */
export function generateInventoryTemplateFile(): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADER_ROW]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
