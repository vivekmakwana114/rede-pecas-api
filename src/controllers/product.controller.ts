import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { ApiError } from '../utils/ApiError.js';
import * as productService from '../services/product.service.js';
import { getAllProducts, getProductByIdAnyStatus, updateProduct, hardDeleteProduct, Product } from '../models/product.model.js';
import { resolveSupplierForProductEdit } from '../models/supplier.model.js';

/**
 * Backs the admin product-list endpoint — returns every product row (any
 * active/inactive status), newest-updated first, with supplier details joined in.
 */
export const getProductsHandler = catchAsync(async (req: Request, res: Response) => {
  const products = await getAllProducts();

  res.status(200).json({
    success: true,
    message: 'Products retrieved.',
    code: 200,
    data: products,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin single-product endpoint — looks up one product by id
 * regardless of active status, 404ing if it doesn't exist.
 */
export const getProductHandler = catchAsync(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const product = await getProductByIdAnyStatus(id);
  if (!product) throw new ApiError(404, `Product ${id} not found`);

  res.status(200).json({
    success: true,
    message: 'Product retrieved.',
    code: 200,
    data: product,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin product-update endpoint — applies whichever product fields
 * were supplied to the `products` row, resolving/creating a new supplier row via
 * `resolveSupplierForProductEdit` when the supplier name/address/phone changed, then returns the refreshed product.
 */
export const updateProductHandler = catchAsync(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = await getProductByIdAnyStatus(id);
  if (!existing) throw new ApiError(404, `Product ${id} not found`);

  const {
    name,
    reference,
    price,
    quantity,
    active,
    category,
    subcategory,
    product_type,
    vehicle_make,
    vehicle_model,
    year_start,
    year_end,
    engine,
    delivery_time,
    oem_reference,
    brand,
    engine_number,
    viscosity,
    engine_type,
    volume_liters,
    specification,
    interval_km,
    image_url,
    synonyms,
    description,
    supplierName,
    supplierAddress,
    supplierPhone,
  } = req.body;
  const fields: Partial<Product> = {};
  if (name !== undefined) fields.name = name;
  if (reference !== undefined) fields.reference = reference;
  if (price !== undefined) fields.price = price;
  if (quantity !== undefined) fields.quantity = quantity;
  if (active !== undefined) fields.active = active;
  if (category !== undefined) fields.category = category;
  if (subcategory !== undefined) {
    // service_category tracks subcategory directly (see db/schema.sql's
    // products table comment) — no more subcategory→bucket mapping.
    fields.subcategory = subcategory;
    fields.service_category = subcategory;
  }
  if (product_type !== undefined) fields.product_type = product_type || null;
  if (vehicle_make !== undefined) fields.vehicle_make = vehicle_make;
  if (vehicle_model !== undefined) fields.vehicle_model = vehicle_model;
  if (year_start !== undefined) fields.year_start = year_start;
  if (year_end !== undefined) fields.year_end = year_end;
  if (engine !== undefined) fields.engine = engine;
  if (delivery_time !== undefined) fields.delivery_time = delivery_time;
  if (oem_reference !== undefined) fields.oem_reference = oem_reference;
  if (brand !== undefined) fields.brand = brand;
  if (engine_number !== undefined) fields.engine_number = engine_number;
  if (viscosity !== undefined) fields.viscosity = viscosity;
  if (engine_type !== undefined) fields.engine_type = engine_type;
  if (volume_liters !== undefined) fields.volume_liters = volume_liters;
  if (specification !== undefined) fields.specification = specification;
  if (interval_km !== undefined) fields.interval_km = interval_km;
  if (image_url !== undefined) fields.image_url = image_url;
  if (synonyms !== undefined) fields.synonyms = synonyms;
  if (description !== undefined) fields.description = description;

  if (existing.supplier_id && (supplierName !== undefined || supplierAddress !== undefined || supplierPhone !== undefined)) {
    const targetName = supplierName !== undefined ? supplierName : existing.supplier;
    const targetAddress = supplierAddress !== undefined ? supplierAddress : existing.supplier_address ?? null;
    const targetPhone = supplierPhone !== undefined ? supplierPhone : existing.supplier_phone ?? null;

    const supplierChanged =
      targetName !== existing.supplier ||
      (targetAddress || null) !== (existing.supplier_address || null) ||
      (targetPhone || null) !== (existing.supplier_phone || null);

    if (supplierChanged && targetName) {
      fields.supplier_id = await resolveSupplierForProductEdit(targetName, targetAddress, targetPhone, existing.supplier_id);
    }
  }

  await updateProduct(id, fields);
  const updated = await getProductByIdAnyStatus(id);

  res.status(200).json({
    success: true,
    message: `Product ${id} updated.`,
    code: 200,
    data: updated,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin product-delete endpoint — hard-deletes a `products` row,
 * refusing (409) if it's still active or still referenced by orders/waitlist requests, and 404ing if it doesn't exist.
 */
export const deleteProductHandler = catchAsync(async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  let result;
  try {
    result = await hardDeleteProduct(id);
  } catch (error: any) {
    if (error?.code === '23503') {
      throw new ApiError(409, `Product ${id} can't be deleted — it's still referenced by existing orders or waitlist requests.`);
    }
    throw error;
  }

  if (result === 'not_found') throw new ApiError(404, `Product ${id} not found`);
  if (result === 'still_active') {
    throw new ApiError(409, `Product ${id} is still active — deactivate it first before deleting.`);
  }

  res.status(200).json({
    success: true,
    message: `Product ${id} deleted.`,
    code: 200,
    data: null,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `POST /v1/admin/inventory/upload` — derives each item's service
 * category from its subcategory (they share the same vocabulary now), then
 * upserts the batch (JSON body of items) into `products` via `importInventoryBatch`.
 */
export const importProductsBatchHandler = catchAsync(async (req: Request, res: Response) => {
  const { supplierId, items } = req.body;

  if (!Array.isArray(items)) {
    throw new ApiError(400, 'Invalid parameters. items is required.');
  }

  const itemsWithServiceCategory = items.map((item: any) => ({ ...item, serviceCategory: item.subcategory }));

  const result = await productService.importInventoryBatch(itemsWithServiceCategory, supplierId ? Number(supplierId) : null);

  res.status(200).json({
    success: true,
    message: 'Products imported.',
    code: 200,
    data: result,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `POST /v1/admin/inventory/import` — parses an uploaded inventory
 * spreadsheet file and imports its rows into `products`, requiring the `file` field to be present.
 */
export const importProductsFileHandler = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new ApiError(400, 'File is required (field name: file).');
  }

  const result = await productService.importInventoryFromFile(req.file.buffer);

  res.status(200).json({
    success: true,
    message: 'Inventory file imported.',
    code: 200,
    data: result,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `GET /v1/admin/inventory/template` — generates and streams the blank
 * inventory-import spreadsheet template (.xlsx) for staff to fill in.
 */
export const downloadInventoryTemplateHandler = catchAsync(async (req: Request, res: Response) => {
  const file = productService.generateInventoryTemplateFile();

  res.status(200);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory-template.xlsx"');
  res.send(file);
});
