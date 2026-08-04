import Joi from 'joi';
import { ValidationSchema } from '../middlewares/validate.js';

export const login: ValidationSchema = {
  body: Joi.object().keys({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),
};

export const changeProfile: ValidationSchema = {
  body: Joi.object().keys({
    name: Joi.string(),
    email: Joi.string().email(),
  }).or('name', 'email'),
};

export const changePassword: ValidationSchema = {
  body: Joi.object().keys({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(8).required(),
  }),
};

export const forgotPassword: ValidationSchema = {
  body: Joi.object().keys({
    phone: Joi.string().required(),
  }),
};

export const resetPassword: ValidationSchema = {
  body: Joi.object().keys({
    phone: Joi.string().required(),
    code: Joi.string().length(6).required(),
    newPassword: Joi.string().min(8).required(),
  }),
};

export const refresh: ValidationSchema = {
  body: Joi.object().keys({
    refreshToken: Joi.string().required(),
  }),
};

export const logout: ValidationSchema = {
  body: Joi.object().keys({
    refreshToken: Joi.string(),
  }),
};
