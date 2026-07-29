import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokens, cssVar, type TokenKey } from '../src/tokens.js';

/**
 * `tokens.ts` and `tokens.css` MUST stay in sync — the app renders from CSS
 * variables at runtime, tests read TS at build time, and if they diverge the
 * contrast test lies about the shipped values. This test parses `tokens.css`
 * and compares each `--co-*` variable to the TS map for both themes.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(__dirname, '../src/tokens.css');
const css = readFileSync(cssPath, 'utf8');

/** Extract the block matching a selector (returns text between `{` and matching `}`). */
function extractBlock(selectorRegex: RegExp): string {
  const match = selectorRegex.exec(css);
  if (!match) throw new Error(`Selector not found: ${selectorRegex}`);
  const start = match.index + match[0].length;
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    const ch = css[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return css.slice(start, i - 1);
}

function parseVars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--co-[a-z-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const key = m[1];
    const value = m[2];
    if (key && value) out[key] = value.trim().toLowerCase();
  }
  return out;
}

// `:root {` block (light theme). We anchor to the first `:root {` occurrence.
const lightBlock = extractBlock(/:root\s*\{/);
// `.dark, :root[data-theme='dark'] {` block (explicit dark theme).
const darkBlock = extractBlock(/\.dark,\s*:root\[data-theme='dark'\]\s*\{/);

const lightVars = parseVars(lightBlock);
const darkVars = parseVars(darkBlock);

const allKeys = Object.keys(tokens.light) as TokenKey[];

describe('tokens.css mirrors tokens.ts', () => {
  it.each(allKeys)('light: %s matches CSS', (key) => {
    const cssName = cssVar(key);
    expect(lightVars[cssName], `missing ${cssName} in :root`).toBeDefined();
    expect(lightVars[cssName]).toBe(tokens.light[key].toLowerCase());
  });

  it.each(allKeys)('dark: %s matches CSS', (key) => {
    const cssName = cssVar(key);
    expect(darkVars[cssName], `missing ${cssName} in .dark`).toBeDefined();
    expect(darkVars[cssName]).toBe(tokens.dark[key].toLowerCase());
  });
});