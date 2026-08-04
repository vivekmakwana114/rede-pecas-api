import express from 'express';
import {
  getOrders,
  getOrderHandler,
  getOrderAnalyticsHandler,
  getOrderStatsHandler,
  reviewOrderHandler,
  confirmOrderStockHandler,
  getPaymentProofHandler,
  deleteOrderHandler,
} from '../../controllers/order.controller.js';
import { authMiddleware } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { adminValidation } from '../../validations/index.js';

const router = express.Router();

router.get('/orders', authMiddleware, validate(adminValidation.orderListQuery), getOrders);
router.get('/orders/analytics', authMiddleware, validate(adminValidation.orderAnalyticsQuery), getOrderAnalyticsHandler);
router.get('/orders/stats', authMiddleware, getOrderStatsHandler);
router.get('/orders/:number', authMiddleware, validate(adminValidation.orderNumberParams), getOrderHandler);
router.delete('/orders/:number', authMiddleware, validate(adminValidation.orderNumberParams), deleteOrderHandler);
router.post('/orders/:number/review', authMiddleware, validate(adminValidation.orderReview), reviewOrderHandler);
router.post('/orders/:number/confirm/stock', authMiddleware, validate(adminValidation.orderStockConfirmation), confirmOrderStockHandler);
router.get('/orders/:number/payment/proof', authMiddleware, validate(adminValidation.orderNumberParams), getPaymentProofHandler);

export default router;
