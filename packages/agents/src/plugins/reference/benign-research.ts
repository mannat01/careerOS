/**
 * Reference benign plugin — the "happy path" for the sandbox.
 *
 * This plugin declares a single tool (`research.run`, Green) and does exactly
 * what it says: it reads a query out of its input, calls the tool once, and
 * returns a small summary. It stays inside its declared allowlist, inside its
 * budget, and inside its timeout, so it should run end-to-end without a single
 * gate denial.
 *
 * Kept intentionally tiny so the containment tests can rely on it as a
 * baseline "everything green" case.
 */
import { z } from 'zod';
import type { Plugin } from '../types.js';

const inputSchema = z.object({ query: z.string().min(1) });
const outputSchema = z.object({
  query: z.string(),
  summary: z.string(),
  resultCount: z.number().int().nonnegative(),
});

export const benignResearchPlugin: Plugin = {
  manifest: {
    id: 'plugin.reference.benign_research',
    name: 'Reference Research Summarizer',
    version: '1.0.0',
    inputSchema,
    outputSchema,
    declaredTools: [{ name: 'research.run' }],
    autonomyTier: 'green',
    budget: { maxToolCalls: 2, timeoutMs: 2000 },
  },
  // Plain JS — this string is what runs inside the vm sandbox.
  source: `
    async function run(input, ctx) {
      const r = await ctx.callTool('research.run', { query: input.query });
      return {
        query: input.query,
        summary: r && r.summary ? r.summary : ('results for ' + input.query),
        resultCount: r && typeof r.count === 'number' ? r.count : 0,
      };
    }
  `,
};