import { base } from '@careeros/config/eslint.preset.mjs';

export default [
  { ignores: ['scripts/**', 'prisma/**'] },
  ...base,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
];
