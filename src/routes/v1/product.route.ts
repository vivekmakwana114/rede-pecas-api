import express from 'express';
import multer from 'multer';
import {
  getProductsHandler,
  getProductHandler,
  updateProductHandler,
  deleteProductHandler,
  importProductsBatchHandler,
  importProductsFileHandler,
  downloadInventoryTemplateHandler,
} from '../../controllers/product.controller.js';
import { authMiddleware } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { adminValidation } from '../../validations/index.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/products', authMiddleware, getProductsHandler);
router.get('/products/:id', authMiddleware, validate(adminValidation.productIdParams), getProductHandler);
router.patch('/products/:id', authMiddleware, validate(adminValidation.productUpdate), updateProductHandler);
router.delete('/products/:id', authMiddleware, validate(adminValidation.productIdParams), deleteProductHandler);
router.get('/inventory/template', authMiddleware, downloadInventoryTemplateHandler);
router.post('/inventory/upload', authMiddleware, validate(adminValidation.importProductsBatch), importProductsBatchHandler);
router.post('/inventory/import', authMiddleware, upload.single('file'), importProductsFileHandler);

export default router;
