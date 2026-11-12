#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AuthorSchema, GameSchema } from '../src/index';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'json');

const entries = [
  { file: 'game.schema.json', name: 'Game', schema: GameSchema },
  { file: 'author.schema.json', name: 'Author', schema: AuthorSchema },
] as const;

mkdirSync(outDir, { recursive: true });

for (const { file, name, schema } of entries) {
  const jsonSchema = zodToJsonSchema(schema, { name, $refStrategy: 'none' });
  writeFileSync(path.join(outDir, file), `${JSON.stringify(jsonSchema, null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote packages/schema/json/${file}\n`);
}
