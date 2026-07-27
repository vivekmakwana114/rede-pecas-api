import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { logger } from '../config/logger.js';
import { formatPrice } from '../utils/helpers.js';
import { getMessages, DEFAULT_LOCALE } from '../i18n/messages.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Formats a Date as a DD/MM/YYYY string for display on generated PDFs.
 */
function formatDate(date: Date): string {
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Returns a new Date offset by the given number of days from the input date.
 */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export interface ProformaLineItem {
  description: string;
  reference: string;
  price: number;
  supplierNote?: string | null;
}

/**
 * Renders a locale-aware proforma invoice PDF for an order (one row per
 * line item, totals, and payment instructions) to a temp file and resolves
 * with its path once the write stream finishes. Takes the line items
 * directly — one product line (+ an optional following service line) for a
 * single-product order, or one line per available product/service for a
 * multi-item "basket" order — so this is the one PDF renderer for both.
 */
export async function generateProformaPDF(
  orderNumber: string,
  phone: string,
  lineItems: ProformaLineItem[],
  locale: 'pt' | 'en' = DEFAULT_LOCALE
): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const filePath = path.join(tempDir, `${orderNumber}.pdf`);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const pc = getMessages(locale).pdf.proforma;

    doc.fontSize(22).fillColor('#1A3A5C').font('Helvetica-Bold').text(pc.companyName, 50, 50);
    doc.fontSize(10).fillColor('#555555').font('Helvetica')
      .text(pc.tagline, 50, 78)
      .text(pc.phone, 50, 92)
      .text(pc.email, 50, 106);

    doc.fontSize(18).fillColor('#1A3A5C').font('Helvetica-Bold')
      .text(pc.title, 350, 50, { align: 'right' });
    doc.fontSize(10).fillColor('#555555').font('Helvetica')
      .text(pc.numberLabel(orderNumber), 350, 78, { align: 'right' })
      .text(pc.dateLabel(formatDate(new Date())), 350, 92, { align: 'right' })
      .text(pc.validityLabel(formatDate(addDays(new Date(), 2))), 350, 106, { align: 'right' });

    doc.moveTo(50, 145).lineTo(545, 145).strokeColor('#2E6DA4').lineWidth(2).stroke();

    doc.fontSize(11).fillColor('#1A3A5C').font('Helvetica-Bold').text(pc.clientHeader, 50, 160);
    doc.fontSize(10).fillColor('#333333').font('Helvetica')
      .text(pc.whatsappLabel(phone), 50, 178)
      .text(pc.clientDataNote, 50, 193);

    const tY = 240;
    const ROW_HEIGHT = 36;
    doc.rect(50, tY, 495, 28).fillColor('#1A3A5C').fill();
    doc.fontSize(10).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(pc.tableDescription, 60, tY + 9)
      .text(pc.tableReference, 280, tY + 9)
      .text(pc.tableQty, 380, tY + 9, { width: 40, align: 'center' })
      .text(pc.tableUnitPrice, 420, tY + 9, { width: 80, align: 'right' })
      .text(pc.tableTotal, 480, tY + 9, { width: 60, align: 'right' });

    lineItems.forEach((line, i) => {
      const iY = tY + 28 + i * ROW_HEIGHT;
      doc.rect(50, iY, 495, ROW_HEIGHT).fillColor('#F5F7FA').fill();
      doc.fontSize(10).fillColor('#333333').font('Helvetica')
        .text(line.description, 60, iY + 6, { width: 210 })
        .text(line.reference, 280, iY + 12)
        .text('1', 380, iY + 12, { width: 40, align: 'center' })
        .text(formatPrice(line.price), 420, iY + 12, { width: 80, align: 'right' })
        .text(formatPrice(line.price), 480, iY + 12, { width: 60, align: 'right' });
      if (line.supplierNote) {
        doc.fontSize(8).fillColor('#777777').text(line.supplierNote, 60, iY + 22);
      }
    });

    const tableBodyHeight = lineItems.length * ROW_HEIGHT;
    doc.rect(50, tY, 495, 28 + tableBodyHeight).strokeColor('#CCCCCC').lineWidth(0.5).stroke();

    const total = lineItems.reduce((sum, line) => sum + line.price, 0);

    const totalY = tY + 28 + tableBodyHeight + 36;
    doc.rect(350, totalY, 195, 28).fillColor('#1A3A5C').fill();
    doc.fontSize(12).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(pc.totalDue, 360, totalY + 8)
      .text(formatPrice(total), 480, totalY + 8, { width: 60, align: 'right' });

    const payY = totalY + 60;
    doc.fontSize(11).fillColor('#1A3A5C').font('Helvetica-Bold')
      .text(pc.paymentInstructionsHeader, 50, payY);
    doc.rect(50, payY + 18, 495, 80).fillColor('#EEF4FB').strokeColor('#2E6DA4').lineWidth(0.5).fillAndStroke();
    doc.fontSize(10).fillColor('#333333').font('Helvetica')
      .text(pc.bankLine, 60, payY + 28)
      .text(pc.multicaixaLine, 60, payY + 44)
      .text(pc.referenceLine(orderNumber), 60, payY + 60)
      .text(pc.afterPaymentLine, 60, payY + 76);

    doc.fontSize(9).fillColor('#777777').font('Helvetica')
      .text(pc.termsNote, 50, payY + 120, { width: 495 });

    doc.moveTo(50, 760).lineTo(545, 760).strokeColor('#2E6DA4').lineWidth(1).stroke();
    doc.fontSize(8).fillColor('#999999')
      .text(pc.footer, 50, 768, { align: 'center', width: 495 });

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Uploads a generated proforma PDF to the WhatsApp Cloud API and sends it
 * to the customer as a document message with a locale-aware caption.
 */
export async function sendProformaWhatsApp(
  phone: string,
  pdfPath: string,
  orderNumber: string,
  locale: 'pt' | 'en' = DEFAULT_LOCALE
): Promise<void> {
  const API_URL = `${config.whatsapp.graphApiUrl}/${config.whatsapp.phoneNumberId}`;
  const token = config.whatsapp.token;

  try {
    const fileBuffer = fs.readFileSync(pdfPath);
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', 'application/pdf');
    formData.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), `${orderNumber}.pdf`);

    const uploadRes = await fetch(`${API_URL}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!uploadRes.ok) {
      const uploadError = await uploadRes.json();
      logger.error('WhatsApp PDF Media Upload Failed', uploadError);
      throw new Error(`Media upload failed with status ${uploadRes.status}`);
    }

    const { id: mediaId } = await uploadRes.json() as any;

    await fetch(`${API_URL}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'document',
        document: {
          id: mediaId,
          filename: `Proforma_${orderNumber}.pdf`,
          caption: getMessages(locale).pdf.sendMessage.documentCaption(orderNumber),
        },
      }),
    });

    logger.info(`Proforma PDF sent successfully to ${phone}`);
  } catch (error: any) {
    logger.error(`Error sending proforma to ${phone}: ${error.message}`);
    throw error;
  }
}

