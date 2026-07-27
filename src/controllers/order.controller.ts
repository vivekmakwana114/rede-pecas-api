import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { ApiError } from '../utils/ApiError.js';
import { formatDateTime } from '../utils/helpers.js';
import {
  getOrdersPendingApproval,
  getOrdersApproved,
  getOrdersRejected,
  getOrdersPendingStockConfirmation,
  updateOrderStatus,
  getOrderByNumber,
  getOrderAnalytics,
  AnalyticsPeriod,
  getOrderStats,
  hideApprovedOrder,
} from '../models/order.model.js';
import { approveOrder } from '../services/payment.service.js';
import {
  confirmStockAndFinalizeOrder,
  markStockUnavailableAndOfferAlternative,
  finalizeMultiItemOrderIfComplete,
} from '../services/product.service.js';
import { setOrderItemAvailability } from '../models/order.model.js';
import { resolveMessages } from '../services/customer.service.js';
import { downloadWhatsAppMedia } from '../services/whatsapp.service.js';
import { sendReply } from '../services/reply.service.js';

/**
 * Backs `GET /v1/admin/orders` — fetches pending, approved, rejected, and
 * stock-confirmation order lists in parallel and returns them as separate buckets.
 */
export const getOrders = catchAsync(async (req: Request, res: Response) => {
  const range = (req.query.range as 'today' | 'all') || 'all';
  const [pending, approved, rejected, stockConfirmation] = await Promise.all([
    getOrdersPendingApproval(),
    getOrdersApproved(range),
    getOrdersRejected(range),
    getOrdersPendingStockConfirmation(),
  ]);

  res.status(200).json({
    success: true,
    message: 'Orders retrieved.',
    code: 200,
    data: { pending, approved, rejected, stockConfirmation },
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `POST /v1/admin/orders/:number/confirm/stock` — for a legacy
 * single-product order (body `{ available }`), either finalizes it or marks
 * it stock-unavailable exactly as before. For a multi-item "basket" order
 * (body `{ items: [{ itemId, available }] }`), applies each item's
 * availability and finalizes the order once every item has an answer — the
 * admin-panel REST equivalent of the per-item WhatsApp Confirm/Unavailable
 * buttons (`processAdminItemStockReply` in product.service.ts).
 */
export const confirmOrderStockHandler = catchAsync(async (req: Request, res: Response) => {
  const { number } = req.params;
  const { available, items } = req.body as { available?: boolean; items?: { itemId: number; available: boolean }[] };

  if (items) {
    for (const item of items) {
      await setOrderItemAvailability(number, item.itemId, item.available);
    }
    await finalizeMultiItemOrderIfComplete(number);

    res.status(200).json({
      success: true,
      message: `Stock availability recorded for ${items.length} item(s) on order ${number}.`,
      code: 200,
      data: null,
      meta: { timestamp: new Date().toISOString() },
    });
    return;
  }

  if (available) {
    await confirmStockAndFinalizeOrder(number);
  } else {
    await markStockUnavailableAndOfferAlternative(number);
  }

  res.status(200).json({
    success: true,
    message: available ? `Stock confirmed for order ${number}.` : `Order ${number} marked stock-unavailable.`,
    code: 200,
    data: null,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `POST /v1/admin/orders/:number/review` — approves the order (via
 * `approveOrder`) or rejects it, updating `orders.status` and notifying the customer over WhatsApp on rejection.
 */
export const reviewOrderHandler = catchAsync(async (req: Request, res: Response) => {
  const { number } = req.params;
  const { approved } = req.body;

  if (approved) {
    const result = await approveOrder(number, 999);

    res.status(200).json({
      success: true,
      message: `Order ${number} approved.`,
      code: 200,
      data: result,
      meta: { timestamp: new Date().toISOString() },
    });
    return;
  }

  await updateOrderStatus(number, 'rejected');

  const order = await getOrderByNumber(number);
  if (order) {
    const messages = await resolveMessages(order.customer_phone);
    await sendReply(order.customer_phone, messages.order.rejected(number));
  }

  res.status(200).json({
    success: true,
    message: `Order ${number} rejected.`,
    code: 200,
    data: null,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin order-analytics endpoint — returns bucketed revenue/status
 * counts for the requested period (daily/monthly/yearly) for dashboard charting.
 */
export const getOrderAnalyticsHandler = catchAsync(async (req: Request, res: Response) => {
  const period = req.query.period as AnalyticsPeriod;
  const points = await getOrderAnalytics(period);

  res.status(200).json({
    success: true,
    message: 'Order analytics retrieved.',
    code: 200,
    data: { points },
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin order-stats endpoint — returns overall totals (order count,
 * approved/rejected counts, approved revenue) across all orders.
 */
export const getOrderStatsHandler = catchAsync(async (req: Request, res: Response) => {
  const stats = await getOrderStats();

  res.status(200).json({
    success: true,
    message: 'Order stats retrieved.',
    code: 200,
    data: stats,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin single-order endpoint — looks up one order by its number,
 * 404ing if not found, and returns it with its timestamp fields formatted.
 */
export const getOrderHandler = catchAsync(async (req: Request, res: Response) => {
  const { number } = req.params;
  const order = await getOrderByNumber(number);
  if (!order) throw new ApiError(404, `Order ${number} not found`);

  res.status(200).json({
    success: true,
    message: 'Order retrieved.',
    code: 200,
    data: {
      ...order,
      created_at: formatDateTime(order.created_at),
      approved_at: formatDateTime(order.approved_at),
      updated_at: formatDateTime(order.updated_at),
    },
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin order-removal endpoint — hides an approved order from the
 * admin grid (`orders.admin_hidden`), rejecting the request if the order isn't approved or doesn't exist.
 */
export const deleteOrderHandler = catchAsync(async (req: Request, res: Response) => {
  const { number } = req.params;
  const result = await hideApprovedOrder(number);

  if (result === 'not_found') throw new ApiError(404, `Order ${number} not found`);
  if (result === 'not_approved') {
    throw new ApiError(409, `Order ${number} is not approved yet — only approved orders can be removed from the grid.`);
  }

  res.status(200).json({
    success: true,
    message: `Order ${number} removed from the grid.`,
    code: 200,
    data: null,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `GET /v1/admin/orders/:number/payment/proof` — streams the customer's
 * uploaded payment-proof photo/PDF straight from Meta's Graph API as raw bytes, one of the two non-JSON-envelope responses in this API.
 */
export const getPaymentProofHandler = catchAsync(async (req: Request, res: Response) => {
  const { number } = req.params;
  const order = await getOrderByNumber(number);
  if (!order) throw new ApiError(404, `Order ${number} not found`);
  if (!order.payment_proof_media_id) throw new ApiError(404, `Order ${number} has no payment proof on file`);

  const fileBase64 = await downloadWhatsAppMedia(order.payment_proof_media_id);
  if (!fileBase64) throw new ApiError(502, `Could not fetch payment proof for order ${number} from WhatsApp`);

  res.set('Content-Type', order.payment_proof_media_type === 'document' ? 'application/pdf' : 'image/jpeg');
  res.send(Buffer.from(fileBase64, 'base64'));
});
