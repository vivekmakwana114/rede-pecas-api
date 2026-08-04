import Joi from 'joi';
import { ValidationSchema } from '../middlewares/validate.js';

export const serviceIdParams: ValidationSchema = {
  params: Joi.object().keys({
    id: Joi.number().integer().required(),
  }),
};

export const serviceUpdate: ValidationSchema = {
  params: Joi.object().keys({
    id: Joi.number().integer().required(),
  }),
  body: Joi.object()
    .keys({
      service_name: Joi.string(),
      // Free text — no allow-list against a fixed set of values.
      service_category: Joi.string(),
      service_base_price: Joi.number().min(0),
      service_duration_h: Joi.number().min(0),
      available_at_home: Joi.boolean(),
      base_travel_fee: Joi.number().min(0).allow(null),
      logistics_fee_notes: Joi.string().allow('', null),
      active: Joi.boolean(),
      providerName: Joi.string(),
      providerAddress: Joi.string().allow('', null),
      providerProvince: Joi.string().allow('', null),
      providerPhone: Joi.string().allow('', null),
    })
    .min(1),
};

const importServiceItemSchema = Joi.object({
  providerId: Joi.number().integer(),
  providerName: Joi.string(),
  providerAddress: Joi.string().allow(''),
  providerProvince: Joi.string().allow(''),
  providerPhone: Joi.string().allow(''),
  specialties: Joi.string().allow(''),
  rating: Joi.number().min(0).max(5),
  responseTime: Joi.string().allow(''),
  serviceName: Joi.string().required(),
  serviceCategory: Joi.string().required(),
  serviceBasePrice: Joi.number().min(0).required(),
  serviceDurationH: Joi.number().min(0).required(),
  availableAtHome: Joi.boolean(),
  baseTravelFee: Joi.number().min(0),
  logisticsFeeNotes: Joi.string().allow(''),
});

export const importServicesBatch: ValidationSchema = {
  body: Joi.object().keys({
    providerId: Joi.number().integer(),
    items: Joi.array().items(importServiceItemSchema).required(),
  }),
};
