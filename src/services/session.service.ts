import { createClient } from 'redis';
import { createHash } from 'crypto';
import { config } from '../config/config.js';
import { logger } from '../config/logger.js';
import { Product } from '../models/product.model.js';
import { Service } from '../models/service.model.js';

let redisClient: any = null;
let useMemoryFallback = false;
const memoryCache = new Map<string, any[]>();

const SESSION_TTL = 60 * 60 * 4;
const VEHICLE_ID_CHOICE_TTL = SESSION_TTL;

// Every session read/write below gates on `redisClient?.isOpen` to decide
// Redis vs. in-memory-fallback — but right after process start, `isOpen` is
// false for the whole span of the connect() attempt below, which looks
// IDENTICAL to "Redis is down, use memory fallback" even though Redis is
// about to come up fine and already holds real session data (e.g. a
// customer's detected locale) from before this restart. A request handled
// in that window would silently read from the fresh, empty in-memory Map
// instead of waiting for the real Redis data, then diverge from a request
// handled a moment later once Redis finishes connecting — this is exactly
// what caused a courtesy message going out in both the customer's actual
// (Redis-cached) locale and the DEFAULT_LOCALE fallback within the same
// minute, once during dev-server hot-reload. `redisReady` exposes this
// connect attempt as an awaitable so `index.ts` can hold off starting the
// HTTP server / background sweeps until it settles, closing the window
// entirely instead of requiring every function below to await it individually.
export let redisReady: Promise<void> = Promise.resolve();

if (config.redis.url) {
  try {
    redisClient = createClient({ url: config.redis.url });
    redisClient.on('error', (err: any) => {
      logger.error('Redis client error, falling back to in-memory cache', err);
      useMemoryFallback = true;
    });

    redisReady = redisClient.connect().then(() => {
      logger.info('Connected to Redis successfully for sessions');
    }).catch((err: any) => {
      logger.error('Failed to connect to Redis, using memory fallback', err);
      useMemoryFallback = true;
    });
  } catch (err) {
    logger.error('Failed to initialize Redis client, using memory fallback', err);
    useMemoryFallback = true;
  }
} else {
  logger.info('No REDIS_URL provided, using in-memory cache for sessions');
  useMemoryFallback = true;
}

/**
 * Stores the product search-results list a customer was just shown, so a
 * subsequent list-tap or typed digit can be resolved back to a specific product.
 */
export async function savePendingOptions(phone: string, options: any[]): Promise<void> {
  const key = `options:${phone}`;
  memoryCache.set(key, options);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, JSON.stringify(options));
  } catch (err) {
    logger.error('Error saving pending options to Redis', err);
  }
}

/**
 * Retrieves the pending product search-results list for a phone, if any is
 * still cached.
 */
export async function getPendingOptions(phone: string): Promise<any[] | null> {
  const key = `options:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    return memoryCache.get(key) || null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Error fetching pending options from Redis', err);
    return memoryCache.get(key) || null;
  }
}

/**
 * Removes the pending product search-results list for a phone once it's
 * been resolved or superseded.
 */
export async function clearPendingOptions(phone: string): Promise<void> {
  const key = `options:${phone}`;
  memoryCache.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error deleting pending options from Redis', err);
  }
}

export interface BasketItemDraft {
  product: Product;
  service: { name: string; price: number } | null;
}

export interface UnmatchedBasketItem {
  query: string;                  // the raw phrase that didn't match any in-stock product
  candidateId: number | null;     // an out-of-stock (zero-qty) product that matched, if any — waitlist-eligible
  candidateName: string | null;
}

export interface PendingBasket {
  queue: string[];           // product-name phrases not yet searched/resolved
  items: BasketItemDraft[];  // resolved so far
  // The one part-type choice (OEM/Aftermarket/New/Second Hand) for this
  // order, asked once before search and applied to every item in it — never
  // asked again per item. Empty string until the part-type step resolves it.
  partType: string;
  // Phrases that found no in-stock match while working through the queue —
  // accumulated silently (no per-item message) so the customer gets one
  // consolidated notice/waitlist-offer once the whole queue is drained,
  // instead of a repeated back-and-forth per failed item.
  unmatched: UnmatchedBasketItem[];
}

const basketCache = new Map<string, PendingBasket>();

/**
 * Stores the in-progress multi-product "basket" for a phone — the remaining
 * product-name phrases still to be searched/resolved, plus the items already
 * picked — while the customer works through a multi-product search one item at a time.
 */
export async function savePendingBasket(phone: string, basket: PendingBasket): Promise<void> {
  const key = `basket:${phone}`;
  basketCache.set(key, basket);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, JSON.stringify(basket));
  } catch (err) {
    logger.error('Error saving pending basket to Redis', err);
  }
}

/**
 * Retrieves the in-progress multi-product basket for a phone, if one is
 * still being built.
 */
export async function getPendingBasket(phone: string): Promise<PendingBasket | null> {
  const key = `basket:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    return basketCache.get(key) || null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Error fetching pending basket from Redis', err);
    return basketCache.get(key) || null;
  }
}

/**
 * Removes the in-progress multi-product basket for a phone once it's been
 * confirmed or cancelled.
 */
export async function clearPendingBasket(phone: string): Promise<void> {
  const key = `basket:${phone}`;
  basketCache.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error deleting pending basket from Redis', err);
  }
}

export interface PendingPartTypeChoice {
  productNames: string[] | null; // null/single-item search vs. a multi-item basket request
  customerText: string;          // original free text, re-used to run the search once resolved
  customerName: string;
}

