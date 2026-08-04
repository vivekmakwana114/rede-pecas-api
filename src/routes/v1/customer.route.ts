import express from 'express';
import {
  getCustomersHandler,
  getCustomerHandler,
  updateCustomerHandler,
  deleteCustomerHandler,
} from '../../controllers/customer.controller.js';
import { authMiddleware } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { adminValidation } from '../../validations/index.js';

const router = express.Router();

router.get('/customers', authMiddleware, validate(adminValidation.customerListQuery), getCustomersHandler);
router.get('/customers/:phone', authMiddleware, validate(adminValidation.customerPhoneParams), getCustomerHandler);
router.patch('/customers/:phone', authMiddleware, validate(adminValidation.customerUpdate), updateCustomerHandler);
router.delete('/customers/:phone', authMiddleware, validate(adminValidation.customerPhoneParams), deleteCustomerHandler);

export default router;
