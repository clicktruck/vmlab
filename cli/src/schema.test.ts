import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { paths } from './fixtures.ts';
import { jsonSchemas } from './schema.ts';

test('the published JSON Schemas in schema/ are what the code makes (run `just schema` if this fails)', async () => {
  const made = jsonSchemas();
  for (const [file, schema] of Object.entries(made)) {
    const onDisk = JSON.parse(await readFile(path.join(paths.root, 'schema', file), 'utf8'));
    assert.deepEqual(onDisk, JSON.parse(JSON.stringify(schema)), `schema/${file} is out of date`);
  }
  const files = (await readdir(path.join(paths.root, 'schema'))).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files, Object.keys(made).sort(), 'schema/ holds exactly the published schemas');
});