const partTypeChoiceCache = new Map<string, PendingPartTypeChoice>();

/**
 * Stores the identified part(s) awaiting a one-time-per-order part-type
 * choice (OEM/Aftermarket/New/Second Hand) before any search runs.
 */
export async function savePendingPartTypeChoice(phone: string, pending: PendingPartTypeChoice): Promise<void> {
  const key = `partTypeChoice:${phone}`;
  partTypeChoiceCache.set(key, pending);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, JSON.stringify(pending));
  } catch (err) {
    logger.error('Error saving pending part-type choice to Redis', err);
  }
}

/**
 * Retrieves the pending part-type choice for a phone, if one is still
 * awaiting a reply.
 */
export async function getPendingPartTypeChoice(phone: string): Promise<PendingPartTypeChoice | null> {
  const key = `partTypeChoice:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    return partTypeChoiceCache.get(key) || null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Error fetching pending part-type choice from Redis', err);
    return partTypeChoiceCache.get(key) || null;
  }
}

/**
 * Removes the pending part-type choice for a phone once resolved.
 */
export async function clearPendingPartTypeChoice(phone: string): Promise<void> {
  const key = `partTypeChoice:${phone}`;
  partTypeChoiceCache.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error deleting pending part-type choice from Redis', err);
  }
}

export interface PendingOrderProfileShortcut {
  orderNumber: string;
}

const orderProfileShortcutCache = new Map<string, PendingOrderProfileShortcut>();

/**
 * Stores which order is waiting on a returning customer's "use my saved
 * details" reply (individual/company + NIF + address already on file).
 */
export async function savePendingOrderProfileShortcut(phone: string, pending: PendingOrderProfileShortcut): Promise<void> {
  const key = `orderProfileShortcut:${phone}`;
  orderProfileShortcutCache.set(key, pending);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, JSON.stringify(pending));
  } catch (err) {
    logger.error('Error saving pending order-profile shortcut to Redis', err);
  }
}

/**
 * Retrieves the pending order-profile shortcut for a phone, if one is still
 * awaiting a reply.
 */
export async function getPendingOrderProfileShortcut(phone: string): Promise<PendingOrderProfileShortcut | null> {
  const key = `orderProfileShortcut:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    return orderProfileShortcutCache.get(key) || null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Error fetching pending order-profile shortcut from Redis', err);
    return orderProfileShortcutCache.get(key) || null;
  }
}

/**
 * Removes the pending order-profile shortcut for a phone once resolved.
 */
export async function clearPendingOrderProfileShortcut(phone: string): Promise<void> {
  const key = `orderProfileShortcut:${phone}`;
  orderProfileShortcutCache.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error clearing pending order-profile shortcut in Redis', err);
  }
}

export type OrderProfileStageName =
  | 'awaiting_type'
  | 'awaiting_company_nif'
  | 'awaiting_company_address'
  | 'awaiting_individual_address'
  | 'awaiting_individual_nif_choice'
  | 'awaiting_individual_nif_number';

export interface OrderProfileStage {
  orderNumber: string;
  stage: OrderProfileStageName;
  // Accumulated across steps, only committed to `customers` on the final
  // step — an abandoned wizard never leaves a half-updated profile.
  customerType?: 'individual' | 'company';
  nif?: string | null;
  address?: string | null;
}

const orderProfileStageCache = new Map<string, OrderProfileStage>();

/**
 * Stores the in-progress individual/company + NIF + address wizard for an
 * order, one step at a time.
 */
export async function saveOrderProfileStage(phone: string, stage: OrderProfileStage): Promise<void> {
  const key = `orderProfileStage:${phone}`;
  orderProfileStageCache.set(key, stage);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, JSON.stringify(stage));
  } catch (err) {
    logger.error('Error saving order-profile stage to Redis', err);
  }
}

/**
 * Retrieves the in-progress order-profile wizard stage for a phone, if one
 * is still active.
 */
export async function getOrderProfileStage(phone: string): Promise<OrderProfileStage | null> {
  const key = `orderProfileStage:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    return orderProfileStageCache.get(key) || null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Error fetching order-profile stage from Redis', err);
    return orderProfileStageCache.get(key) || null;
  }
}

/**
 * Removes the order-profile wizard stage for a phone once it completes.
 */
export async function clearOrderProfileStage(phone: string): Promise<void> {
  const key = `orderProfileStage:${phone}`;
  orderProfileStageCache.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error clearing order-profile stage in Redis', err);
  }
}

export interface PendingAlternativeOffer {
  orderNumber: string;
  itemId: number;
}

const alternativeOfferCache = new Map<string, PendingAlternativeOffer>();

/**
 * Stores which order/item an alternative-products list currently on screen
 * belongs to, so the customer's list-tap/typed-digit reply resolves back to
 * the right unavailable line item on an existing multi-item order.
 */
export async function savePendingAlternativeOffer(phone: string, offer: PendingAlternativeOffer): Promise<void> {
  const key = `altOffer:${phone}`;
  alternativeOfferCache.set(key, offer);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, JSON.stringify(offer));
  } catch (err) {
    logger.error('Error saving pending alternative offer to Redis', err);
  }
}

/**
 * Retrieves the pending alternative-products offer for a phone, if one is
 * still awaiting a reply.
 */
export async function getPendingAlternativeOffer(phone: string): Promise<PendingAlternativeOffer | null> {
  const key = `altOffer:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    return alternativeOfferCache.get(key) || null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Error fetching pending alternative offer from Redis', err);
    return alternativeOfferCache.get(key) || null;
  }
}

