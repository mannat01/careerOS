import { base } from '@careeros/config/eslint.preset.mjs';

export default [
  ...base,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
];
