import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { logger } from '../config/logger.js';
import { formatPrice } from '../utils/helpers.js';
import { getMessages, DEFAULT_LOCALE } from '../i18n/messages.js';
import { sendWhatsAppMessage } from './whatsapp.service.js';
import { sendReplyButtons } from './reply.service.js';
import { db } from '../config/db.js';

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

/**
 * Tracks a generated PDF's durable on-disk location in `customer_documents`
 * (see storage.service.ts) so it never needs to be re-rendered or
 * re-fetched from Meta once already generated.
 */
async function recordGeneratedDocument(
  phone: string,
  kind: 'proforma_pdf' | 'invoice_pdf',
  filePath: string,
  orderNumber: string
): Promise<void> {
  await db.query(
    `INSERT INTO customer_documents (phone, kind, order_number, file_path, mime_type) VALUES ($1, $2, $3, $4, 'application/pdf')`,
    [phone, kind, orderNumber, filePath]
  );
}

export interface ProformaLineItem {
  description: string;
  reference: string;
  price: number;
  supplierNote?: string | null;
  // True for an attached installation-style service line (see
  // orders.service_name/items[].serviceName) — rendered in a distinct
  // "Services" section below the products table, not interleaved with them.
  isService?: boolean;
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
    const customerDir = path.join(__dirname, '../../storage', phone);
    if (!fs.existsSync(customerDir)) {
      fs.mkdirSync(customerDir, { recursive: true });
    }
    const filePath = path.join(customerDir, `proforma-${orderNumber}.pdf`);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const pc = getMessages(locale).pdf.proforma;

    doc.fontSize(20).fillColor('#1A3A5C').font('Helvetica-Bold').text(pc.companyName, 50, 50);
    doc.fontSize(10).fillColor('#555555').font('Helvetica')
      .text(pc.tagline, 50, 76)
      .text(pc.phone, 50, 90)
      .text(pc.email, 50, 104);

    doc.fontSize(16).fillColor('#1A3A5C').font('Helvetica-Bold')
      .text(pc.title, 300, 50, { align: 'right', width: 245 });
    doc.fontSize(10).fillColor('#555555').font('Helvetica')
      .text(pc.numberLabel(orderNumber), 300, 74, { align: 'right', width: 245 })
      .text(pc.dateLabel(formatDate(new Date())), 300, 88, { align: 'right', width: 245 })
      .text(pc.validityLabel(formatDate(addDays(new Date(), 2))), 300, 102, { align: 'right', width: 245 });

    doc.moveTo(50, 145).lineTo(545, 145).strokeColor('#2E6DA4').lineWidth(2).stroke();

    doc.fontSize(11).fillColor('#1A3A5C').font('Helvetica-Bold').text(pc.clientHeader, 50, 160);
    doc.fontSize(10).fillColor('#333333').font('Helvetica')
      .text(pc.whatsappLabel(phone), 50, 178)
      .text(pc.clientDataNote, 50, 193);

    const products = lineItems.filter((line) => !line.isService);
    const services = lineItems.filter((line) => line.isService);

    const tY = 240;
    const ROW_HEIGHT = 36;
    doc.rect(50, tY, 495, 28).fillColor('#1A3A5C').fill();
    doc.fontSize(10).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(pc.tableDescription, 60, tY + 9)
      .text(pc.tableReference, 265, tY + 9)
      .text(pc.tableQty, 360, tY + 9, { width: 30, align: 'center' })
      .text(pc.tableUnitPrice, 395, tY + 9, { width: 75, align: 'right' })
      .text(pc.tableTotal, 475, tY + 9, { width: 65, align: 'right' });

    products.forEach((line, i) => {
      const iY = tY + 28 + i * ROW_HEIGHT;
      doc.rect(50, iY, 495, ROW_HEIGHT).fillColor('#F5F7FA').fill();
      doc.fontSize(10).fillColor('#333333').font('Helvetica')
        .text(line.description, 60, iY + 6, { width: 195 })
        .text(line.reference, 265, iY + 12)
        .text('1', 380, iY + 12, { width: 30, align: 'center' })
        .text(formatPrice(line.price), 395, iY + 12, { width: 75, align: 'right' })
        .text(formatPrice(line.price), 475, iY + 12, { width: 65, align: 'right' });
      if (line.supplierNote) {
        doc.fontSize(8).fillColor('#777777').text(line.supplierNote, 60, iY + 22);
      }
    });

    const tableBodyHeight = products.length * ROW_HEIGHT;
    doc.rect(50, tY, 495, 28 + tableBodyHeight).strokeColor('#CCCCCC').lineWidth(0.5).stroke();