/**
 * Removes the pending alternative-products offer for a phone once it's
 * been resolved.
 */
export async function clearPendingAlternativeOffer(phone: string): Promise<void> {
  const key = `altOffer:${phone}`;
  alternativeOfferCache.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error deleting pending alternative offer from Redis', err);
  }
}

export interface PendingAlternativeResolution {
  orderNumber: string;
  queue: number[]; // itemIds still needing an alternative offered
}

const alternativeResolutionCache = new Map<string, PendingAlternativeResolution>();

/**
 * Stores the queue of an existing multi-item order's rejected line items
 * still waiting to be offered alternatives, one at a time, after admin
 * marks some items unavailable.
 */
export async function savePendingAlternativeResolution(phone: string, resolution: PendingAlternativeResolution): Promise<void> {
  const key = `altResolution:${phone}`;
  alternativeResolutionCache.set(key, resolution);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, JSON.stringify(resolution));
  } catch (err) {
    logger.error('Error saving pending alternative resolution to Redis', err);
  }
}

/**
 * Retrieves the in-progress alternative-resolution queue for a phone, if
 * one is still active.
 */
export async function getPendingAlternativeResolution(phone: string): Promise<PendingAlternativeResolution | null> {
  const key = `altResolution:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    return alternativeResolutionCache.get(key) || null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Error fetching pending alternative resolution from Redis', err);
    return alternativeResolutionCache.get(key) || null;
  }
}

/**
 * Removes the alternative-resolution queue for a phone once every rejected
 * item has been offered an alternative (picked or skipped).
 */
export async function clearPendingAlternativeResolution(phone: string): Promise<void> {
  const key = `altResolution:${phone}`;
  alternativeResolutionCache.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error clearing pending alternative resolution in Redis', err);
  }
}

const activeSessions = new Map<string, number>();

/**
 * Reports whether a phone has no active session marker yet, i.e. this is
 * effectively a fresh conversation.
 */
export async function isNewSession(phone: string): Promise<boolean> {
  const key = `active:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    const expiresAt = activeSessions.get(key);
    return !expiresAt || expiresAt < Date.now();
  }

  try {
    const exists = await redisClient.exists(key);
    return exists === 0;
  } catch (err) {
    logger.error('Error checking session activity in Redis', err);
    const expiresAt = activeSessions.get(key);
    return !expiresAt || expiresAt < Date.now();
  }
}

/**
 * Marks a phone's conversation session as active for the standard TTL.
 */
export async function markSessionActive(phone: string): Promise<void> {
  const key = `active:${phone}`;
  activeSessions.set(key, Date.now() + SESSION_TTL * 1000);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, '1');
  } catch (err) {
    logger.error('Error marking session active in Redis', err);
  }
}

const partPromptSessions = new Map<string, number>();

/**
 * Reports whether the "what part do you need" prompt was already sent
 * this session, gating whether free text may be treated as a product search.
 */
export async function wasPartPromptSent(phone: string): Promise<boolean> {
  const key = `partPrompt:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    const expiresAt = partPromptSessions.get(key);
    return !!expiresAt && expiresAt >= Date.now();
  }

  try {
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (err) {
    logger.error('Error checking part-prompt state in Redis', err);
    const expiresAt = partPromptSessions.get(key);
    return !!expiresAt && expiresAt >= Date.now();
  }
}

/**
 * Marks that the "what part do you need" prompt has been sent for this
 * phone's session.
 */
export async function markPartPromptSent(phone: string): Promise<void> {
  const key = `partPrompt:${phone}`;
  partPromptSessions.set(key, Date.now() + SESSION_TTL * 1000);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, '1');
  } catch (err) {
    logger.error('Error marking part-prompt state in Redis', err);
  }
}

const pendingVehicleChoiceCache = new Map<string, { id: number; make: string; model: string; year: string }[]>();

/**
 * Stores the list of vehicles a customer with 2+ vehicles is being asked
 * to choose between before a product search proceeds.
 */
export async function savePendingVehicleChoice(
  phone: string,
  vehicles: { id: number; make: string; model: string; year: string }[]
): Promise<void> {
  const key = `vehicleChoice:${phone}`;
  pendingVehicleChoiceCache.set(key, vehicles);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, JSON.stringify(vehicles));
  } catch (err) {
    logger.error('Error saving pending vehicle choice to Redis', err);
  }
}

/**
 * Retrieves the pending "which vehicle is this for?" choice list for a
 * phone, if one is still awaiting a reply.
 */
export async function getPendingVehicleChoice(phone: string): Promise<{ id: number; make: string; model: string; year: string }[] | null> {
  const key = `vehicleChoice:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    return pendingVehicleChoiceCache.get(key) || null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Error fetching pending vehicle choice from Redis', err);
    return pendingVehicleChoiceCache.get(key) || null;
  }
}

/**
 * Removes the pending "which vehicle is this for?" choice list for a
 * phone once it's been resolved.
 */
export async function clearPendingVehicleChoice(phone: string): Promise<void> {
  const key = `vehicleChoice:${phone}`;
  pendingVehicleChoiceCache.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error deleting pending vehicle choice from Redis', err);
  }
}

const chosenVehicleSessions = new Map<string, { id: number; expiresAt: number }>();

/**
 * Records which of a customer's multiple vehicles they picked, so
 * subsequent searches this session are scoped to it.
 */
