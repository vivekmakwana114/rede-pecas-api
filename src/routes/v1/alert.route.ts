import express from 'express';
import { getAlertsHandler, markAlertReadHandler } from '../../controllers/alert.controller.js';
import { authMiddleware } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { adminValidation } from '../../validations/index.js';

const router = express.Router();

router.get('/alerts', authMiddleware, getAlertsHandler);
router.post('/alerts/:id/read', authMiddleware, validate(adminValidation.alertParams), markAlertReadHandler);

export default router;
