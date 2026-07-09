// Offline schema validation using the same WASM validator the Prisma CLI embeds.
// Used because sandboxed/CI environments may not reach binaries.prisma.sh for the
// native engines that `prisma validate` insists on downloading first.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wasm = require('@prisma/prisma-schema-wasm');

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '../prisma/schema.prisma');
const schema = readFileSync(schemaPath, 'utf8');
const params = JSON.stringify({ prismaSchema: [['prisma/schema.prisma', schema]], noColor: true });

try {
  wasm.validate(params);
  console.log('prisma schema: VALID');
} catch (err) {
  console.error('prisma schema: INVALID');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
