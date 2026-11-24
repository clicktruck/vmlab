// Writes the JSON Schemas in schema/ from the zod schemas (`just schema`). A test fails when they differ.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './paths.ts';
import { jsonSchemas } from './schema.ts';

for (const [file, schema] of Object.entries(jsonSchemas())) {
  const target = path.join(repoRoot(), 'schema', file);
  await writeFile(target, `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote schema/${file}`);
}