    let contentEndY = tY + 28 + tableBodyHeight;

    if (services.length > 0) {
      const SERVICE_ROW_HEIGHT = 28;
      const svcHeaderLabelY = contentEndY + 20;
      doc.fontSize(11).fillColor('#1A3A5C').font('Helvetica-Bold').text(pc.servicesHeader(), 50, svcHeaderLabelY);

      const svcHeaderY = svcHeaderLabelY + 18;
      doc.rect(50, svcHeaderY, 495, 24).fillColor('#2E6DA4').fill();
      doc.fontSize(10).fillColor('#FFFFFF').font('Helvetica-Bold')
        .text(pc.tableDescription, 60, svcHeaderY + 7)
        .text(pc.tableTotal, 475, svcHeaderY + 7, { width: 65, align: 'right' });

      services.forEach((line, i) => {
        const iY = svcHeaderY + 24 + i * SERVICE_ROW_HEIGHT;
        doc.rect(50, iY, 495, SERVICE_ROW_HEIGHT).fillColor('#EAF1F8').fill();
        doc.fontSize(10).fillColor('#333333').font('Helvetica')
          .text(line.description, 60, iY + 8, { width: 400 })
          .text(formatPrice(line.price), 475, iY + 8, { width: 65, align: 'right' });
      });

      const svcBodyHeight = services.length * SERVICE_ROW_HEIGHT;
      doc.rect(50, svcHeaderY, 495, 24 + svcBodyHeight).strokeColor('#CCCCCC').lineWidth(0.5).stroke();

      const servicesTotal = services.reduce((sum, line) => sum + (Number(line.price) || 0), 0);
      const svcTotalY = svcHeaderY + 24 + svcBodyHeight + 6;
      doc.fontSize(9).fillColor('#1A3A5C').font('Helvetica-Bold')
        .text(`${pc.servicesTotal()}: ${formatPrice(servicesTotal)}`, 50, svcTotalY, { width: 495, align: 'right' });

      contentEndY = svcTotalY + 14;
    }

    const total = lineItems.reduce((sum, line) => sum + (Number(line.price) || 0), 0);

    const totalY = contentEndY + 36;
    doc.rect(350, totalY, 195, 28).fillColor('#1A3A5C').fill();
    doc.fontSize(12).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(pc.totalDue, 360, totalY + 8)
      .text(formatPrice(total), 455, totalY + 8, { width: 85, align: 'right' });

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
    stream.on('finish', async () => {
      try {
        await recordGeneratedDocument(phone, 'proforma_pdf', filePath, orderNumber);
      } catch (err) {
        logger.error(`Error recording generated proforma PDF for order ${orderNumber}`, err);
      }
      resolve(filePath);
    });
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

    const mc = getMessages(locale).pdf.finalInvoice;
    await sendWhatsAppMessage(phone, mc.notification(customerName));

    // The invoice document and the Order Status button ride in the same
    // interactive message — sendReplyButtons (not a raw whatsapp.service.ts
    // call) so the button inherits the standard active-prompt dedupe.
    await sendReplyButtons(
      phone,
      mc.documentCaption(orderNumber),
      [mc.orderStatusButtonLabel()],
      [`order_status_${orderNumber}`],
      { type: 'document', id: mediaId, filename: `Factura_${orderNumber}.pdf` }
    );

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
    const customerDir = path.join(__dirname, '../../storage', order.customer_phone);
    if (!fs.existsSync(customerDir)) {
      fs.mkdirSync(customerDir, { recursive: true });
    }
    const filePath = path.join(customerDir, `invoice-${order.number}.pdf`);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const mc = getMessages(locale).pdf.invoice;

    doc.fontSize(20).fillColor('#2E7D32').font('Helvetica-Bold').text(mc.headerTitle, 50, 50);
    doc.fontSize(10).fillColor('#555555').font('Helvetica')
      .text(mc.tagline, 50, 76);

    doc.fontSize(16).fillColor('#2E7D32').font('Helvetica-Bold')
      .text(mc.title, 300, 50, { align: 'right', width: 245 });
    doc.fontSize(10).fillColor('#555555').font('Helvetica')
      .text(mc.numberLabel(`FA-${new Date().getFullYear()}/${order.number.split('-').pop()}`), 300, 74, { align: 'right', width: 245 })
      .text(mc.dateLabel(formatDate(new Date())), 300, 88, { align: 'right', width: 245 });

    doc.moveTo(50, 145).lineTo(545, 145).strokeColor('#2E7D32').lineWidth(2).stroke();

