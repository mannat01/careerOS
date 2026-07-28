/**
 * Plugin capability contract (M10 · plugin platform).
 *
 * A plugin declares — up front, in code — everything it may do:
 *   • a typed input schema (zod)
 *   • a typed output schema (zod)
 *   • the EXACT set of tool actions it may invoke (subset of the capability-gate registry)
 *   • the highest autonomy tier it may reach
 *   • a resource budget (max tool calls, wall-clock timeout)
 *
 * The sandbox (see ./sandbox.ts) is the ONLY thing that runs a plugin. It:
 *   • executes the plugin's source in a fresh `node:vm` context with NO
 *     access to `process`, `require`, filesystem, network, or globals other
 *     than the minimal ctx we hand it,
 *   • routes every ctx.callTool() through the capability-gate under the
 *     user's own scope (so declared Yellow calls still need approval and
 *     Red calls remain uncallable),
 *   • enforces the declared-tools allowlist BEFORE the gate (denying
 *     undeclared tool names even if they happen to be Green in the registry),
 *   • caps tool-call count and wall-clock time,
 *   • contains any throw/hang/panic so it CANNOT crash or stall the host.
 *
 * A plugin therefore has zero ambient authority: everything is by declaration.
 */
import { z } from 'zod';
import type { AutonomyTier } from '@careeros/contracts';

/**
 * A single declared tool the plugin may invoke. We keep this minimal for now
 * (name only) — future revisions can add per-tool argument schemas or bound
 * defaults without breaking existing manifests.
 */
export interface DeclaredTool {
  readonly name: string;
}

/**
 * The plugin's authored manifest — the ONLY source of truth for what the
 * plugin is allowed to do. The registry stores this verbatim per user.
 */
export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly inputSchema: z.ZodTypeAny;
  readonly outputSchema: z.ZodTypeAny;
  /** Declared tool allowlist. The sandbox denies any call outside this set. */
  readonly declaredTools: readonly DeclaredTool[];
  /** Highest tier the plugin may reach. Red plugins are still uncallable at
   *  invoke time — this field is advisory metadata for the registry UI. */
  readonly autonomyTier: AutonomyTier;
  readonly budget: {
    /** Absolute cap on ctx.callTool() invocations for one run(). */
    readonly maxToolCalls: number;
    /** Wall-clock cap on the plugin's run(); exceeding it fails the plugin. */
    readonly timeoutMs: number;
  };
}

/**
 * A plugin bundle: manifest + JavaScript source. The source is a plain
 * expression string that, when evaluated inside the sandbox vm-context, must
 * assign an async function to `run` (as an implicit global). The sandbox
 * then invokes `run(input, ctx)` and awaits it.
 *
 * Example source:
 *   `async function run(input, ctx) {
 *      const r = await ctx.callTool('research.run', { query: input.query });
 *      return { summary: r.summary };
 *    }`
 *
 * We deliberately use a source string (rather than a JS function reference)
 * so the run body executes inside `vm.runInContext` with the sandbox's
 * restricted globals — a plugin author cannot smuggle in closures over
 * `process`, `require`, or any host reference.
 */
export interface Plugin {
  readonly manifest: PluginManifest;
  readonly source: string;
}

/**
 * The plugin-facing context. This is the ONLY object the plugin's `run`
 * function receives beyond `input`. It is Object.frozen before hand-off.
 */
export interface PluginContext {
  /** Scoped user id — the sandbox always uses this for gate + host-tool calls. */
  readonly userId: string;
  /**
   * Invoke a declared host tool. The sandbox:
   *   1. verifies `name` is in the plugin's declared allowlist,
   *   2. checks and increments the budget counter,
   *   3. runs the capability-gate under the plugin's userId,
   *   4. dispatches to the host tool registry (host tools only ever see the
   *      plugin's own userId — they cannot be asked to act on someone else's).
   */
  callTool(name: string, args: unknown, opts?: { approvalToken?: string }): Promise<unknown>;
}

/** Structural interface satisfied by any host tool implementation. */
export interface HostTool {
  readonly action: string;
  invoke(args: unknown, meta: { userId: string }): unknown;
}

/**
 * Registry of host tools the sandbox may dispatch to. Anything not in this
 * registry is un-invokable by any plugin, full stop (fail-closed).
 */
export interface HostToolRegistry {
  get(name: string): HostTool | undefined;
}

/** Terminal failure codes the sandbox reports upstream. Never thrown to the host. */
export type PluginFailureCode =
  | 'input_invalid'
  | 'output_invalid'
  | 'undeclared_tool'
  | 'unknown_tool'
  | 'capability_denied'
  | 'budget_exhausted'
  | 'timeout'
  | 'plugin_error';

export type PluginRunResult<O = unknown> =
  | { ok: true; output: O; toolCalls: number }
  | { ok: false; code: PluginFailureCode; reason: string; toolCalls: number };

// ------------------- runtime validators (manifest hygiene) -------------------

/**
 * Runtime shape check for a manifest — the registry uses this to reject
 * malformed plugin registrations before they can be invoked.
 */
export const manifestShapeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  declaredTools: z.array(z.object({ name: z.string().min(1) })).min(0),
  autonomyTier: z.enum(['green', 'yellow', 'red']),
  budget: z.object({
    maxToolCalls: z.number().int().nonnegative(),
    timeoutMs: z.number().int().positive(),
  }),
});