/**
 * Uploads a generated final invoice PDF to the WhatsApp Cloud API and
 * sends the customer a locale-aware notification text followed by the invoice document.
 */
export async function sendFinalInvoiceWhatsApp(
  phone: string,
  pdfPath: string,
  orderNumber: string,
  customerName: string,
  locale: 'pt' | 'en' = DEFAULT_LOCALE
): Promise<void> {
  const API_URL = `${config.whatsapp.graphApiUrl}/${config.whatsapp.phoneNumberId}`;
  const token = config.whatsapp.token;

  try {
    const fileBuffer = fs.readFileSync(pdfPath);
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', 'application/pdf');
    formData.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), `Factura_${orderNumber}.pdf`);

    const uploadRes = await fetch(`${API_URL}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!uploadRes.ok) {
      throw new Error(`Media upload for final invoice failed: ${uploadRes.status}`);
    }

    const { id: mediaId } = await uploadRes.json() as any;

    await fetch(`${API_URL}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: {
          body: getMessages(locale).pdf.finalInvoice.notification(customerName),
        },
      }),
    });

    await fetch(`${API_URL}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'document',
        document: {
          id: mediaId,
          filename: `Factura_${orderNumber}.pdf`,
          caption: getMessages(locale).pdf.finalInvoice.documentCaption(orderNumber),
        },
      }),
    });

    logger.info(`Final invoice PDF sent successfully to ${phone}`);
  } catch (error: any) {
    logger.error(`Error sending final invoice to ${phone}: ${error.message}`);
    throw error;
  }
}

/**
 * Renders a locale-aware final invoice PDF for an approved order (one row
 * per line item, total paid) to a temp file and resolves with its path once
 * the write stream finishes. Takes the line items directly, same shape and
 * same reasoning as `generateProformaPDF` — one renderer for both a
 * single-product order and a multi-item "basket" order.
 */
export async function generateInvoicePDF(
  order: any,
  lineItems: ProformaLineItem[],
  locale: 'pt' | 'en' = DEFAULT_LOCALE
): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const filePath = path.join(tempDir, `FACTURA_${order.number}.pdf`);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const mc = getMessages(locale).pdf.invoice;

    doc.fontSize(22).fillColor('#2E7D32').font('Helvetica-Bold').text(mc.headerTitle, 50, 50);
    doc.fontSize(10).fillColor('#555555').font('Helvetica')
      .text(mc.tagline, 50, 78)
      .text(mc.nifLine, 50, 92);

    doc.fontSize(18).fillColor('#2E7D32').font('Helvetica-Bold')
      .text(mc.title, 350, 50, { align: 'right' });
    doc.fontSize(10).fillColor('#555555').font('Helvetica')
      .text(mc.numberLabel(`FA-${new Date().getFullYear()}/${order.number.split('-').pop()}`), 350, 78, { align: 'right' })
      .text(mc.dateLabel(formatDate(new Date())), 350, 92, { align: 'right' });

    doc.moveTo(50, 145).lineTo(545, 145).strokeColor('#2E7D32').lineWidth(2).stroke();

    doc.fontSize(11).fillColor('#2E7D32').font('Helvetica-Bold').text(mc.clientHeader, 50, 160);
    doc.fontSize(10).fillColor('#333333').font('Helvetica')
      .text(mc.nameLine, 50, 178)
      .text(mc.whatsappLabel(order.customer_phone), 50, 193);

    const tY = 240;
    doc.rect(50, tY, 495, 28).fillColor('#2E7D32').fill();
    doc.fontSize(10).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(mc.tableDescription, 60, tY + 9)
      .text(mc.tableReference, 280, tY + 9)
      .text(mc.tableQty, 380, tY + 9, { width: 40, align: 'center' })
      .text(mc.tableUnitPrice, 420, tY + 9, { width: 80, align: 'right' })
      .text(mc.tableTotal, 480, tY + 9, { width: 60, align: 'right' });

    const ROW_HEIGHT = 36;

    lineItems.forEach((line, i) => {
      const iY = tY + 28 + i * ROW_HEIGHT;
      doc.rect(50, iY, 495, ROW_HEIGHT).fillColor('#F1F8E9').fill();
      doc.fontSize(10).fillColor('#333333').font('Helvetica')
        .text(line.description, 60, iY + 6, { width: 210 })
        .text(line.reference, 280, iY + 12)
        .text('1', 380, iY + 12, { width: 40, align: 'center' })
        .text(formatPrice(line.price), 420, iY + 12, { width: 80, align: 'right' })
        .text(formatPrice(line.price), 480, iY + 12, { width: 60, align: 'right' });
    });

    const total = lineItems.reduce((sum, line) => sum + line.price, 0);

    const totalY = tY + 28 + lineItems.length * ROW_HEIGHT + 36;
    doc.rect(350, totalY, 195, 28).fillColor('#2E7D32').fill();
    doc.fontSize(12).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(mc.totalPaid, 360, totalY + 8)
      .text(formatPrice(total), 480, totalY + 8, { width: 60, align: 'right' });

    doc.fontSize(8).fillColor('#555555').font('Helvetica-Oblique')
      .text(mc.agtStamp, 50, totalY + 120);

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', (err) => reject(err));
  });
}