export async function saveChosenVehicle(phone: string, vehicleId: number): Promise<void> {
  const key = `chosenVehicle:${phone}`;
  chosenVehicleSessions.set(key, { id: vehicleId, expiresAt: Date.now() + SESSION_TTL * 1000 });

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, String(vehicleId));
  } catch (err) {
    logger.error('Error saving chosen vehicle to Redis', err);
  }
}

/**
 * Retrieves the id of the vehicle a customer previously chose for
 * searches this session, if any.
 */
export async function getChosenVehicle(phone: string): Promise<number | null> {
  const key = `chosenVehicle:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    const entry = chosenVehicleSessions.get(key);
    return entry && entry.expiresAt >= Date.now() ? entry.id : null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? parseInt(data, 10) : null;
  } catch (err) {
    logger.error('Error fetching chosen vehicle from Redis', err);
    const entry = chosenVehicleSessions.get(key);
    return entry && entry.expiresAt >= Date.now() ? entry.id : null;
  }
}

const vehicleIdChoiceSessions = new Map<string, number>();

/**
 * Marks that the vehicle-ID entry option buttons (VIN/photo/manual) were
 * just shown to this phone.
 */
export async function markVehicleIdChoiceShown(phone: string): Promise<void> {
  const key = `vehicleIdChoice:${phone}`;
  vehicleIdChoiceSessions.set(key, Date.now() + VEHICLE_ID_CHOICE_TTL * 1000);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, VEHICLE_ID_CHOICE_TTL, '1');
  } catch (err) {
    logger.error('Error marking vehicle-ID choice shown in Redis', err);
  }
}

/**
 * Reports whether the vehicle-ID entry option buttons were shown to this
 * phone within the current session.
 */
export async function wasVehicleIdChoiceShown(phone: string): Promise<boolean> {
  const key = `vehicleIdChoice:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    const expiresAt = vehicleIdChoiceSessions.get(key);
    return !!expiresAt && expiresAt >= Date.now();
  }

  try {
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (err) {
    logger.error('Error checking vehicle-ID choice state in Redis', err);
    const expiresAt = vehicleIdChoiceSessions.get(key);
    return !!expiresAt && expiresAt >= Date.now();
  }
}

/**
 * Clears the vehicle-ID entry option buttons' shown flag for this phone.
 */
export async function clearVehicleIdChoiceShown(phone: string): Promise<void> {
  const key = `vehicleIdChoice:${phone}`;
  vehicleIdChoiceSessions.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error clearing vehicle-ID choice in Redis', err);
  }
}

const waitlistOfferCache = new Map<string, { productId: number; productName: string; query?: string }>();

/**
 * Stores the out-of-stock product a customer was just offered to join
 * the waitlist for, awaiting their yes/no reply.
 */
export async function savePendingWaitlistOffer(
  phone: string,
  offer: { productId: number; productName: string; query?: string }
): Promise<void> {
  const key = `waitlist:${phone}`;
  waitlistOfferCache.set(key, offer);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, JSON.stringify(offer));
  } catch (err) {
    logger.error('Error saving pending waitlist offer to Redis', err);
  }
}

/**
 * Retrieves the pending waitlist offer for a phone, if one is still
 * awaiting a reply.
 */
export async function getPendingWaitlistOffer(phone: string): Promise<{ productId: number; productName: string; query?: string } | null> {
  const key = `waitlist:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    return waitlistOfferCache.get(key) || null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Error fetching pending waitlist offer from Redis', err);
    return waitlistOfferCache.get(key) || null;
  }
}

/**
 * Removes the pending waitlist offer for a phone once the customer has
 * replied.
 */
export async function clearPendingWaitlistOffer(phone: string): Promise<void> {
  const key = `waitlist:${phone}`;
  waitlistOfferCache.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error deleting pending waitlist offer from Redis', err);
  }
}

export interface PendingBasketWaitlistOffer {
  candidates: { productId: number; productName: string }[];
}

const basketWaitlistOfferCache = new Map<string, PendingBasketWaitlistOffer>();

/**
 * Stores the set of out-of-stock products a customer was just offered a
 * single consolidated waitlist opt-in for, after every item in a multi-part
 * search came back unavailable — see product.service.ts's advanceBasket.
 */
export async function savePendingBasketWaitlistOffer(phone: string, offer: PendingBasketWaitlistOffer): Promise<void> {
  const key = `basketWaitlist:${phone}`;
  basketWaitlistOfferCache.set(key, offer);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, JSON.stringify(offer));
  } catch (err) {
    logger.error('Error saving pending basket waitlist offer to Redis', err);
  }
}

/**
 * Retrieves the pending consolidated basket-waitlist offer for a phone, if
 * one is still awaiting a reply.
 */
export async function getPendingBasketWaitlistOffer(phone: string): Promise<PendingBasketWaitlistOffer | null> {
  const key = `basketWaitlist:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    return basketWaitlistOfferCache.get(key) || null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Error fetching pending basket waitlist offer from Redis', err);
    return basketWaitlistOfferCache.get(key) || null;
  }
}

/**
 * Removes the pending consolidated basket-waitlist offer for a phone once
 * the customer has replied.
 */
export async function clearPendingBasketWaitlistOffer(phone: string): Promise<void> {
  const key = `basketWaitlist:${phone}`;
  basketWaitlistOfferCache.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error clearing pending basket waitlist offer in Redis', err);
  }
}

const restockOrderOfferCache = new Map<string, { productId: number; productName: string }>();

/**
 * Stores the restocked product a waitlisted customer was just offered to
 * order, awaiting their yes/no reply.
 */
