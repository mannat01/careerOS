/**
 * M10 · plugin platform — adversarial containment tests.
 *
 * Launch-blocker discipline: each of these tests represents a specific escape
 * vector. If the containment layer that stops it is ever removed or weakened,
 * the corresponding assertion fails LOUDLY. Do NOT relax an assertion to make
 * a red test pass — fix the sandbox instead.
 *
 * Coverage:
 *   A. undeclared tool call is refused (allowlist),
 *   B. cross-user access is prevented (host tool ALWAYS sees plugin userId),
 *   C. process.env / require / ambient globals are absent (empty vm ctx),
 *   D1. Yellow action without approval is denied by the gate,
 *   D2. Red action is hard-denied (declared or not),
 *   E. budget overrun is stopped mid-run,
 *   F1. hang is contained by wall-clock timeout,
 *   F2. throw is caught and reported (host never crashes),
 *   G. benign plugin end-to-end happy path (proves the sandbox actually WORKS).
 *   H. per-user registry isolation.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryApprovalTokenStore,
  mintApprovalToken,
  type AuditWriter,
  type EnforceDeps,
} from '@careeros/capability-gate';
import {
  benignResearchPlugin,
  budgetOverrunPlugin,
  crossUserPlugin,
  envExfiltrationPlugin,
  hangPlugin,
  InMemoryHostToolRegistry,
  InMemoryPluginRegistry,
  redActionPlugin,
  runPlugin,
  throwPlugin,
  undeclaredToolPlugin,
  yellowWithoutApprovalPlugin,
  type HostTool,
  type SandboxDeps,
} from '../src/plugins/index.js';

const SECRET = 's'.repeat(32);
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface AuditEntry {
  userId: string;
  actor: string;
  action: string;
  target?: string | null;
  reason: string;
  traceId?: string | null;
}

function makeHarness(): {
  deps: SandboxDeps;
  gateAudit: AuditEntry[];
  auditLog: AuditEntry[];
  hostTools: InMemoryHostToolRegistry;
  tokenStore: InMemoryApprovalTokenStore;
  hostToolCalls: Array<{ action: string; args: unknown; userId: string }>;
} {
  const auditLog: AuditEntry[] = [];
  const gateAudit: AuditEntry[] = auditLog; // shared: gate + sandbox both push here
  const tokenStore = new InMemoryApprovalTokenStore();
  const audit: AuditWriter = {
    append: (r) => {
      auditLog.push(r);
    },
  };
  const gateDeps: EnforceDeps = {
    secret: SECRET,
    tokenStore,
    audit,
  };
  const hostTools = new InMemoryHostToolRegistry();
  const hostToolCalls: Array<{ action: string; args: unknown; userId: string }> = [];

  // Register host tools the tests will use. Every host tool captures the
  // userId the sandbox passed to it — the cross-user test asserts this is
  // always the plugin's own userId.
  const researchRun: HostTool = {
    action: 'research.run',
    invoke: (args, meta) => {
      hostToolCalls.push({ action: 'research.run', args, userId: meta.userId });
      // Echo the userId the sandbox called us with — this is what the
      // cross-user test uses to prove the plugin can NEVER see anyone but
      // its own scope, no matter what it puts in `args`.
      return { summary: 'ok', count: 3, userId: meta.userId };
    },
  };
  const draftSend: HostTool = {
    action: 'draft.send',
    invoke: (args, meta) => {
      hostToolCalls.push({ action: 'draft.send', args, userId: meta.userId });
      return { sent: true };
    },
  };
  const meRead: HostTool = {
    action: 'me.read',
    invoke: (_args, meta) => {
      hostToolCalls.push({ action: 'me.read', args: _args, userId: meta.userId });
      // The tool ALWAYS returns the meta.userId it was invoked under — this is
      // the only "who am I" a real tool would see. If the sandbox ever passed
      // a different userId through, this response would reveal it.
      return { userId: meta.userId, secret: `data-for-${meta.userId}` };
    },
  };
  const offerAccept: HostTool = {
    action: 'offer.accept',
    invoke: (args, meta) => {
      hostToolCalls.push({ action: 'offer.accept', args, userId: meta.userId });
      return { accepted: true };
    },
  };
  hostTools.register(researchRun);
  hostTools.register(draftSend);
  hostTools.register(meRead);
  hostTools.register(offerAccept);

  return {
    deps: { gateDeps, hostTools, audit },
    gateAudit,
    auditLog,
    hostTools,
    tokenStore,
    hostToolCalls,
  };
}

function pluginDenied(auditLog: AuditEntry[], pluginId: string): AuditEntry[] {
  return auditLog.filter(
    (e) => e.action === 'plugin.denied' && (e.target === pluginId || e.target === null || e.target === undefined),
  );
}

describe('plugin sandbox — containment', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it('A. blocks a call to a tool NOT declared in the manifest, and audits it', async () => {
    const res = await runPlugin(
      { plugin: undeclaredToolPlugin, userId: USER_A, input: {} },
      h.deps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.code).toBe('undeclared_tool');
    // draft.send must never have been dispatched to the host — allowlist runs
    // BEFORE the gate/host tool.
    expect(h.hostToolCalls.find((c) => c.action === 'draft.send')).toBeUndefined();
    // Denial must be audited on the plugin's target.
    const denials = pluginDenied(h.auditLog, undeclaredToolPlugin.manifest.id);
    expect(denials.length).toBeGreaterThanOrEqual(1);
    expect(denials[0]?.reason).toMatch(/undeclared/);
  });

  it('B. host tool ALWAYS sees the plugin userId — cannot be tricked into acting on another user', async () => {
    const res = await runPlugin(
      { plugin: crossUserPlugin, userId: USER_A, input: { victimUserId: USER_B } },
      h.deps,
    );
    // The plugin declares research.run as Green, so the call itself is
    // allowed — what we're proving is the host NEVER sees USER_B. Even if
    // the sandbox (correctly) allowed the call, the userId handed to the
    // host must be USER_A (the plugin's own scope).
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    const readCalls = h.hostToolCalls.filter((c) => c.action === 'research.run');
    expect(readCalls.length).toBe(1);
    expect(readCalls[0]?.userId).toBe(USER_A);
    expect(readCalls[0]?.userId).not.toBe(USER_B);
    // And the tool's echoed userId (what the plugin gets back) is USER_A too.
    expect((res.output as { observedUserId: string }).observedUserId).toBe(USER_A);
  });

  it('C. plugin cannot reach process.env / require / globalThis.process — plugin_error, nothing leaked', async () => {
    const res = await runPlugin(
      { plugin: envExfiltrationPlugin, userId: USER_A, input: {} },
      h.deps,
    );
    // Every reference (process / require / globalThis.process) must be
    // undefined inside the fresh vm context. The plugin computes an empty
    // string and then FAILS output validation (outputSchema requires a
    // non-empty leaked string). Either way it must NOT succeed with any real
    // env data — a leak here would let a plugin read secrets.
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    // No leaked strings anywhere in the audit trail either.
    for (const entry of h.auditLog) {
      expect(entry.reason).not.toMatch(/AWS_|SECRET|PATH=/);
    }
  });

  it('D1. Yellow action without approval token is denied by the capability-gate', async () => {
    const res = await runPlugin(
      { plugin: yellowWithoutApprovalPlugin, userId: USER_A, input: {} },
      h.deps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.code).toBe('capability_denied');
    // draft.send never reached the host.
    expect(h.hostToolCalls.find((c) => c.action === 'draft.send')).toBeUndefined();
    // Both the gate AND the sandbox audited the denial.
    expect(h.auditLog.some((e) => e.action === 'capability_gate.denied')).toBe(true);
    expect(h.auditLog.some((e) => e.action === 'plugin.denied' && e.target === yellowWithoutApprovalPlugin.manifest.id)).toBe(true);
  });

  it('D1b. WITH a valid approval token, the same Yellow call is allowed and executes on the host', async () => {
    const args = { draftId: 'd-42', channel: 'email' };
    const token = await mintApprovalToken({
      userId: USER_A,
      action: 'draft.send',
      payload: args,
      ttlMs: 60_000,
      secret: SECRET,
      store: h.tokenStore,
    });
    const res = await runPlugin(
      {
        plugin: yellowWithoutApprovalPlugin,
        userId: USER_A,
        input: {},
        approvalTokens: { 'draft.send': token },
      },
      h.deps,
    );
    expect(res.ok).toBe(true);
    expect(h.hostToolCalls.find((c) => c.action === 'draft.send')?.userId).toBe(USER_A);
  });

  it('D2. Red action is hard-denied — no plugin can automate it, even by declaring it', async () => {
    const res = await runPlugin(
      { plugin: redActionPlugin, userId: USER_A, input: {} },
      h.deps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.code).toBe('capability_denied');
    // offer.accept never ran on the host.
    expect(h.hostToolCalls.find((c) => c.action === 'offer.accept')).toBeUndefined();
    // The gate's Red denial must be present in the audit trail.
    const gateDenials = h.auditLog.filter((e) => e.action === 'capability_gate.denied');
    expect(gateDenials.some((e) => /red/i.test(e.reason))).toBe(true);
  });

  it('E. plugin exceeding its declared tool-call budget is stopped mid-run', async () => {
    const res = await runPlugin(
      { plugin: budgetOverrunPlugin, userId: USER_A, input: {} },
      h.deps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.code).toBe('budget_exhausted');
    // Exactly `maxToolCalls` invocations reached the host, no more.
    const runs = h.hostToolCalls.filter((c) => c.action === 'research.run');
    expect(runs.length).toBe(budgetOverrunPlugin.manifest.budget.maxToolCalls);
    // Audit trail records the budget denial.
    expect(
      h.auditLog.some(
        (e) =>
          e.action === 'plugin.denied' &&
          e.target === budgetOverrunPlugin.manifest.id &&
          /budget/i.test(e.reason),
      ),
    ).toBe(true);
  });

  it('F1. a hanging plugin is stopped by the wall-clock timeout — host does NOT stall', async () => {
    const start = Date.now();
    const res = await runPlugin(
      { plugin: hangPlugin, userId: USER_A, input: {} },
      h.deps,
    );
    const elapsed = Date.now() - start;
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.code).toBe('timeout');
    // Budget of 100ms — allow generous slack for CI noise, but assert we did
    // NOT wait multiple seconds (i.e. the timeout actually fired).
    expect(elapsed).toBeLessThan(2000);
  });

  it('F2. a throwing plugin is captured — host receives a failure result, no propagation', async () => {
    // Nothing about this should reach an uncaught handler; the test would
    // fail with a rejected promise if runPlugin propagated the throw.
    const res = await runPlugin(
      { plugin: throwPlugin, userId: USER_A, input: {} },
      h.deps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.code).toBe('plugin_error');
    expect(res.reason).toMatch(/boom/);
  });

  it('G. benign reference plugin runs end-to-end within its declared permissions (happy path)', async () => {
    const res = await runPlugin(
      {
        plugin: benignResearchPlugin,
        userId: USER_A,
        input: { query: 'staff eng roles' },
      },
      h.deps,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.toolCalls).toBe(1);
    expect(res.output).toEqual({
      query: 'staff eng roles',
      summary: 'ok',
      resultCount: 3,
    });
    // One host call, under the right userId.
    expect(h.hostToolCalls).toEqual([
      { action: 'research.run', args: { query: 'staff eng roles' }, userId: USER_A },
    ]);
    // Success is audited.
    expect(
      h.auditLog.some(
        (e) => e.action === 'plugin.allowed' && e.target === benignResearchPlugin.manifest.id,
      ),
    ).toBe(true);
  });
});

describe('plugin registry — per-user isolation', () => {
  it('installs are scoped per user and never leak across users', async () => {
    const registry = new InMemoryPluginRegistry();
    await registry.install(USER_A, benignResearchPlugin);
    // USER_A sees it.
    const listA = await registry.list(USER_A);
    expect(listA.map((p) => p.manifest.id)).toEqual([benignResearchPlugin.manifest.id]);
    // USER_B never installed it → sees nothing.
    const listB = await registry.list(USER_B);
    expect(listB).toHaveLength(0);
    // Uninstall for A does not affect B (already empty), and idempotent.
    await registry.uninstall(USER_A, benignResearchPlugin.manifest.id);
    expect(await registry.list(USER_A)).toHaveLength(0);
  });

  it('rejects malformed manifests at install time (fail closed)', async () => {
    const registry = new InMemoryPluginRegistry();
    const bad = {
      ...benignResearchPlugin,
      manifest: { ...benignResearchPlugin.manifest, id: '' }, // invalid: empty id
    };
    await expect(registry.install(USER_A, bad)).rejects.toThrow(/manifest invalid/);
  });
});