import { Request, Response } from 'express';
import { currentRequestId } from '../context/request-context';
import { requestIdMiddleware, resolveRequestId } from './request-id.middleware';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('keeps a plain caller-supplied id', () => {
    expect(resolveRequestId('demo-req_0001.a')).toBe('demo-req_0001.a');
  });

  it('takes the first of repeated headers', () => {
    expect(resolveRequestId(['first-id', 'second-id'])).toBe('first-id');
  });

  it.each([undefined, '', 'has space', 'line\nbreak', 'x'.repeat(129)])(
    'generates a UUID for %p',
    (incoming) => {
      expect(resolveRequestId(incoming)).toMatch(UUID);
    },
  );
});

describe('requestIdMiddleware', () => {
  it('sets the response header and runs the rest of the request inside the context', () => {
    const setHeader = jest.fn();
    const req = { headers: { 'x-request-id': 'demo-req-0002' } } as unknown as Request;
    const res = { setHeader } as unknown as Response;
    let seen: string | undefined;

    requestIdMiddleware(req, res, () => {
      seen = currentRequestId();
    });

    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'demo-req-0002');
    expect(seen).toBe('demo-req-0002');
    expect(currentRequestId()).toBeUndefined();
  });
});
