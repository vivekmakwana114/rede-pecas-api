import { config } from '../config/config.js';
import { logger } from '../config/logger.js';
import { appendChatMessage } from './session.service.js';

const WHATSAPP_API_URL = `${config.whatsapp.graphApiUrl}/${config.whatsapp.phoneNumberId}/messages`;

const INTERACTIVE_BODY_LIMIT = 1024;

/**
 * Truncates an interactive message body to WhatsApp's 1024-character
 * limit, logging a warning when truncation was needed.
 */
function clampBody(body: string, context: string): string {
  if (body.length <= INTERACTIVE_BODY_LIMIT) return body;
  logger.warn(`${context} body exceeded ${INTERACTIVE_BODY_LIMIT} chars (${body.length}), truncating`);
  return body.slice(0, INTERACTIVE_BODY_LIMIT - 1) + '…';
}

/**
 * Sends a plain text message to a phone number via the WhatsApp Cloud API.
 */
export async function sendWhatsAppMessage(phone: string, text: string): Promise<any> {
  logger.debug(`[TEST-CAPTURE] text -> ${phone}: ${text}`);
  await appendChatMessage(phone, 'out', text);
  try {
    const response = await fetch(WHATSAPP_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.whatsapp.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      logger.error('WhatsApp API sending error', error);
      throw new Error(`WhatsApp API error: ${response.status}`);
    }

    return response.json();
  } catch (error: any) {
    logger.error(`Error sending message to ${phone}: ${error.message}`);
    throw error;
  }
}

/**
 * Marks an inbound WhatsApp message as read and shows the typing
 * indicator to the customer while a reply is being prepared.
 */
export async function sendTypingIndicator(messageId: string): Promise<void> {
  try {
    const response = await fetch(WHATSAPP_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.whatsapp.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      logger.error('WhatsApp API typing-indicator error', error);
    }
  } catch (error: any) {
    logger.error(`Error sending typing indicator: ${error.message}`);
  }
}

/**
 * Resolves a WhatsApp media id to its download URL via the Graph API,
 * downloads the file, and returns it as a base64 string, or null on any failure.
 */
export async function downloadWhatsAppMedia(mediaId: string): Promise<string | null> {
  try {
    const metaRes = await fetch(`${config.whatsapp.graphApiUrl}/${mediaId}`, {
      headers: { Authorization: `Bearer ${config.whatsapp.token}` },
    });
    if (!metaRes.ok) {
      logger.error(`WhatsApp media lookup error for ${mediaId}: ${metaRes.status}`);
      return null;
    }
    const { url } = await metaRes.json() as { url?: string };
    if (!url) return null;

    const mediaRes = await fetch(url, {
      headers: { Authorization: `Bearer ${config.whatsapp.token}` },
    });
    if (!mediaRes.ok) {
      logger.error(`WhatsApp media download error for ${mediaId}: ${mediaRes.status}`);
      return null;
    }

    const buffer = await mediaRes.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  } catch (error: any) {
    logger.error(`Error downloading WhatsApp media ${mediaId}: ${error.message}`);
    return null;
  }
}

/**
 * Sends a WhatsApp interactive reply-button message (up to 3 buttons),
 * optionally with an image/document header, via the Cloud API.
 */
export async function sendWhatsAppButtons(
  phone: string,
  body: string,
  buttons: string[],
  ids?: string[],
  media?: { type: 'image' | 'document'; id: string }
): Promise<any> {
  const header = media
    ? media.type === 'document'
      ? { type: 'document', document: { id: media.id, filename: 'payment-proof.pdf' } }
      : { type: 'image', image: { id: media.id } }
    : undefined;

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "interactive",
    interactive: {
      type: "button",
      ...(header ? { header } : {}),
      body: { text: clampBody(body, 'Buttons') },
      action: {
        buttons: buttons.slice(0, 3).map((b, i) => ({
          type: "reply",
          reply: { id: ids?.[i] ?? `btn_${i}`, title: b },
        })),
      },
    },
  };
  logger.debug(`[TEST-CAPTURE] buttons -> ${phone}: ${body} | [${buttons.join(' / ')}]`);
  await appendChatMessage(phone, 'out', `${body} [${buttons.join(' / ')}]`);

  try {
    const response = await fetch(WHATSAPP_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.whatsapp.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      logger.error('WhatsApp API sending buttons error', error);
      throw new Error(`WhatsApp API button error: ${response.status}`);
    }

    return response.json();
  } catch (error: any) {
    logger.error(`Error sending buttons to ${phone}: ${error.message}`);
    throw error;
  }
}

/**
 * Sends a WhatsApp interactive List Message (up to 10 rows) via the Cloud API.
 */
export async function sendWhatsAppList(
  phone: string,
  body: string,
  buttonText: string,
  rows: { id: string; title: string; description?: string }[]
): Promise<any> {
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: clampBody(body, 'List') },
      action: {
        button: buttonText,
        sections: [{ rows: rows.slice(0, 10) }],
      },
    },
  };
  logger.debug(`[TEST-CAPTURE] list -> ${phone}: ${body} | button="${buttonText}" | rows=${JSON.stringify(rows)}`);
  await appendChatMessage(phone, 'out', `${body} [list: ${buttonText}]`);

  try {
    const response = await fetch(WHATSAPP_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.whatsapp.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      logger.error('WhatsApp API sending list error', error);
      throw new Error(`WhatsApp API list error: ${response.status}`);
    }

    return response.json();
  } catch (error: any) {
    logger.error(`Error sending list to ${phone}: ${error.message}`);
    throw error;
  }
}
