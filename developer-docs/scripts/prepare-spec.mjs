// Writes openapi/organization-api.site.json, the copy the reference pages are generated from. With
// DOCS_SITE_URL set (deploy.sh passes https://<host name>), the server becomes `<DOCS_SITE_URL>/api`, so
// the curl, Python and Node samples carry the full URL and run when copied. Without it the committed
// relative server `/api` is kept, which suits a local preview.
import { readFileSync, writeFileSync } from 'node:fs';

const source = new URL('../openapi/organization-api.json', import.meta.url);
const target = new URL('../openapi/organization-api.site.json', import.meta.url);
const spec = JSON.parse(readFileSync(source, 'utf8'));
const site = (process.env.DOCS_SITE_URL ?? '').replace(/\/+$/, '');
if (site !== '') {
  if (!/^https?:\/\/[^/\s]+$/.test(site)) {
    throw new Error(`DOCS_SITE_URL must be an origin such as https://example.com, got "${site}"`);
  }
  spec.servers = (spec.servers ?? [{ url: '/api' }]).map((server) =>
    server.url.startsWith('/') ? { ...server, url: `${site}${server.url}` } : server,
  );
}
writeFileSync(target, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`organization-api.site.json: server ${spec.servers.map((server) => server.url).join(', ')}`);