    const clientName = order.customer_name || 'Cliente';

    doc.fontSize(11).fillColor('#2E7D32').font('Helvetica-Bold').text(mc.clientHeader, 50, 160);
    doc.fontSize(10).fillColor('#333333').font('Helvetica')
      .text(mc.nameLabel(clientName), 50, 178)
      .text(mc.whatsappLabel(order.customer_phone), 50, 193);

    const tY = 240;
    doc.rect(50, tY, 495, 28).fillColor('#2E7D32').fill();
    doc.fontSize(10).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(mc.tableDescription, 60, tY + 9)
      .text(mc.tableReference, 265, tY + 9)
      .text(mc.tableQty, 360, tY + 9, { width: 30, align: 'center' })
      .text(mc.tableUnitPrice, 395, tY + 9, { width: 75, align: 'right' })
      .text(mc.tableTotal, 475, tY + 9, { width: 65, align: 'right' });

    const ROW_HEIGHT = 36;

    const products = lineItems.filter((line) => !line.isService);
    const services = lineItems.filter((line) => line.isService);

    products.forEach((line, i) => {
      const iY = tY + 28 + i * ROW_HEIGHT;
      doc.rect(50, iY, 495, ROW_HEIGHT).fillColor('#F1F8E9').fill();
      doc.fontSize(10).fillColor('#333333').font('Helvetica')
        .text(line.description, 60, iY + 6, { width: 195 })
        .text(line.reference, 265, iY + 12)
        .text('1', 360, iY + 12, { width: 30, align: 'center' })
        .text(formatPrice(line.price), 395, iY + 12, { width: 75, align: 'right' })
        .text(formatPrice(line.price), 475, iY + 12, { width: 65, align: 'right' });
    });

    let contentEndY = tY + 28 + products.length * ROW_HEIGHT;

    if (services.length > 0) {
      const SERVICE_ROW_HEIGHT = 28;
      const svcHeaderLabelY = contentEndY + 20;
      doc.fontSize(11).fillColor('#2E7D32').font('Helvetica-Bold').text(mc.servicesHeader(), 50, svcHeaderLabelY);

      const svcHeaderY = svcHeaderLabelY + 18;
      doc.rect(50, svcHeaderY, 495, 24).fillColor('#2E7D32').fill();
      doc.fontSize(10).fillColor('#FFFFFF').font('Helvetica-Bold')
        .text(mc.tableDescription, 60, svcHeaderY + 7)
        .text(mc.tableTotal, 475, svcHeaderY + 7, { width: 65, align: 'right' });

      services.forEach((line, i) => {
        const iY = svcHeaderY + 24 + i * SERVICE_ROW_HEIGHT;
        doc.rect(50, iY, 495, SERVICE_ROW_HEIGHT).fillColor('#F1F8E9').fill();
        doc.fontSize(10).fillColor('#333333').font('Helvetica')
          .text(line.description, 60, iY + 8, { width: 400 })
          .text(formatPrice(line.price), 475, iY + 8, { width: 65, align: 'right' });
      });

      const svcBodyHeight = services.length * SERVICE_ROW_HEIGHT;
      const servicesTotal = services.reduce((sum, line) => sum + (Number(line.price) || 0), 0);
      const svcTotalY = svcHeaderY + 24 + svcBodyHeight + 6;
      doc.fontSize(9).fillColor('#2E7D32').font('Helvetica-Bold')
        .text(`${mc.servicesTotal()}: ${formatPrice(servicesTotal)}`, 50, svcTotalY, { width: 495, align: 'right' });

      contentEndY = svcTotalY + 14;
    }

    const total = lineItems.reduce((sum, line) => sum + (Number(line.price) || 0), 0);

    const totalY = contentEndY + 36;
    doc.rect(350, totalY, 195, 28).fillColor('#2E7D32').fill();
    doc.fontSize(12).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(mc.totalPaid, 360, totalY + 8)
      .text(formatPrice(total), 455, totalY + 8, { width: 85, align: 'right' });

    doc.fontSize(8).fillColor('#555555').font('Helvetica-Oblique')
      .text(mc.agtStamp, 50, totalY + 120);

    doc.end();
    stream.on('finish', async () => {
      try {
        await recordGeneratedDocument(order.customer_phone, 'invoice_pdf', filePath, order.number);
      } catch (err) {
        logger.error(`Error recording generated invoice PDF for order ${order.number}`, err);
      }
      resolve(filePath);
    });
    stream.on('error', (err) => reject(err));
  });
}
