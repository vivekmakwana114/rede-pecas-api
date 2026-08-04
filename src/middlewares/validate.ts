import { Request, Response, NextFunction } from 'express';
import Joi, { Schema } from 'joi';
import { pick } from '../utils/pick.js';
import { ApiError } from '../utils/ApiError.js';

export interface ValidationSchema {
  params?: Schema;
  query?: Schema;
  body?: Schema;
}

/**
 * Converts a raw field name (camelCase or snake_case) into a human-readable
 * label, e.g. "newPassword" becomes "New password".
 */
function humanizeField(field: string): string {
  const spaced = field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Rewrites a raw Joi error message so its leading quoted field name is
 * humanized and whitespace is normalized.
 */
function humanizeMessage(raw: string): string {
  return raw
    .replace(/^"([^"]+)"/, (_match, field) => humanizeField(field))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds an Express middleware that validates a request's params/query/body
 * against the given Joi schema, applying the validated values back onto the
 * request or forwarding a humanized ApiError on failure.
 */
export const validate = (schema: ValidationSchema) => (req: Request, res: Response, next: NextFunction) => {
  const validSchema = pick(schema, ['params', 'query', 'body']);
  const object = pick(req, Object.keys(validSchema));
  const { value, error } = Joi.compile(validSchema)
    .prefs({ errors: { label: 'key' } })
    .validate(object);

  if (error) {
    const errorMessage = error.details.map((details) => humanizeMessage(details.message)).join(', ');
    return next(new ApiError(400, errorMessage));
  }
  Object.assign(req, value);
  return next();
};

export default validate;
