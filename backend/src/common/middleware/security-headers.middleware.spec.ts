import { securityHeadersMiddleware } from './security-headers.middleware';

const run = (url: string) => {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = String(value);
    },
    removeHeader: (name: string) => {
      delete headers[name.toLowerCase()];
    },
  };
  const next = jest.fn();
  securityHeadersMiddleware({ url, originalUrl: url } as never, res as never, next);
  expect(next).toHaveBeenCalledWith();
  return headers;
};

describe('securityHeadersMiddleware (M1)', () => {
  it('sets the baseline security headers and a deny-all policy on an API response', () => {
    const headers = run('/api/devices');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['strict-transport-security']).toMatch(/max-age=/);
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(headers['content-security-policy']).toContain("default-src 'none'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-powered-by']).toBeUndefined();
  });

  it('leaves the Swagger UI page without the deny-all policy', () => {
    for (const url of ['/api/docs', '/api/docs/', '/api/docs/swagger-ui-init.js']) {
      const headers = run(url);
      expect(headers['content-security-policy']).toBeUndefined();
      expect(headers['x-content-type-options']).toBe('nosniff');
    }
    expect(run('/api/docsx')['content-security-policy']).toBeDefined();
  });
});
