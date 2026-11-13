import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { ApiRateLimiter } from './modules/monitoring/api-rate-limiter';
import { OrgApiController } from './modules/monitoring/org-api.controller';
import { OrgApiService } from './modules/monitoring/org-api.service';
import {
  API_KEY_HEADER_NAME,
  API_KEY_SCHEME,
  ORG_API_DESCRIPTION,
  ORG_API_TAG,
} from './modules/monitoring/org-api.openapi';

// The public OpenAPI file of the organization API (`developer-docs/openapi/organization-api.json`).
// It is built from the annotated controllers alone, with their collaborators stubbed, so it needs no
// database, no broker and no environment. A new public controller is added to PUBLIC_CONTROLLERS and
// tagged `Organization API`; anything else stays out of the file.
const PUBLIC_CONTROLLERS = [OrgApiController];

@Module({
  controllers: PUBLIC_CONTROLLERS,
  providers: [
    { provide: OrgApiService, useValue: {} },
    { provide: ApiRateLimiter, useValue: {} },
  ],
})
class PublicApiDocumentModule {}

const hasPublicTag = (operation: unknown): boolean => {
  const tags = (operation as { tags?: unknown } | null)?.tags;
  return Array.isArray(tags) && tags.includes(ORG_API_TAG);
};

// Keeps only the operations tagged `Organization API`, and drops a path left with none.
export function publicOperations(document: OpenAPIObject): OpenAPIObject {
  const paths: OpenAPIObject['paths'] = {};
  for (const [path, item] of Object.entries(document.paths)) {
    const kept = Object.fromEntries(
      Object.entries(item).filter(([, operation]) => hasPublicTag(operation)),
    );
    if (Object.keys(kept).length > 0) paths[path] = kept;
  }
  return { ...document, paths };
}

// The routes are listed without the `/api` prefix of the backend, which the server entry carries, so a
// client composes the URL the backend serves: `<host>/api/telemetry/devices`.
export async function buildOrgApiDocument(): Promise<OpenAPIObject> {
  const app = await NestFactory.create(PublicApiDocumentModule, { logger: false });
  try {
    const config = new DocumentBuilder()
      .setTitle('TrekLink Organization API')
      .setDescription(ORG_API_DESCRIPTION)
      .setVersion('1.0')
      .addServer('/api')
      .addTag(ORG_API_TAG, 'Read-only endpoints for an organization API key.')
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: API_KEY_HEADER_NAME,
          description:
            'An organization API key. An Org Manager creates it on the API keys page; it is shown once.',
        },
        API_KEY_SCHEME,
      )
      .build();
    return publicOperations(SwaggerModule.createDocument(app, config));
  } finally {
    await app.close();
  }
}
