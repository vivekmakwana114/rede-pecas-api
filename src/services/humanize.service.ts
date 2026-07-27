import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { config } from '../config/config.js';
import { logger } from '../config/logger.js';
import { buildHumanizePrompt } from '../i18n/persona.js';
import { PT_SIGNAL_WORDS, EN_SIGNAL_WORDS } from '../utils/greeting.js';
import { getHumanized, saveHumanized, getLastMessage, getCustomerName } from './session.service.js';


const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
  timeout: 5000,
  maxRetries: 0,
});

const HUMANIZE_MODEL = 'claude-haiku-4-5-20251001';

export const INTERACTIVE_BODY_LIMIT = 1024;
export const TEXT_BODY_LIMIT = 4096;

export interface HumanizeOptions {
  locale: 'pt' | 'en';
  contextual?: boolean;
  phone?: string;
  preserve?: string[];
  maxLength?: number;
}

/**
 * Extracts every run of 3+ digits from a string, used to make sure a
 * humanized rewrite doesn't silently drop numbers like order codes or amounts.
 */
function numericTokens(text: string): string[] {
  return text.match(/\d{3,}/g) ?? [];
}

/**
 * Extracts short double-quoted substrings from a string, used to verify a
 * humanized rewrite preserves any literal keywords the original message quoted.
 */
function quotedLiterals(text: string): string[] {
  return (text.match(/"([^"\n]{1,20})"/g) ?? []).map((q) => q.slice(1, -1).trim()).filter(Boolean);
}

// Common function words that show up in almost any full sentence. The
// customer-message locale detector (greeting.ts) deliberately keeps its word
// list narrow/topic-focused, since a tie there means "don't guess, leave the
// locale alone" — a reasonable default for that use case. This safety check
// has the opposite job: it must actually catch a genuine language mismatch in
// AI-generated prose, so staying silent on an ordinary sentence (a false tie)
// defeats the point. Kept local to this file rather than widening the shared
// detector, so the customer-facing detection behavior documented in
// CLAUDE.md is untouched.
const PT_PROSE_WORDS = new Set([
  'tá', 'tô', 'na', 'no', 'nos', 'nas', 'pra', 'pro', 'do', 'da', 'dos', 'das',
  'ao', 'aos', 'à', 'às', 'que', 'se', 'mas', 'ou', 'é', 'foi', 'ser', 'ter',
  'vai', 'vou', 'ele', 'ela', 'eles', 'elas', 'os', 'as', 'um', 'uma', 'seu',
  'sua', 'teu', 'tua', 'nosso', 'nossa', 'só', 'todo', 'toda', 'todos', 'todas',
  'já', 'mesmo', 'assim', 'pois', 'pelo', 'pela',
]);

const EN_PROSE_WORDS = new Set([
  'the', 'is', 'was', 'are', 'were', 'to', 'of', 'in', 'on', 'at', 'and',
  'but', 'be', 'been', 'this', 'these', 'those', 'from', 'by', 'as', 'it',
  'its', 'we', 'us', 'your', 'our', 'so', 'just', 'let', 'do', 'does', 'did',
  'if', 'not', 'all', 'any', 'get', 'got', 'go', 'going',
]);

/**
 * Strips *bold*-wrapped spans (product/vehicle/order names, which are
 * legitimately language-neutral proper nouns baked into either-language
 * templates) and standalone digit runs before language scoring, so an
 * embedded English product name can't skew detection of the surrounding
 * sentence's actual language — this was the root cause of a real miss: "Front
 * Brake Pads" scored as English signal words inside an otherwise fully
 * Portuguese rewrite, letting it pass a locale=en check.
 */
function stripNeutralSegments(text: string): string {
  return text.replace(/\*[^*]*\*/g, ' ').replace(/\d+/g, ' ');
}

/**
 * Detects whether a full AI-generated message reads as Portuguese or English,
 * for this safety check specifically — see the word-list comment above for
 * why it's broader than (and kept separate from) the customer-message
 * locale detector.
 */
function detectProseLocale(text: string): 'pt' | 'en' | null {
  const words = stripNeutralSegments(text).toLowerCase().match(/\p{L}+/gu) || [];
  if (!words.length) return null;

  let ptScore = 0;
  let enScore = 0;
  for (const word of words) {
    if (PT_SIGNAL_WORDS.has(word) || PT_PROSE_WORDS.has(word)) ptScore++;
    if (EN_SIGNAL_WORDS.has(word) || EN_PROSE_WORDS.has(word)) enScore++;
  }

  if (ptScore === enScore) return null;
  return ptScore > enScore ? 'pt' : 'en';
}

/**
 * Builds a deterministic Redis cache key for a humanized rewrite, hashing
 * the original text and its context so the same input reuses a previous rewrite.
 */
function cacheKey(text: string, opts: HumanizeOptions, context: string): string {
  const hash = createHash('sha1').update(`${text}|${context}`).digest('hex');
  return `humanized:${opts.locale}:${hash}`;
}

interface ValidationResult {
  ok: boolean;
  text?: string;
  reason?: string;
}

/**
 * Checks a candidate rewrite against a set of safety rules — no chatty
 * preamble, correct language, sane length, and no dropped numbers/keywords — before it's trusted.
 */
