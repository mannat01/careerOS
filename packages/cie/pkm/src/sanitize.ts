/**
 * Utility for sanitizing UNTRUSTED PKM body text before it reaches an LLM prompt
 * or another derived consumer. PKM entries are the user's own free-text, but can
 * still contain accidental or malicious prompt-injection markers (system-role
 * tags, tool-use blocks, fake instructions targeting the twin), or HTML/script
 * fragments pasted from a browser.
 *
 * The sanitizer is deliberately conservative: it strips markup and neutralizes
 * common injection markers, but preserves the user's actual language. It also
 * FLAGS bodies where injection-like patterns were found so a future derived
 * consumer can reject or downweight the text without changing the source entry.
 *
 * This mirrors the same defense-in-depth we apply to ingested opportunity /
 * research text (untrusted source text — sanitize before it reaches an LLM).
 */

const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const SCRIPT_BLOCK_RE = /<script[\s\S]*?<\/script>/gi;
const STYLE_BLOCK_RE = /<style[\s\S]*?<\/style>/gi;

const INJECTION_MARKERS = [
  /\bignore (?:all )?(?:previous|prior|above) (?:instructions|prompts)\b/i,
  /\bsystem[:\s]+you are\b/i,
  /<\|(?:system|assistant|user|tool|end_of_turn|im_start|im_end)\|>/i,
  /\[\[(?:system|assistant|tool)\]\]/i,
  /\bdisregard (?:the )?(?:above|system|prior)\b/i,
  /\byou are (?:now|actually) (?:a|an) [a-z ]+ (?:assistant|agent|model)\b/i,
];

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export interface SanitizeResult {
  sanitized: string;
  injectionFlagged: boolean;
}

/** Sanitize a PKM entry body. Returns the cleaned string + injection flag. */
export function sanitizePkmBody(raw: string): SanitizeResult {
  if (typeof raw !== 'string') {
    return { sanitized: '', injectionFlagged: false };
  }

  let flagged = false;

  // Detect injection markers on the RAW body (before we strip markup) so we
  // don't miss markers hidden inside tags.
  for (const re of INJECTION_MARKERS) {
    if (re.test(raw)) {
      flagged = true;
      break;
    }
  }

  const stripped = raw
    .replace(SCRIPT_BLOCK_RE, ' ')
    .replace(STYLE_BLOCK_RE, ' ')
    .replace(HTML_TAG_RE, ' ')
    .replace(CONTROL_CHARS_RE, ' ')
    // Neutralize common role tags even after tag-strip (e.g. `<|system|>`
    // written as literal text).
    .replace(/<\|[a-z_]+\|>/gi, ' [redacted-role-marker] ')
    .replace(/\[\[(system|assistant|tool)\]\]/gi, ' [redacted-role-marker] ')
    .replace(/\s+/g, ' ')
    .trim();

  return { sanitized: stripped, injectionFlagged: flagged };
}

/** Normalize + dedupe user-supplied tags. */
export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const clean = t.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= 16) break;
  }
  return out;
}