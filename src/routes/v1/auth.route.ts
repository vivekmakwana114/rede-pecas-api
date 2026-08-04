import express from 'express';
import {
  login,
  refresh,
  logout,
  getProfile,
  changeProfile,
  changePassword,
  forgotPassword,
  resetPassword,
} from '../../controllers/auth.controller.js';
import { authMiddleware } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { authValidation } from '../../validations/index.js';

const router = express.Router();

router.post('/login', validate(authValidation.login), login);
router.post('/refresh', validate(authValidation.refresh), refresh);
router.post('/forgot/password', validate(authValidation.forgotPassword), forgotPassword);
router.post('/reset/password', validate(authValidation.resetPassword), resetPassword);

router.post('/logout', authMiddleware, validate(authValidation.logout), logout);
router.get('/profile', authMiddleware, getProfile);
router.patch('/profile', authMiddleware, validate(authValidation.changeProfile), changeProfile);
router.post('/change/password', authMiddleware, validate(authValidation.changePassword), changePassword);

export default router;
