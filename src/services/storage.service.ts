import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../config/db.js';
import { logger } from '../config/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_ROOT = path.join(__dirname, '../../storage');

export type DocumentKind = 'vehicle_photo' | 'payment_proof' | 'proforma_pdf' | 'invoice_pdf';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

function resolveExtension(mimeType?: string | null): string {
  return (mimeType && EXTENSION_BY_MIME[mimeType]) || 'bin';
}

/**
 * Writes a buffer to durable local storage under storage/<phone>/ and
 * records where, in `customer_documents` — so the app never has to re-fetch
 * a customer's file from Meta's Graph API (whose media URLs/ids expire
 * after ~30 days) or re-render a PDF that's already been generated. Covers
 * three kinds of file: inbound vehicle-ID photos and payment proofs (never
 * persisted anywhere before this), and generated proforma/invoice PDFs
 * (previously only ever written to a scratch `temp/` dir).
 */
export async function saveDocument(
  phone: string,
  kind: DocumentKind,
  buffer: Buffer,
  mimeType?: string | null,
  orderNumber?: string | null,
  mediaId?: string | null
): Promise<string> {
  const dir = path.join(STORAGE_ROOT, phone);
  fs.mkdirSync(dir, { recursive: true });

  const fileName = `${kind}-${Date.now()}.${resolveExtension(mimeType)}`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, buffer);

  await db.query(
    `INSERT INTO customer_documents (phone, kind, order_number, media_id, file_path, mime_type)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [phone, kind, orderNumber ?? null, mediaId ?? null, filePath, mimeType ?? null]
  );

  logger.debug(`[STORAGE] Saved ${kind} for ${phone} -> ${filePath}`);
  return filePath;
}

/**
 * Returns the most recently stored document of a given kind for a phone
 * (optionally scoped to the specific inbound media id it came from), read
 * straight off local disk — or null if nothing's been saved yet, in which
 * case the caller should fall back to `downloadWhatsAppMedia` + `saveDocument`.
 */
export async function getDocument(phone: string, kind: DocumentKind, mediaId?: string | null): Promise<Buffer | null> {
  const { rows } = await db.query(
    mediaId
      ? `SELECT file_path FROM customer_documents WHERE phone = $1 AND kind = $2 AND media_id = $3 ORDER BY created_at DESC LIMIT 1`
      : `SELECT file_path FROM customer_documents WHERE phone = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1`,
    mediaId ? [phone, kind, mediaId] : [phone, kind]
  );
  if (!rows.length) return null;

  try {
    return fs.readFileSync(rows[0].file_path);
  } catch (error: any) {
    logger.error(`[STORAGE] Error reading stored document ${rows[0].file_path}`, error);
    return null;
  }
}
