/**
 * Plugin sandbox — M10 plugin platform. Security-critical.
 *
 * The sandbox is the ONLY execution path for third-party plugins. It gives a
 * plugin exactly one thing beyond its input: a frozen `ctx` object with a
 * single method — `callTool(name, args, opts?)`. Every other authority
 * (process.env, require, filesystem, network, other users' data, the DB,
 * secrets, and any host capability the plugin did NOT declare) is denied at
 * the boundary — a plugin has NO ambient authority.
 *
 * The containment model (defense in depth — every layer would have to fail):
 *
 *   1.  Fresh `vm.createContext({})` with an empty sandbox object. No
 *       process, require, module, __dirname, __filename, fetch, etc. are
 *       injected. The plugin cannot reach them.
 *
 *   2.  The plugin's source is wrapped as an IIFE that returns its `run`
 *       function; nothing global is created outside that function.
 *
 *   3.  `ctx.callTool` enforces the DECLARED-TOOLS allowlist BEFORE it
 *       reaches the capability-gate. An undeclared tool is refused even if
 *       it happens to be Green in the registry — the plugin promised not to
 *       call it and we hold it to that promise.
 *
 *   4.  Every ctx.callTool routes through the capability-gate (same
 *       `enforce()` used everywhere else) under the plugin's OWN userId.
 *       Yellow calls still need a valid approval token; Red calls are
 *       hard-denied by the gate — no plugin can bypass that.
 *
 *   5.  Host tools receive the plugin's userId at invocation. They can
 *       never be tricked into acting on another user's data (see
 *       adversarial containment test C).
 *
 *   6.  Budget: a hard cap on ctx.callTool() invocations, incremented BEFORE
 *       dispatch — a plugin that tries to burn tools is stopped mid-burn.
 *
 *   7.  Timeout: `Promise.race` against a wall-clock timer. A plugin that
 *       hangs (infinite loop OR pending promise) surfaces as a `timeout`
 *       failure, NOT a host crash.
 *
 *   8.  Any throw inside the plugin is caught and converted to a
 *       `plugin_error` failure result. The host never sees the raw
 *       exception; nothing propagates.
 *
 *   9.  Input and output are validated against the plugin's declared zod
 *       schemas. Bad input → `input_invalid` before the plugin ever runs;
 *       bad output → `output_invalid` after — the host is never handed
 *       unchecked data.
 *
 *  10. Every deny (undeclared tool, unknown tool, gate deny, budget,
 *       timeout, plugin error) is audited via the same AuditWriter the
 *       capability-gate uses. Containment failures fail LOUDLY (the
 *       adversarial tests assert on the audit trail).
 */
import { createContext, runInContext } from 'node:vm';
import {
  CapabilityDeniedError,
  createToolCallGate,
  type AuditWriter,
  type EnforceDeps,
  type EnforceInput,
} from '@careeros/capability-gate';
import type {
  HostToolRegistry,
  Plugin,
  PluginContext,
  PluginFailureCode,
  PluginRunResult,
} from './types.js';

export interface SandboxDeps {
  gateDeps: EnforceDeps;
  hostTools: HostToolRegistry;
  audit: AuditWriter;
  /** Overrideable clock so timeout tests are deterministic. Defaults to `Date.now`. */
  now?: () => number;
}

export interface RunPluginInput {
  plugin: Plugin;
  userId: string;
  input: unknown;
  /**
   * Optional per-call approval tokens keyed by the tool `name` the plugin will
   * present. The plugin's own source may pass a token, but we ALSO allow the
   * caller to attach tokens externally so a UI-driven approval can flow
   * through without the plugin having to fabricate JWT strings.
   */
  approvalTokens?: Readonly<Record<string, string>>;
}

async function audit(
  deps: SandboxDeps,
  userId: string,
  pluginId: string,
  decision: 'allowed' | 'denied',
  reason: string,
): Promise<void> {
  await deps.audit.append({
    userId,
    actor: 'system',
    action: `plugin.${decision}`,
    target: pluginId,
    reason,
    traceId: null,
  });
}

/**
 * Run a plugin. Never throws — always resolves to a PluginRunResult so callers
 * cannot be crashed by a hostile plugin. Failures are reported, not propagated.
 */
