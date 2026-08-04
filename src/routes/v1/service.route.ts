import express from 'express';
import multer from 'multer';
import {
  getServicesHandler,
  getServiceHandler,
  updateServiceHandler,
  deleteServiceHandler,
  importServicesBatchHandler,
  importServicesFileHandler,
  downloadServicesTemplateHandler,
} from '../../controllers/service.controller.js';
import { authMiddleware } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { serviceValidation } from '../../validations/index.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/services', authMiddleware, getServicesHandler);
router.get('/services/template', authMiddleware, downloadServicesTemplateHandler);
router.post('/services/upload', authMiddleware, validate(serviceValidation.importServicesBatch), importServicesBatchHandler);
router.post('/services/import', authMiddleware, upload.single('file'), importServicesFileHandler);
router.get('/services/:id', authMiddleware, validate(serviceValidation.serviceIdParams), getServiceHandler);
router.patch('/services/:id', authMiddleware, validate(serviceValidation.serviceUpdate), updateServiceHandler);
router.delete('/services/:id', authMiddleware, validate(serviceValidation.serviceIdParams), deleteServiceHandler);

export default router;
