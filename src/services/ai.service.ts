import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/config.js";
import { logger } from "../config/logger.js";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const VISION_MODEL = "claude-haiku-4-5-20251001";
const EXTRACTION_MODEL = "claude-haiku-4-5-20251001";

export interface VisionData {
  document: boolean;
  valid?: boolean;
  reason?: string | null;
  make?: string | null;
  model?: string | null;
  year?: string | null;
  license_plate?: string | null;
  chassis_number?: string | null;
  engine_number?: string | null;
  engine_size?: string | null;
  fuel_type?: string | null;
  color?: string | null;
  body_type?: string | null;
}

/**
 * Sends a vehicle document/VIN photo to Claude Vision and parses back the
 * extracted vehicle fields (make, model, chassis number, etc), returning null
 * if the image contains no vehicle identification at all.
 */
export async function extractDataWithClaudeVision(imageBase64: string): Promise<VisionData | null> {
  try {
    const response = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: `Analyze this image related to vehicle identification. It can be ANY of the following:
- An Angolan livrete, Vehicle Certificate (Título do Veículo), technical datasheet (ficha técnica), or
  other vehicle registration document
- A chassis identification plate (VIN plate) — usually found in the engine bay, door frame, dashboard,
  or stamped directly into the vehicle's structure
- A label, sticker, or engraving showing the chassis number (VIN)
- Any other photo where the chassis number (VIN), license plate, or vehicle data is legible

It does not need to be a formal paper document — even a photo showing only the VIN number counts.

If the image has NO vehicle identification information visible at all (no VIN, no license plate, no
make/model), respond exactly: {"document": false}

If the image shows ANY vehicle identification information, extract the visible data and respond ONLY
with valid JSON:
{
  "document": true,
  "valid": true or false,
  "reason": "reason if invalid or unreadable",
  "make": "vehicle make (e.g. Toyota, Mercedes, Volvo)",
  "model": "model (e.g. Hilux, Actros, FH16)",
  "year": "manufacture or registration year (4 digits)",
  "license_plate": "license plate if visible",
  "chassis_number": "VIN or chassis number if visible (17 characters)",
  "engine_number": "engine number if visible",
  "engine_size": "engine displacement (e.g. 2.4, 3.0)",
  "fuel_type": "fuel type (Gasoline, Diesel, Electric)",
  "color": "vehicle color if visible",
  "body_type": "body type (Light, Heavy, SUV, Commercial, etc)",
  "owner": null
}

IMPORTANT RULES:
- A photo that clearly shows a 17-character chassis number (VIN) is always valid (valid: true), even if
  no other field is visible — make/model/year can be null, the VIN alone is enough
- If you are NOT fully confident in your reading (e.g. handwriting, rotated text, poor lighting), still
  set chassis_number to your single best-effort guess at the 17 characters rather than null, and set
  valid: false with an explanation in reason. Your best guess will be independently cross-checked
  against a vehicle database — a wrong guess simply fails that check safely, so guessing is always
  more useful than leaving it null. Never guess for any other field though — leave those null if unsure
- Never invent data for fields other than chassis_number — if a field isn't visible or legible, set it
  to null
- The "owner" field must ALWAYS be null (privacy)
- If the image has no chassis number at all and is too blurry or unreadable to confidently read
  anything else either, set valid: false and explain in reason
- Respond ONLY with the JSON, no additional text`
          }
        ]
      }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      if (!parsed.document) return null;
      return parsed as VisionData;
    } catch {
      logger.error(`Error parsing vision model JSON: ${text}`);
      return { valid: false, reason: "Erro ao interpretar o documento." } as VisionData;
    }
  } catch (error: any) {
    logger.error(`Claude Vision error: ${error.message}`);
    throw error;
  }
}

export interface PaymentProofData {
  valid: boolean;
  reason?: string | null;
  amount?: string | null;
  date?: string | null;
  reference?: string | null;
}

/**
 * Sends a customer's payment-proof photo or PDF to Claude Vision and parses
 * back whether it looks like a genuine payment proof, plus any amount/date/reference visible on it.
 */
export async function extractPaymentProofData(
  fileBase64: string,
  mediaType: 'image' | 'document'
): Promise<PaymentProofData | null> {
  try {
    const response = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          mediaType === 'document'
            ? {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: fileBase64,
                },
              }
            : {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: fileBase64,
                },
              },
          {
            type: "text",
            text: `Analyze this file. It should be a payment proof (bank transfer receipt, deposit slip,
Multicaixa Express, or mobile payment confirmation in Angola).

Respond ONLY with valid JSON in this format:
{
  "valid": true or false,
  "reason": "reason if invalid or unreadable (e.g. not a payment proof, unreadable image)",
  "amount": "payment amount if visible (e.g. 18,500 Kz)",
  "date": "payment date if visible",
  "reference": "reference or transaction number if visible"
}

IMPORTANT RULES:
- "valid" must be false if the file doesn't look like a real payment proof, is unreadable/blank, or is
  clearly something else (e.g. a selfie, a car part, an identity document)
- Never invent data — if a field isn't visible or legible, set it to null
- Respond ONLY with the JSON, no additional text`
          }
        ]
      }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    try {
      return JSON.parse(text.replace(/```json|```/g, "").trim()) as PaymentProofData;
    } catch {
      logger.error(`Error parsing payment-proof vision JSON: ${text}`);
      return { valid: false, reason: "Erro ao interpretar o comprovativo." };
    }
  } catch (error: any) {
    logger.error(`Claude Vision payment-proof error: ${error.message}`);
    throw error;
  }
}

/**
 * Sends a customer's free-text search message to Claude Haiku and parses
 * back each distinct part/product mentioned, as short phrases suitable for
 * the existing full-text search — the one deliberate exception to this
 * codebase's "no conversational AI in the message pipeline" rule alongside
 * `validation.service.ts`'s `validateFreeText` (see CLAUDE.md): a single-shot
 * judgment call, no history, no system prompt, no JSON action dispatch.
 * Fails OPEN by returning null on any network/API error or unparseable
 * response, so the caller falls back to treating the whole message as one
 * single-product search — today's unchanged behavior — rather than ever
 * blocking a search on an Anthropic outage.
 */
export async function extractProductNames(customerText: string): Promise<string[] | null> {
  try {
    const response = await anthropic.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `A customer sent this WhatsApp message to an auto-parts store, asking for one or more
parts: "${customerText}"

Identify each DISTINCT part/product they're asking for, as a short search phrase suitable for a
parts-catalog full-text search (e.g. "filtro de óleo", "pastilhas de travão dianteiras") — not a
rewrite of the whole message, not synonyms, no invented parts they didn't mention. If the message
names only one product (or nothing clearly product-like), respond with an array containing just
that one phrase (or the original message text verbatim if nothing product-like is identifiable).

Respond ONLY with valid JSON, no additional text:
{"products": ["phrase1", "phrase2", ...]}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      const products = Array.isArray(parsed.products)
        ? parsed.products.map((p: any) => String(p).trim()).filter((p: string) => p.length > 0)
        : [];
      return products.length > 0 ? products : [customerText];
    } catch {
      logger.error(`Error parsing product-extraction model JSON: ${text}`);
      return null;
    }
  } catch (error: any) {
    logger.error(`Claude product-extraction error: ${error.message}`);
    return null;
  }
}