export async function savePendingRestockOrderOffer(
  phone: string,
  offer: { productId: number; productName: string }
): Promise<void> {
  const key = `restockOrder:${phone}`;
  restockOrderOfferCache.set(key, offer);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, JSON.stringify(offer));
  } catch (err) {
    logger.error('Error saving pending restock-order offer to Redis', err);
  }
}

/**
 * Retrieves the pending restock-order offer for a phone, if one is still
 * awaiting a reply.
 */
export async function getPendingRestockOrderOffer(phone: string): Promise<{ productId: number; productName: string } | null> {
  const key = `restockOrder:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    return restockOrderOfferCache.get(key) || null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Error fetching pending restock-order offer from Redis', err);
    return restockOrderOfferCache.get(key) || null;
  }
}

/**
 * Removes the pending restock-order offer for a phone once the customer
 * has replied.
 */
export async function clearPendingRestockOrderOffer(phone: string): Promise<void> {
  const key = `restockOrder:${phone}`;
  restockOrderOfferCache.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error deleting pending restock-order offer from Redis', err);
  }
}

export interface PendingServiceOffer {
  // Set when the order already exists (the restock-reorder path, which
  // creates its order immediately since the product was already fully
  // resolved by the earlier restock notification — see
  // product.service.ts's startOrderForProduct/processRestockOrderChoice).
  // Absent while building a search-results-driven basket (single- or
  // multi-item — see PendingBasket), where no order exists yet and a
  // selection is appended to the basket instead.
  orderNumber?: string;
  product: Product;
  services: Service[];
}

const serviceOfferCache = new Map<string, PendingServiceOffer>();

/**
 * Stores the add-on services list offered alongside a newly ordered
 * product, awaiting the customer's selection or skip.
 */
export async function savePendingServiceOffer(phone: string, offer: PendingServiceOffer): Promise<void> {
  const key = `serviceOffer:${phone}`;
  serviceOfferCache.set(key, offer);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, JSON.stringify(offer));
  } catch (err) {
    logger.error('Error saving pending service offer to Redis', err);
  }
}

/**
 * Retrieves the pending service-offer for a phone, if one is still
 * awaiting a selection.
 */
export async function getPendingServiceOffer(phone: string): Promise<PendingServiceOffer | null> {
  const key = `serviceOffer:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    return serviceOfferCache.get(key) || null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Error fetching pending service offer from Redis', err);
    return serviceOfferCache.get(key) || null;
  }
}

/**
 * Removes the pending service-offer for a phone once the customer has
 * made a selection.
 */
export async function clearPendingServiceOffer(phone: string): Promise<void> {
  const key = `serviceOffer:${phone}`;
  serviceOfferCache.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error deleting pending service offer from Redis', err);
  }
}

export interface PendingStockUnavailableOffer {
  orderNumber: string;
  productId: number;
  productName: string;
}

const stockUnavailableOfferCache = new Map<string, PendingStockUnavailableOffer>();

/**
 * Stores the order whose stock just turned out to be unavailable,
 * awaiting the customer's choice between an alternative search or the waitlist.
 */
export async function savePendingStockUnavailableOffer(phone: string, offer: PendingStockUnavailableOffer): Promise<void> {
  const key = `stockUnavailable:${phone}`;
  stockUnavailableOfferCache.set(key, offer);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, JSON.stringify(offer));
  } catch (err) {
    logger.error('Error saving pending stock-unavailable offer to Redis', err);
  }
}

/**
 * Retrieves the pending stock-unavailable offer for a phone, if one is
 * still awaiting a reply.
 */
export async function getPendingStockUnavailableOffer(phone: string): Promise<PendingStockUnavailableOffer | null> {
  const key = `stockUnavailable:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    return stockUnavailableOfferCache.get(key) || null;
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error('Error fetching pending stock-unavailable offer from Redis', err);
    return stockUnavailableOfferCache.get(key) || null;
  }
}

/**
 * Removes the pending stock-unavailable offer for a phone once the
 * customer has replied.
 */
export async function clearPendingStockUnavailableOffer(phone: string): Promise<void> {
  const key = `stockUnavailable:${phone}`;
  stockUnavailableOfferCache.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error deleting pending stock-unavailable offer from Redis', err);
  }
}

const vinDuplicateChoiceSessions = new Map<string, number>();

/**
 * Marks that the "this VIN is already registered" choice buttons were
 * just shown to this phone.
 */
export async function markVinDuplicateChoiceShown(phone: string): Promise<void> {
  const key = `vinDuplicateChoice:${phone}`;
  vinDuplicateChoiceSessions.set(key, Date.now() + VEHICLE_ID_CHOICE_TTL * 1000);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, VEHICLE_ID_CHOICE_TTL, '1');
  } catch (err) {
    logger.error('Error marking VIN-duplicate choice shown in Redis', err);
  }
}

/**
 * Reports whether the "VIN already registered" choice buttons were shown
 * to this phone within the current session.
 */
export async function wasVinDuplicateChoiceShown(phone: string): Promise<boolean> {
  const key = `vinDuplicateChoice:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    const expiresAt = vinDuplicateChoiceSessions.get(key);
    return !!expiresAt && expiresAt >= Date.now();
  }

  try {
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (err) {
    logger.error('Error checking VIN-duplicate choice state in Redis', err);
    const expiresAt = vinDuplicateChoiceSessions.get(key);
    return !!expiresAt && expiresAt >= Date.now();
  }
}

/**
 * Clears the "VIN already registered" choice buttons' shown flag for this
 * phone.
 */
export async function clearVinDuplicateChoice(phone: string): Promise<void> {
  const key = `vinDuplicateChoice:${phone}`;
  vinDuplicateChoiceSessions.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error clearing VIN-duplicate choice in Redis', err);
  }
}

