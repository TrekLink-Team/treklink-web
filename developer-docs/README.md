# TrekLink developer docs

The public documentation of the organization API, a Docusaurus 3 site served at `/developers/` of the
TrekLink host (`deploy/aws`). It is its own npm project: it is not a workspace of the root `package.json`,
so installing the app and the app's CI do not touch it.

| Path | Holds |
|---|---|
| `docs/*.md` | The hand-written pages: introduction, authentication, envelope and errors, rate limits, reading the stream |
| `openapi/organization-api.json` | The OpenAPI file of the two organization API routes. Generated and committed; do not edit by hand |
| `docs/reference/` | The reference pages generated from that file. Git-ignored |
| `docusaurus.config.ts`, `sidebars.ts` | Site configuration. `baseUrl` is `/developers/` |
| `plugins/` | A small webpack fix for the openapi-docs packages, with the reason in the file |

## Regenerate the OpenAPI file

The file is built from the `@Api*` annotations of `backend/src/modules/monitoring/org-api.controller.ts` and
`org-api.openapi.ts`. Run it from the repository root after `npm ci` and `npm --prefix backend run prisma:generate`.
It needs no database and no environment:

```bash
npm --prefix backend run openapi:export
```

Only operations tagged `Organization API` are written, with the relative server `/api`. CI runs the same
command and fails when `git diff` shows a change, so commit the file whenever a controller annotation
changes.

## Build and preview

```bash
cd developer-docs
npm ci --ignore-scripts
npm run build
npm run serve
```

`npm run build` runs `npm run gen` first, which regenerates `docs/reference/` from the OpenAPI file, then
`docusaurus build` into `build/`. `npm run serve` serves it at `http://localhost:3000/developers/`.
`npm start` runs the dev server with hot reload. The "try it" panel of the reference calls `/api/...` on the
same host, so it works on the deployed site and not on a local preview unless a backend answers on that
origin.

The site makes no request to another host: no analytics, no web fonts, no CDN, and the search index is
built at build time and searched in the browser. Set `NO_UPDATE_NOTIFIER=1` to silence the npm update check.

## Deploy

`deploy/aws/host/deploy.sh` builds this folder in a Node container after the web app and publishes it for
Caddy. See "Developer docs" in `deploy/aws/RUNBOOK.md`.

## Dependency notes

- `plugins/openapi-babel-source-type.ts` is needed because Docusaurus's Babel rule rewrites the CommonJS
  files of the openapi-docs packages into a mix of `import` and `exports`, and the reference pages then fail
  in the browser with "exports is not defined". Without it the client build also fails on webpack 5.112 with
  "Cannot get final name for export '__esModule'". Remove it only after a build and a page load of the
  reference pages confirm that a newer openapi-docs release no longer needs it.
