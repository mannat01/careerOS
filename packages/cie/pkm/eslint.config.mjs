import { base, agentBoundary } from '@careeros/config/eslint.preset.mjs';

export default [
  ...base,
  agentBoundary,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
];