const vehicleConfirmSessions = new Map<string, number>();

/**
 * Marks that the vehicle Sim/Não confirmation buttons were just shown to
 * this phone, gating the confirm-reply matcher.
 */
export async function markVehicleConfirmShown(phone: string): Promise<void> {
  const key = `vehicleConfirm:${phone}`;
  vehicleConfirmSessions.set(key, Date.now() + VEHICLE_ID_CHOICE_TTL * 1000);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, VEHICLE_ID_CHOICE_TTL, '1');
  } catch (err) {
    logger.error('Error marking vehicle-confirm choice shown in Redis', err);
  }
}

/**
 * Reports whether the vehicle Sim/Não confirmation buttons were shown to
 * this phone within the current session.
 */
export async function wasVehicleConfirmShown(phone: string): Promise<boolean> {
  const key = `vehicleConfirm:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    const expiresAt = vehicleConfirmSessions.get(key);
    return !!expiresAt && expiresAt >= Date.now();
  }

  try {
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (err) {
    logger.error('Error checking vehicle-confirm choice state in Redis', err);
    const expiresAt = vehicleConfirmSessions.get(key);
    return !!expiresAt && expiresAt >= Date.now();
  }
}

/**
 * Clears the vehicle Sim/Não confirmation buttons' shown flag for this
 * phone.
 */
export async function clearVehicleConfirmShown(phone: string): Promise<void> {
  const key = `vehicleConfirm:${phone}`;
  vehicleConfirmSessions.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error clearing vehicle-confirm choice in Redis', err);
  }
}

const vinDecodeFailedSessions = new Map<string, { vin: string; expiresAt: number }>();

/**
 * Marks that the manual-entry fallback message was shown after a VIN
 * decode failed, caching the attempted VIN alongside the flag.
 */
export async function markVinDecodeFailedShown(phone: string, attemptedVin: string): Promise<void> {
  const key = `vinDecodeFailed:${phone}`;
  vinDecodeFailedSessions.set(key, { vin: attemptedVin, expiresAt: Date.now() + VEHICLE_ID_CHOICE_TTL * 1000 });

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, VEHICLE_ID_CHOICE_TTL, attemptedVin);
  } catch (err) {
    logger.error('Error marking VIN-decode-failed choice shown in Redis', err);
  }
}

/**
 * Reports whether a VIN-decode-failed fallback message was shown to this
 * phone within the current session.
 */
export async function wasVinDecodeFailedShown(phone: string): Promise<boolean> {
  const key = `vinDecodeFailed:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    const entry = vinDecodeFailedSessions.get(key);
    return !!entry && entry.expiresAt >= Date.now();
  }

  try {
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (err) {
    logger.error('Error checking VIN-decode-failed choice state in Redis', err);
    const entry = vinDecodeFailedSessions.get(key);
    return !!entry && entry.expiresAt >= Date.now();
  }
}

/**
 * Retrieves the VIN that failed to decode for this phone, if the
 * decode-failed flag is still active.
 */
export async function getVinDecodeFailedVin(phone: string): Promise<string | null> {
  const key = `vinDecodeFailed:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    const entry = vinDecodeFailedSessions.get(key);
    return entry && entry.expiresAt >= Date.now() ? entry.vin : null;
  }

  try {
    const data = await redisClient.get(key);
    return data ?? null;
  } catch (err) {
    logger.error('Error fetching VIN-decode-failed VIN from Redis', err);
    const entry = vinDecodeFailedSessions.get(key);
    return entry && entry.expiresAt >= Date.now() ? entry.vin : null;
  }
}

/**
 * Clears the VIN-decode-failed flag and cached VIN for this phone.
 */
export async function clearVinDecodeFailedChoice(phone: string): Promise<void> {
  const key = `vinDecodeFailed:${phone}`;
  vinDecodeFailedSessions.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error clearing VIN-decode-failed choice in Redis', err);
  }
}

const documentRetryChoiceSessions = new Map<string, number>();

/**
 * Marks that the "try again" document-processing retry button was just
 * shown to this phone.
 */
export async function markDocumentRetryChoiceShown(phone: string): Promise<void> {
  const key = `documentRetryChoice:${phone}`;
  documentRetryChoiceSessions.set(key, Date.now() + VEHICLE_ID_CHOICE_TTL * 1000);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, VEHICLE_ID_CHOICE_TTL, '1');
  } catch (err) {
    logger.error('Error marking document-retry choice shown in Redis', err);
  }
}

/**
 * Reports whether the document-processing retry button was shown to this
 * phone within the current session.
 */
export async function wasDocumentRetryChoiceShown(phone: string): Promise<boolean> {
  const key = `documentRetryChoice:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    const expiresAt = documentRetryChoiceSessions.get(key);
    return !!expiresAt && expiresAt >= Date.now();
  }

  try {
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (err) {
    logger.error('Error checking document-retry choice state in Redis', err);
    const expiresAt = documentRetryChoiceSessions.get(key);
    return !!expiresAt && expiresAt >= Date.now();
  }
}

/**
 * Clears the document-processing retry button's shown flag for this
 * phone.
 */
export async function clearDocumentRetryChoice(phone: string): Promise<void> {
  const key = `documentRetryChoice:${phone}`;
  documentRetryChoiceSessions.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error clearing document-retry choice in Redis', err);
  }
}

const localeSessions = new Map<string, { locale: 'pt' | 'en'; expiresAt: number }>();

