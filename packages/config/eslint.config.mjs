import { base, allowEnv } from './eslint.preset.mjs';

export default [
  { ignores: ['eslint.preset.mjs'] },
  ...base,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  allowEnv,
];
