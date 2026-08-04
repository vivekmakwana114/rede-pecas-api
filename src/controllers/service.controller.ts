import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { ApiError } from '../utils/ApiError.js';
import * as serviceService from '../services/service.service.js';
import {
  getAllServices,
  getServiceById,
  updateService,
  hardDeleteService,
  importServicesBatch,
  resolveServiceProviderForEdit,
  Service,
} from '../models/service.model.js';

/**
 * Backs the admin service-list endpoint — returns every service row with its
 * provider details joined in, newest-updated first.
 */
export const getServicesHandler = catchAsync(async (req: Request, res: Response) => {
  const services = await getAllServices();

  res.status(200).json({
    success: true,
    message: 'Services retrieved.',
    code: 200,
    data: services,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin single-service endpoint — looks up one service by id,
 * 404ing if it doesn't exist.
 */
export const getServiceHandler = catchAsync(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const service = await getServiceById(id);
  if (!service) throw new ApiError(404, `Service ${id} not found`);

  res.status(200).json({
    success: true,
    message: 'Service retrieved.',
    code: 200,
    data: service,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin service-update endpoint — applies whichever service fields
 * were supplied to the `services` row, resolving/creating a new provider row via
 * `resolveServiceProviderForEdit` when the provider details changed, then returns the refreshed service.
 */
export const updateServiceHandler = catchAsync(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = await getServiceById(id);
  if (!existing) throw new ApiError(404, `Service ${id} not found`);

  const {
    service_name,
    service_category,
    service_base_price,
    service_duration_h,
    available_at_home,
    base_travel_fee,
    logistics_fee_notes,
    active,
    providerName,
    providerAddress,
    providerProvince,
    providerPhone,
  } = req.body;
  const fields: Partial<Service> = {};
  if (service_name !== undefined) fields.service_name = service_name;
  if (service_category !== undefined) fields.service_category = service_category;
  if (service_base_price !== undefined) fields.service_base_price = service_base_price;
  if (service_duration_h !== undefined) fields.service_duration_h = service_duration_h;
  if (available_at_home !== undefined) fields.available_at_home = available_at_home;
  if (base_travel_fee !== undefined) fields.base_travel_fee = base_travel_fee;
  if (logistics_fee_notes !== undefined) fields.logistics_fee_notes = logistics_fee_notes;
  if (active !== undefined) fields.active = active;

  if (
    existing.provider_id &&
    (providerName !== undefined || providerAddress !== undefined || providerProvince !== undefined || providerPhone !== undefined)
  ) {
    const targetName = providerName !== undefined ? providerName : existing.provider_name;
    const targetProvince = providerProvince !== undefined ? providerProvince : existing.provider_province ?? null;
    const targetPhone = providerPhone !== undefined ? providerPhone : existing.provider_phone ?? null;

    if (targetName) {
      fields.provider_id = await resolveServiceProviderForEdit(
        targetName,
        providerAddress ?? null,
        targetProvince,
        targetPhone,
        existing.provider_id
      );
    }
  }

  await updateService(id, fields);
  const updated = await getServiceById(id);

  res.status(200).json({
    success: true,
    message: `Service ${id} updated.`,
    code: 200,
    data: updated,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin service-delete endpoint — hard-deletes a `services` row,
 * refusing (409) if it's still active, and 404ing if it doesn't exist.
 */
export const deleteServiceHandler = catchAsync(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const result = await hardDeleteService(id);

  if (result === 'not_found') throw new ApiError(404, `Service ${id} not found`);
  if (result === 'still_active') {
    throw new ApiError(409, `Service ${id} is still active — deactivate it first before deleting.`);
  }

  res.status(200).json({
    success: true,
    message: `Service ${id} deleted.`,
    code: 200,
    data: null,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin services-batch-import endpoint — upserts a JSON array of
 * service items into `services` (and `service_providers` as needed) via `importServicesBatch`.
 */
export const importServicesBatchHandler = catchAsync(async (req: Request, res: Response) => {
  const { providerId, items } = req.body;

  if (!Array.isArray(items)) {
    throw new ApiError(400, 'Invalid parameters. items is required.');
  }

  const result = await importServicesBatch(items, providerId ? Number(providerId) : null);

  res.status(200).json({
    success: true,
    message: 'Services imported.',
    code: 200,
    data: result,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin services-file-import endpoint — parses an uploaded services
 * spreadsheet file and imports its rows, requiring the `file` field to be present.
 */
export const importServicesFileHandler = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new ApiError(400, 'File is required (field name: file).');
  }

  const result = await serviceService.importServicesFromFile(req.file.buffer);

  res.status(200).json({
    success: true,
    message: 'Services file imported.',
    code: 200,
    data: result,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `GET /v1/admin/services/template` — generates and streams the blank
 * services-import spreadsheet template (.xlsx) for staff to fill in.
 */
export const downloadServicesTemplateHandler = catchAsync(async (req: Request, res: Response) => {
  const file = serviceService.generateServicesTemplateFile();

  res.status(200);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="services-template.xlsx"');
  res.send(file);
});