/**
 * Caches the detected conversation locale for a phone, so subsequent
 * customer-facing replies this session use the same language.
 */
export async function saveLocale(phone: string, locale: 'pt' | 'en'): Promise<void> {
  const key = `locale:${phone}`;
  localeSessions.set(key, { locale, expiresAt: Date.now() + SESSION_TTL * 1000 });

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, locale);
  } catch (err) {
    logger.error('Error saving locale to Redis', err);
  }
}

/**
 * Retrieves the cached conversation locale for a phone, or null if none
 * has been detected yet this session.
 */
export async function getLocale(phone: string): Promise<'pt' | 'en' | null> {
  const key = `locale:${phone}`;
  if (useMemoryFallback || !redisClient?.isOpen) {
    const entry = localeSessions.get(key);
    return entry && entry.expiresAt >= Date.now() ? entry.locale : null;
  }

  try {
    const data = await redisClient.get(key);
    return data === 'pt' || data === 'en' ? data : null;
  } catch (err) {
    logger.error('Error fetching locale from Redis', err);
    const entry = localeSessions.get(key);
    return entry && entry.expiresAt >= Date.now() ? entry.locale : null;
  }
}

const stringSessions = new Map<string, { value: string; expiresAt: number }>();

/**
 * Generic helper that caches a string value under a key in both the
 * in-memory map and Redis (when available), used by the simple string-valued session fields below.
 */
async function saveString(key: string, value: string): Promise<void> {
  stringSessions.set(key, { value, expiresAt: Date.now() + SESSION_TTL * 1000 });

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, value);
  } catch (err) {
    logger.error(`Error saving ${key} to Redis`, err);
  }
}

/**
 * Generic helper that reads a cached string value by key, preferring
 * Redis and falling back to the in-memory map.
 */
async function getString(key: string): Promise<string | null> {
  const readMemory = () => {
    const entry = stringSessions.get(key);
    return entry && entry.expiresAt >= Date.now() ? entry.value : null;
  };

  if (useMemoryFallback || !redisClient?.isOpen) {
    return readMemory();
  }

  try {
    return (await redisClient.get(key)) ?? null;
  } catch (err) {
    logger.error(`Error fetching ${key} from Redis`, err);
    return readMemory();
  }
}

/**
 * Caches the customer's most recent inbound message text, used as
 * context for the humanize layer's contextual rewrites.
 */
export async function saveLastMessage(phone: string, text: string): Promise<void> {
  return saveString(`lastmsg:${phone}`, text);
}

/**
 * Retrieves the customer's most recently cached inbound message text.
 */
export async function getLastMessage(phone: string): Promise<string | null> {
  return getString(`lastmsg:${phone}`);
}

/**
 * Caches a customer's first name, used as context for the humanize
 * layer's contextual rewrites.
 */
export async function saveCustomerName(phone: string, name: string): Promise<void> {
  return saveString(`custname:${phone}`, name);
}

/**
 * Retrieves a customer's cached first name.
 */
export async function getCustomerName(phone: string): Promise<string | null> {
  return getString(`custname:${phone}`);
}

/**
 * Caches the WhatsApp message id of the most recent interactive prompt
 * sent to a phone, if one was provided.
 */
export async function saveActivePromptId(phone: string, messageId?: string | null): Promise<void> {
  if (!messageId) return;
  return saveString(`activePrompt:${phone}`, messageId);
}

/**
 * Retrieves the cached message id of the most recent interactive prompt
 * sent to a phone.
 */
export async function getActivePromptId(phone: string): Promise<string | null> {
  return getString(`activePrompt:${phone}`);
}

const validationAttemptSessions = new Map<string, { count: number; expiresAt: number }>();

/**
 * Retrieves how many consecutive times a customer's reply has failed
 * validation for a given field this session (0 if none yet).
 */
export async function getValidationAttempts(phone: string, field: string): Promise<number> {
  const key = `valattempts:${field}:${phone}`;

  if (useMemoryFallback || !redisClient?.isOpen) {
    const entry = validationAttemptSessions.get(key);
    return entry && entry.expiresAt >= Date.now() ? entry.count : 0;
  }

  try {
    const data = await redisClient.get(key);
    return data ? parseInt(data, 10) : 0;
  } catch (err) {
    logger.error('Error fetching validation attempts from Redis', err);
    const entry = validationAttemptSessions.get(key);
    return entry && entry.expiresAt >= Date.now() ? entry.count : 0;
  }
}

/**
 * Increments and returns the consecutive-failed-validation count for a
 * phone/field, used to cap retries before accepting the value with a
 * needs_review flag instead of re-asking forever.
 */
export async function incrementValidationAttempts(phone: string, field: string): Promise<number> {
  const key = `valattempts:${field}:${phone}`;
  const next = (await getValidationAttempts(phone, field)) + 1;
  validationAttemptSessions.set(key, { count: next, expiresAt: Date.now() + SESSION_TTL * 1000 });

  if (useMemoryFallback || !redisClient?.isOpen) {
    return next;
  }

  try {
    await redisClient.setEx(key, SESSION_TTL, String(next));
  } catch (err) {
    logger.error('Error saving validation attempts to Redis', err);
  }
  return next;
}

/**
 * Resets the consecutive-failed-validation count for a phone/field, called
 * once a reply passes validation or the field is accepted with a flag.
 */
export async function clearValidationAttempts(phone: string, field: string): Promise<void> {
  const key = `valattempts:${field}:${phone}`;
  validationAttemptSessions.delete(key);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error('Error clearing validation attempts in Redis', err);
  }
}

