import Joi from 'joi';
import { ValidationSchema } from '../middlewares/validate.js';

export const orderListQuery: ValidationSchema = {
  query: Joi.object().keys({
    range: Joi.string().valid('today', 'all').default('all'),
  }),
};

export const orderReview: ValidationSchema = {
  params: Joi.object().keys({
    number: Joi.string().required(),
  }),
  body: Joi.object().keys({
    approved: Joi.boolean().required(),
  }),
};

export const orderStockConfirmation: ValidationSchema = {
  params: Joi.object().keys({
    number: Joi.string().required(),
  }),
  // Legacy single-product orders send { available }; multi-item "basket"
  // orders send { items: [{ itemId, available }] } instead — exactly one of
  // the two shapes is required per request.
  body: Joi.object().keys({
    available: Joi.boolean(),
    items: Joi.array().items(
      Joi.object().keys({
        itemId: Joi.number().integer().required(),
        available: Joi.boolean().required(),
      })
    ),
  }).xor('available', 'items'),
};

export const orderAnalyticsQuery: ValidationSchema = {
  query: Joi.object().keys({
    period: Joi.string().valid('daily', 'monthly', 'yearly').required(),
  }),
};

export const orderNumberParams: ValidationSchema = {
  params: Joi.object().keys({
    number: Joi.string().required(),
  }),
};

export const alertParams: ValidationSchema = {
  params: Joi.object().keys({
    id: Joi.number().integer().required(),
  }),
};

export const customerListQuery: ValidationSchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(200),
    q: Joi.string().allow(''),
  }),
};

export const customerPhoneParams: ValidationSchema = {
  params: Joi.object().keys({
    phone: Joi.string().required(),
  }),
};

export const customerUpdate: ValidationSchema = {
  params: Joi.object().keys({
    phone: Joi.string().required(),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      nif: Joi.string().allow('', null),
      address: Joi.string().allow('', null),
      email: Joi.string().email().allow('', null),
    })
    .min(1),
};

export const productIdParams: ValidationSchema = {
  params: Joi.object().keys({
    id: Joi.number().integer().required(),
  }),
};

export const productUpdate: ValidationSchema = {
  params: Joi.object().keys({
    id: Joi.number().integer().required(),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      reference: Joi.string(),
      price: Joi.number(),
      quantity: Joi.number().integer().min(0),
      active: Joi.boolean(),
      category: Joi.string(),
      // Free text — no allow-list against a fixed set of values.
      subcategory: Joi.string(),
      product_type: Joi.string().allow('', null),
      vehicle_make: Joi.string(),
      vehicle_model: Joi.string().allow('', null),
      year_start: Joi.number().integer().allow(null),
      year_end: Joi.number().integer().allow(null),
      engine: Joi.string().allow('', null),
      delivery_time: Joi.string(),
      oem_reference: Joi.string().allow('', null),
      brand: Joi.string().allow('', null),
      engine_number: Joi.string().allow('', null),
      viscosity: Joi.string().allow('', null),
      engine_type: Joi.string().allow('', null),
      volume_liters: Joi.number().allow(null),
      specification: Joi.string().allow('', null),
      interval_km: Joi.number().integer().allow(null),
      image_url: Joi.string().allow('', null),
      synonyms: Joi.string(),
      description: Joi.string(),
      supplierName: Joi.string(),
      supplierAddress: Joi.string().allow('', null),
      supplierPhone: Joi.string().allow('', null),
    })
    .min(1),
};

const importItemSchema = Joi.object({
  reference: Joi.string().required(),
  name: Joi.string().required(),
  price: Joi.number().min(0).required(),
  quantity: Joi.number().integer().min(0).required(),
  supplierId: Joi.number().integer(),
  supplierName: Joi.string(),
  supplierAddress: Joi.string().allow(''),
  supplierPhone: Joi.string().allow(''),
  category: Joi.string().required(),
  subcategory: Joi.string().required(),
  productType: Joi.string().allow(''),
  vehicleMake: Joi.string().required(),
  vehicleModel: Joi.string().allow(''),
  yearStart: Joi.number().integer(),
  yearEnd: Joi.number().integer(),
  engine: Joi.string().allow(''),
  deliveryTime: Joi.string().required(),
  brand: Joi.string().allow(''),
  oemReference: Joi.string().allow(''),
  engineNumber: Joi.string().allow(''),
  viscosity: Joi.string().allow(''),
  engineType: Joi.string().allow(''),
  volumeLiters: Joi.number(),
  specification: Joi.string().allow(''),
  intervalKm: Joi.number().integer(),
  imageUrl: Joi.string().allow(''),
  synonyms: Joi.string().required(),
  description: Joi.string().required(),
});

export const importProductsBatch: ValidationSchema = {
  body: Joi.object().keys({
    supplierId: Joi.number().integer(),
    items: Joi.array().items(importItemSchema).required(),
  }),
};