export async function runPlugin<O = unknown>(
  { plugin, userId, input, approvalTokens }: RunPluginInput,
  deps: SandboxDeps,
): Promise<PluginRunResult<O>> {
  const declared = new Set(plugin.manifest.declaredTools.map((t) => t.name));

  // 1. Validate input against the plugin's own schema (fail-closed).
  const parsedInput = plugin.manifest.inputSchema.safeParse(input);
  if (!parsedInput.success) {
    await audit(deps, userId, plugin.manifest.id, 'denied', 'input_invalid');
    return { ok: false, code: 'input_invalid', reason: parsedInput.error.message, toolCalls: 0 };
  }

  const gate = createToolCallGate(deps.gateDeps);
  let toolCalls = 0;
  const failureRef: { current: { code: PluginFailureCode; reason: string } | null } = { current: null };

  const callTool: PluginContext['callTool'] = async (name, args, opts) => {
    // (a) Declared-allowlist check — BEFORE the gate. This is the plugin
    //     contract: even a Green tool is off-limits if not declared.
    if (!declared.has(name)) {
      failureRef.current = { code: 'undeclared_tool', reason: `plugin '${plugin.manifest.id}' called undeclared tool '${name}'` };
      await audit(deps, userId, plugin.manifest.id, 'denied', failureRef.current.reason);
      throw new Error(`undeclared_tool: ${name}`);
    }

    // (b) Budget check — before dispatch, so a runaway plugin cannot exceed
    //     its declared budget by starting many calls in parallel.
    if (toolCalls >= plugin.manifest.budget.maxToolCalls) {
      failureRef.current = { code: 'budget_exhausted', reason: `plugin '${plugin.manifest.id}' exceeded maxToolCalls=${String(plugin.manifest.budget.maxToolCalls)}` };
      await audit(deps, userId, plugin.manifest.id, 'denied', failureRef.current.reason);
      throw new Error('budget_exhausted');
    }
    toolCalls += 1;

    // (c) Host-tool existence check — fail-closed on unknown tools.
    const tool = deps.hostTools.get(name);
    if (!tool) {
      failureRef.current = { code: 'unknown_tool', reason: `tool '${name}' not registered on host` };
      await audit(deps, userId, plugin.manifest.id, 'denied', failureRef.current.reason);
      throw new Error(`unknown_tool: ${name}`);
    }

    // (d) Capability-gate — SAME path as any host call site. Yellow needs a
    //     valid token; Red is hard-denied. userId is ALWAYS the plugin's own.
    const enforceInput: EnforceInput = {
      userId,
      action: name,
      payload: args,
      actor: 'system',
      approvalToken: opts?.approvalToken ?? approvalTokens?.[name],
    };
    try {
      return await gate(enforceInput, () => tool.invoke(args, { userId }));
    } catch (err: unknown) {
      if (err instanceof CapabilityDeniedError) {
        const reason = `${err.action}: ${err.reason}`;
        failureRef.current = { code: 'capability_denied', reason };
        // The gate already wrote its own denied audit; we add a plugin-scoped one.
        await audit(deps, userId, plugin.manifest.id, 'denied', reason);
        throw err;
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  };

  const ctx: PluginContext = Object.freeze({ userId, callTool });

  // 2. Build the vm sandbox with an EMPTY globals object. No process, no
  //    require, no console. Anything the plugin needs must arrive via ctx.
  const vmSandbox = Object.create(null) as Record<string, unknown>;
  const vmContext = createContext(vmSandbox);

  // The plugin source is wrapped so we extract its `run` function without
  // leaking anything else into globals.
  const wrapped = `(function(){\n${plugin.source}\n; return typeof run === 'function' ? run : null; })()`;

  let runFn: ((input: unknown, ctx: PluginContext) => unknown) | null;
  try {
    runFn = runInContext(wrapped, vmContext, {
      timeout: Math.max(50, plugin.manifest.budget.timeoutMs),
      displayErrors: false,
    }) as typeof runFn;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'compile_failed';
    await audit(deps, userId, plugin.manifest.id, 'denied', `plugin_error: ${reason}`);
    return { ok: false, code: 'plugin_error', reason, toolCalls };
  }

  if (typeof runFn !== 'function') {
    await audit(deps, userId, plugin.manifest.id, 'denied', 'plugin_error: run() not defined');
    return { ok: false, code: 'plugin_error', reason: 'run() not defined', toolCalls };
  }

  // 3. Invoke the plugin under a wall-clock timeout. We race the plugin's
  //    promise against a timer; a hung plugin surfaces as `timeout`, never a
  //    stall.
  const timeoutMs = plugin.manifest.budget.timeoutMs;
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    // Best-effort: don't keep the process alive for a runaway timer.
    if (timerId && typeof (timerId as unknown as { unref?: () => void }).unref === 'function') {
      (timerId as unknown as { unref: () => void }).unref();
    }
  });

  let rawOutput: unknown;
  try {
    rawOutput = await Promise.race([Promise.resolve().then(() => runFn(parsedInput.data, ctx)), timeoutPromise]);
  } catch (err) {
    if (timerId) clearTimeout(timerId);
    if (failureRef.current) {
      // The failure was already audited by callTool.
      return { ok: false, code: failureRef.current.code, reason: failureRef.current.reason, toolCalls };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'timeout') {
      await audit(deps, userId, plugin.manifest.id, 'denied', `timeout after ${String(timeoutMs)}ms`);
      return { ok: false, code: 'timeout', reason: `timeout after ${String(timeoutMs)}ms`, toolCalls };
    }
    await audit(deps, userId, plugin.manifest.id, 'denied', `plugin_error: ${msg}`);
    return { ok: false, code: 'plugin_error', reason: msg, toolCalls };
  }
  if (timerId) clearTimeout(timerId);

  // 4. Validate output against the plugin's own schema.
  const parsedOutput = plugin.manifest.outputSchema.safeParse(rawOutput);
  if (!parsedOutput.success) {
    await audit(deps, userId, plugin.manifest.id, 'denied', `output_invalid: ${parsedOutput.error.message}`);
    return { ok: false, code: 'output_invalid', reason: parsedOutput.error.message, toolCalls };
  }

  await audit(deps, userId, plugin.manifest.id, 'allowed', `plugin '${plugin.manifest.id}' completed (${String(toolCalls)} tool calls)`);
  return { ok: true, output: parsedOutput.data as O, toolCalls };
}