const HUMANIZE_CACHE_TTL = 60 * 60 * 24;
const humanizeCache = new Map<string, { value: string; expiresAt: number }>();

/**
 * Retrieves a previously cached Claude-humanized rewrite by its cache
 * key, preferring Redis and falling back to the in-memory map.
 */
export async function getHumanized(key: string): Promise<string | null> {
  const readMemory = () => {
    const entry = humanizeCache.get(key);
    return entry && entry.expiresAt >= Date.now() ? entry.value : null;
  };

  if (useMemoryFallback || !redisClient?.isOpen) {
    return readMemory();
  }

  try {
    return (await redisClient.get(key)) ?? null;
  } catch (err) {
    logger.error('Error fetching humanized text from Redis', err);
    return readMemory();
  }
}

/**
 * Caches a Claude-humanized rewrite under its cache key for 24 hours, so
 * repeat inputs skip a fresh API call.
 */
export async function saveHumanized(key: string, value: string): Promise<void> {
  humanizeCache.set(key, { value, expiresAt: Date.now() + HUMANIZE_CACHE_TTL * 1000 });

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, HUMANIZE_CACHE_TTL, value);
  } catch (err) {
    logger.error('Error saving humanized text to Redis', err);
  }
}

const revokedTokens = new Map<string, number>();

/**
 * Builds the cache key for a revoked-token blacklist entry, hashing the
 * raw token so it's never stored in plain text.
 */
function revokedTokenKey(token: string): string {
  return `revokedToken:${createHash('sha1').update(token).digest('hex')}`;
}

/**
 * Blacklists a JWT (access or refresh) for the remainder of its natural
 * lifetime, so a logged-out token can no longer be used.
 */
export async function revokeToken(token: string, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return;
  const key = revokedTokenKey(token);
  revokedTokens.set(key, Date.now() + ttlSeconds * 1000);

  if (useMemoryFallback || !redisClient?.isOpen) {
    return;
  }

  try {
    await redisClient.setEx(key, ttlSeconds, '1');
  } catch (err) {
    logger.error('Error revoking token in Redis', err);
  }
}

/**
 * Checks whether a JWT has been blacklisted via revokeToken.
 */
export async function isTokenRevoked(token: string): Promise<boolean> {
  const key = revokedTokenKey(token);
  if (useMemoryFallback || !redisClient?.isOpen) {
    const expiresAt = revokedTokens.get(key);
    return !!expiresAt && expiresAt >= Date.now();
  }

  try {
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (err) {
    logger.error('Error checking token revocation in Redis', err);
    const expiresAt = revokedTokens.get(key);
    return !!expiresAt && expiresAt >= Date.now();
  }
}

export interface ChatLogEntry {
  direction: 'in' | 'out';
  text: string;
  at: string;
}

const CHAT_LOG_TTL = 60 * 60 * 25;
const chatLogSessions = new Map<string, { messages: ChatLogEntry[]; expiresAt: number }>();

/**
 * Appends a message (inbound customer text or outbound bot reply) to the
 * phone's chat transcript. The 25h TTL is a fixed window from the FIRST
 * message that started it, not a sliding one — later messages in the same
 * window are appended without touching the expiry, so the whole log expires
 * exactly 25h after it started regardless of how active the conversation
 * stays. Once it expires, the next message starts a brand-new 25h window.
 */
export async function appendChatMessage(phone: string, direction: 'in' | 'out', text: string): Promise<void> {
  const key = `chatlog:${phone}`;
  const entry: ChatLogEntry = { direction, text, at: new Date().toISOString() };

  if (useMemoryFallback || !redisClient?.isOpen) {
    const cached = chatLogSessions.get(key);
    const isFirstMessage = !cached || cached.expiresAt < Date.now();
    const messages = isFirstMessage ? [] : cached!.messages;
    messages.push(entry);
    chatLogSessions.set(key, {
      messages,
      expiresAt: isFirstMessage ? Date.now() + CHAT_LOG_TTL * 1000 : cached!.expiresAt,
    });
    return;
  }

  try {
    const ttl = await redisClient.ttl(key);
    const isFirstMessage = ttl < 0; // -2 = key missing, -1 = no TTL (shouldn't happen, treat as first)
    const data = isFirstMessage ? null : await redisClient.get(key);
    const messages: ChatLogEntry[] = data ? JSON.parse(data) : [];
    messages.push(entry);

    chatLogSessions.set(key, {
      messages,
      expiresAt: Date.now() + (isFirstMessage ? CHAT_LOG_TTL : Math.max(ttl, 0)) * 1000,
    });

    if (isFirstMessage) {
      await redisClient.setEx(key, CHAT_LOG_TTL, JSON.stringify(messages));
    } else {
      await redisClient.set(key, JSON.stringify(messages), { KEEPTTL: true });
    }
  } catch (err) {
    logger.error('Error saving chat log to Redis', err);
  }
}

/**
 * Retrieves the phone's rolling 25h chat transcript, oldest first, or an
 * empty array if there's none yet or it's expired.
 */
export async function getChatLog(phone: string): Promise<ChatLogEntry[]> {
  const key = `chatlog:${phone}`;
  const readMemory = (): ChatLogEntry[] => {
    const cached = chatLogSessions.get(key);
    return cached && cached.expiresAt >= Date.now() ? cached.messages : [];
  };

  if (useMemoryFallback || !redisClient?.isOpen) {
    return readMemory();
  }

  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : [];
  } catch (err) {
    logger.error('Error fetching chat log from Redis', err);
    return readMemory();
  }
}