function validate(original: string, candidate: string, opts: HumanizeOptions): ValidationResult {
  let out = candidate.trim();

  if (/^(here'?s|here is|sure|okay|ok|certainly)\b/i.test(out)) {
    return { ok: false, reason: 'preamble' };
  }
  if (out.length >= 2 && /^["'“”]/.test(out) && /["'“”]$/.test(out)) {
    out = out.slice(1, -1).trim();
  }

  if (!out) return { ok: false, reason: 'empty' };

  const detectedLocale = detectProseLocale(out);
  if (detectedLocale && detectedLocale !== opts.locale) {
    return { ok: false, reason: `wrong-language (detected ${detectedLocale}, expected ${opts.locale})` };
  }

  const limit = opts.maxLength ?? TEXT_BODY_LIMIT;
  if (out.length > limit) {
    return { ok: false, reason: `too-long (${out.length} > ${limit})` };
  }

  const minRatio = original.length > 150 ? 0.5 : 0.35;
  const minLength = original.length * minRatio;
  if (out.length < minLength) {
    return {
      ok: false,
      reason: `too-short (${out.length} < ${Math.round(minLength)}, ratio ${(out.length / original.length).toFixed(2)})`,
    };
  }

  for (const needle of opts.preserve ?? []) {
    if (needle && !out.includes(needle)) {
      return { ok: false, reason: `preserve-missing ("${needle}")` };
    }
  }

  for (const token of numericTokens(original)) {
    if (!out.includes(token)) {
      return { ok: false, reason: `numeric-dropped ("${token}")` };
    }
  }

  for (const literal of quotedLiterals(original)) {
    if (!out.includes(literal)) {
      return { ok: false, reason: `keyword-dropped ("${literal}")` };
    }
  }

  return { ok: true, text: out };
}

/**
 * Logs the outcome of a humanize attempt — whether the final text came
 * from Claude (fresh or cached) or fell back to the original default message.
 */
function logOutcome(
  source: 'claude' | 'cache' | 'default',
  reason: string | null,
  original: string,
  final: string,
  opts: HumanizeOptions
): void {
  const who = opts.phone ?? 'unknown';
  const preview = final.replace(/\s+/g, ' ').slice(0, 70);

  if (source === 'default') {
    const line = `[HUMANIZE] [DEFAULT MESSAGE (messages.ts)] reason=${reason} phone=${who} | ${preview}`;
    if (reason === 'disabled') logger.debug(line);
    else logger.warn(`${line} | original kept: "${original.replace(/\s+/g, ' ').slice(0, 70)}"`);
    return;
  }

  const label = source === 'cache' ? '[CLAUDE MESSAGE (cached)]' : '[CLAUDE MESSAGE (fresh)]';
  logger.info(
    `[HUMANIZE] ${label} phone=${who} locale=${opts.locale}` +
    `${opts.contextual ? ' contextual=true' : ''} | ${preview}`
  );
}

/**
 * Rewrites a canned message into more natural phrasing via Claude, serving
 * a cached rewrite when available and always falling back to the original text
 * if the feature is disabled, empty, or the rewrite fails validation.
 */
export async function humanize(text: string, opts: HumanizeOptions): Promise<string> {
  if (!config.claudeMessage.enabled) {
    logOutcome('default', 'disabled', text, text, opts);
    return text;
  }
  if (!text?.trim()) {
    logOutcome('default', 'empty-source', text, text, opts);
    return text;
  }

  try {
    let context = '';
    if (opts.contextual && opts.phone) {
      const [name, lastMessage] = await Promise.all([
        getCustomerName(opts.phone),
        getLastMessage(opts.phone),
      ]);
      const parts: string[] = [];
      if (name) parts.push(`Customer's name: ${name}`);
      if (lastMessage) parts.push(`What the customer just wrote: ${lastMessage}`);
      context = parts.join('\n');
    }

    const key = cacheKey(text, opts, context);
    const cached = await getHumanized(key);
    if (cached) {
      const revalidated = validate(text, cached, opts);
      if (!revalidated.ok) {
        logOutcome('default', `cache-${revalidated.reason}`, text, text, opts);
        return text;
      }
      logOutcome('cache', null, text, revalidated.text, opts);
      return revalidated.text;
    }

    const instruction = `Rewrite this message in ${opts.locale === 'pt' ? 'PORTUGUESE' : 'ENGLISH'}:`;

    const response = await anthropic.messages.create({
      model: HUMANIZE_MODEL,
      max_tokens: 512,
      system: buildHumanizePrompt(opts.locale),
      messages: [{
        role: 'user',
        content: context
          ? `${context}\n\n${instruction}\n${text}`
          : `${instruction}\n${text}`,
      }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
    const validated = validate(text, raw, opts);

    if (!validated.ok) {
      logOutcome('default', `rejected:${validated.reason}`, text, text, opts);
      return text;
    }

    await saveHumanized(key, validated.text);
    logOutcome('claude', null, text, validated.text, opts);
    return validated.text;
  } catch (error: any) {
    logOutcome('default', `error:${error.message}`, text, text, opts);
    return text;
  }
}
