/**
 * Public surface of the plugin platform. Kept flat so downstream callers do
 * not need to reach into subpaths.
 */
export {
  manifestShapeSchema,
  type DeclaredTool,
  type HostTool,
  type HostToolRegistry,
  type Plugin,
  type PluginContext,
  type PluginFailureCode,
  type PluginManifest,
  type PluginRunResult,
} from './types.js';
export {
  runPlugin,
  type RunPluginInput,
  type SandboxDeps,
} from './sandbox.js';
export {
  InMemoryHostToolRegistry,
  InMemoryPluginRegistry,
  type PluginRegistry,
} from './registry.js';
export { benignResearchPlugin } from './reference/benign-research.js';
export {
  budgetOverrunPlugin,
  crossUserPlugin,
  envExfiltrationPlugin,
  hangPlugin,
  redActionPlugin,
  throwPlugin,
  undeclaredToolPlugin,
  yellowWithoutApprovalPlugin,
} from './reference/escape-attempts.js';