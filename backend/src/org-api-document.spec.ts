import type { OpenAPIObject } from '@nestjs/swagger';
import { buildOrgApiDocument, publicOperations } from './org-api-document';

describe('the public organization API document', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await buildOrgApiDocument();
  });

  it('holds exactly the two organization API operations, under the /api server', () => {
    const operations = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(operations.sort()).toEqual(['GET /telemetry/devices', 'GET /telemetry/stream']);
    expect(document.servers).toEqual([{ url: '/api' }]);
  });

  it('names the X-Api-Key header as the only security scheme and requires it on both routes', () => {
    expect(Object.keys(document.components?.securitySchemes ?? {})).toEqual(['apiKey']);
    expect(document.components?.securitySchemes?.apiKey).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-Api-Key',
    });
    for (const item of Object.values(document.paths)) {
      expect(item.get?.security).toEqual([{ apiKey: [] }]);
    }
  });

  it('documents the success envelope and the error responses of each route', () => {
    const devices = document.paths['/telemetry/devices'].get;
    const stream = document.paths['/telemetry/stream'].get;
    expect(Object.keys(devices?.responses ?? {})).toEqual(['200', '401', '403', '429']);
    expect(Object.keys(stream?.responses ?? {})).toEqual([
      '200',
      '400',
      '401',
      '403',
      '410',
      '429',
    ]);
    expect(stream?.parameters).toEqual([
      expect.objectContaining({ name: 'after', in: 'query', required: true }),
      expect.objectContaining({ name: 'limit', in: 'query', required: false }),
    ]);
  });

  it('drops an operation that is not tagged Organization API', () => {
    const mixed = {
      ...document,
      paths: {
        ...document.paths,
        '/internal/thing': { get: { tags: ['Internal'], responses: {} } },
        '/mixed': {
          get: { tags: ['Internal'], responses: {} },
          post: { tags: ['Organization API'], responses: {} },
        },
      },
    } as OpenAPIObject;
    const paths = publicOperations(mixed).paths;
    expect(Object.keys(paths)).not.toContain('/internal/thing');
    expect(Object.keys(paths['/mixed'])).toEqual(['post']);
  });
});
