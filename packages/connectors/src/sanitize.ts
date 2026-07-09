/**
 * Untrusted-input defense (coding-standards.md §1: ingested source text is UNTRUSTED
 * and a prompt-injection risk). Minimal M01 hook: decode entities, strip markup and
 * control chars, bound length, and flag likely injection markers for downstream
 * agents to treat with suspicion. This runs before any ingested text is stored.
 */

const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&'], // last, so we don't double-decode
];

// Control chars, zero-width chars, bidi marks, BOM — all removed.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f\\u200b-\\u200f\\u2028\\u2029\\ufeff]', 'g');

const INJECTION_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['ignore_instructions', /ignore\s+(all\s+|any\s+)?(previous|prior|above)\s+instructions/i],
  ['system_prompt_probe', /(reveal|show|print|repeat)\s+(the\s+)?system\s+prompt/i],
  ['role_hijack', /you\s+are\s+now\s+(a|an|the)\s/i],
  ['tool_hijack', /call\s+the\s+\w+\s+tool|<\|.*?\|>/i],
  ['exfiltration', /send\s+(all\s+)?(user\s+)?(data|credentials|tokens?)\s+to/i],
];

export interface SanitizedText {
  text: string;
  truncated: boolean;
  injectionFlags: string[];
}

export function sanitizeUntrustedText(input: string, maxLength = 20_000): SanitizedText {
  let text = input;
  for (const [pattern, replacement] of ENTITIES) text = text.replace(pattern, replacement);
  text = text.replace(/<[^>]*>/g, ' '); // strip tags
  text = text.replace(CONTROL_CHARS, '');
  text = text.replace(/\s+/g, ' ').trim();

  const truncated = text.length > maxLength;
  if (truncated) text = text.slice(0, maxLength);

  const injectionFlags = INJECTION_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
  return { text, truncated, injectionFlags };
}
