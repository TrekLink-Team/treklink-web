// Writes the public OpenAPI file of the organization API. Run from the repository root:
//   npm --prefix backend run openapi:export
// Output: developer-docs/openapi/organization-api.json (override with the first argument).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildOrgApiDocument } from '../src/org-api-document';

const DEFAULT_OUTPUT = resolve(__dirname, '../../developer-docs/openapi/organization-api.json');

async function main(): Promise<void> {
  const output = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUTPUT;
  const document = await buildOrgApiDocument();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`wrote ${output}: ${Object.keys(document.paths).length} paths`);
}

void main().catch((error: unknown) => {
  console.error('OpenAPI export failed', error);
  process.exit(1);
});
