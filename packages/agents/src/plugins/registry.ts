/**
 * Per-user plugin registry (M10).
 *
 * The registry records which plugins are INSTALLED for which user. It has
 * NO ambient authority itself — it only maps `(userId → PluginId[])` and
 * stores the manifest+source verbatim so the sandbox can execute it later.
 *
 * A plugin CANNOT be executed unless the invoking userId has it installed;
 * this stops "unregistered code" from being smuggled in by a caller bypassing
 * the registry.
 *
 * The in-memory implementation here is stub-quality: production wires a
 * Prisma-backed store (see database-schema.md follow-up). Both share the
 * same `PluginRegistry` interface so upstream callers do not care.
 */
import type { Plugin } from './types.js';
import { manifestShapeSchema } from './types.js';

export interface PluginRegistry {
  install(userId: string, plugin: Plugin): Promise<void>;
  uninstall(userId: string, pluginId: string): Promise<void>;
  list(userId: string): Promise<readonly Plugin[]>;
  get(userId: string, pluginId: string): Promise<Plugin | undefined>;
}

export class InMemoryPluginRegistry implements PluginRegistry {
  private readonly installs = new Map<string, Map<string, Plugin>>();

  install(userId: string, plugin: Plugin): Promise<void> {
    // Manifest hygiene — reject malformed manifests at install time so the
    // sandbox never has to defend against a nonsense budget or missing id.
    // Returns a Promise so validation failures reject uniformly (callers can
    // use `await` / `.rejects`) — even though the check itself is sync.
    const shape = manifestShapeSchema.safeParse(plugin.manifest);
    if (!shape.success) {
      return Promise.reject(new Error(`plugin manifest invalid: ${shape.error.message}`));
    }
    if (typeof plugin.source !== 'string' || plugin.source.length === 0) {
      return Promise.reject(new Error('plugin source must be a non-empty string'));
    }
    const bucket = this.installs.get(userId) ?? new Map<string, Plugin>();
    bucket.set(plugin.manifest.id, plugin);
    this.installs.set(userId, bucket);
    return Promise.resolve();
  }

  uninstall(userId: string, pluginId: string): Promise<void> {
    this.installs.get(userId)?.delete(pluginId);
    return Promise.resolve();
  }

  list(userId: string): Promise<readonly Plugin[]> {
    return Promise.resolve(Array.from(this.installs.get(userId)?.values() ?? []));
  }

  get(userId: string, pluginId: string): Promise<Plugin | undefined> {
    return Promise.resolve(this.installs.get(userId)?.get(pluginId));
  }
}

/**
 * Trivial in-memory host tool registry. Real bindings live in apps/api or
 * apps/workers where the concrete tool implementations exist; the sandbox
 * only needs `.get(name)`.
 */
import type { HostTool, HostToolRegistry } from './types.js';

export class InMemoryHostToolRegistry implements HostToolRegistry {
  private readonly tools = new Map<string, HostTool>();

  register(tool: HostTool): void {
    this.tools.set(tool.action, tool);
  }

  get(name: string): HostTool | undefined {
    return this.tools.get(name);
  }
}