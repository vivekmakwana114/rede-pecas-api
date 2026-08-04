import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { ApiError } from '../utils/ApiError.js';
import { formatDateTime } from '../utils/helpers.js';
import {
  getAllCustomers,
  getActiveCustomerByPhone,
  updateCustomer,
  deactivateCustomer,
  Customer,
  CustomerWithStats,
} from '../models/customer.model.js';

/**
 * Formats a customer record's timestamp fields for API output, leaving the rest
 * of the fields (including its embedded order stats and vehicle list) untouched.
 */
function serializeCustomer(customer: CustomerWithStats) {
  return {
    ...customer,
    first_contact_at: formatDateTime(customer.first_contact_at),
    last_contact_at: formatDateTime(customer.last_contact_at),
    registered_at: formatDateTime(customer.registered_at),
  };
}

/**
 * Backs the admin customer list endpoint — returns a paginated, optionally
 * name/phone/NIF-filtered page of active customers from `customers`, each with order stats and vehicles attached.
 */
export const getCustomersHandler = catchAsync(async (req: Request, res: Response) => {
  const page = req.query.page ? Number(req.query.page) : 1;
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const q = req.query.q ? String(req.query.q) : undefined;

  const { customers, total } = await getAllCustomers({ page, limit, q });

  res.status(200).json({
    success: true,
    message: 'Customers retrieved.',
    code: 200,
    data: { customers: customers.map(serializeCustomer), total, page, limit },
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin single-customer endpoint — looks up one active customer by
 * phone and returns it, or 404s if no such active customer exists.
 */
export const getCustomerHandler = catchAsync(async (req: Request, res: Response) => {
  const { phone } = req.params;
  const customer = await getActiveCustomerByPhone(phone);
  if (!customer) throw new ApiError(404, `Customer ${phone} not found`);

  res.status(200).json({
    success: true,
    message: 'Customer retrieved.',
    code: 200,
    data: serializeCustomer(customer),
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin customer-update endpoint — applies whichever of name/nif/address/email
 * were supplied to the `customers` row for that phone, then returns the refreshed record.
 */
export const updateCustomerHandler = catchAsync(async (req: Request, res: Response) => {
  const { phone } = req.params;
  const existing = await getActiveCustomerByPhone(phone);
  if (!existing) throw new ApiError(404, `Customer ${phone} not found`);

  const { name, nif, address, email } = req.body;
  const fields: Partial<Customer> = {};
  if (name !== undefined) fields.name = name;
  if (nif !== undefined) fields.nif = nif;
  if (address !== undefined) fields.address = address;
  if (email !== undefined) fields.email = email;

  await updateCustomer(phone, fields);
  const updated = await getActiveCustomerByPhone(phone);

  res.status(200).json({
    success: true,
    message: `Customer ${phone} updated.`,
    code: 200,
    data: updated ? serializeCustomer(updated) : null,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin customer-delete endpoint — soft-deletes a customer by flipping
 * `customers.active` to false for that phone, 404ing if it was already inactive or missing.
 */
export const deleteCustomerHandler = catchAsync(async (req: Request, res: Response) => {
  const { phone } = req.params;
  const deleted = await deactivateCustomer(phone);
  if (!deleted) throw new ApiError(404, `Customer ${phone} not found`);

  res.status(200).json({
    success: true,
    message: `Customer ${phone} deleted.`,
    code: 200,
    data: null,
    meta: { timestamp: new Date().toISOString() },
  });
});
