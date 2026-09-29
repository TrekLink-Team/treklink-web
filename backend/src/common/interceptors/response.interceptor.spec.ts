import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { ResponseMessage } from '../decorators/response-message.decorator';
import { DEFAULT_SUCCESS_MESSAGE, ResponseInterceptor } from './response.interceptor';

// Handlers are only used as metadata targets, never called, so they take `this: void`.
class SampleController {
  @ResponseMessage('Healthy')
  declared(this: void): void {}

  undeclared(this: void): void {}
}

@ResponseMessage('Class message')
class AnnotatedController {
  handler(this: void): void {}
}

const contextFor = (
  controller: new () => object,
  handler: (...args: never[]) => unknown,
  statusCode = 200,
): ExecutionContext =>
  ({
    switchToHttp: () => ({ getResponse: () => ({ statusCode }) }),
    getHandler: () => handler,
    getClass: () => controller,
  }) as unknown as ExecutionContext;

const run = (context: ExecutionContext, data: unknown) => {
  const next: CallHandler = { handle: () => of(data) };
  return lastValueFrom(new ResponseInterceptor(new Reflector()).intercept(context, next));
};

describe('ResponseInterceptor', () => {
  it('wraps the handler result in the D-002 envelope with the declared message (AC-01)', async () => {
    const context = contextFor(SampleController, SampleController.prototype.declared);

    await expect(run(context, { a: 1 })).resolves.toEqual({
      result: { a: 1 },
      isSuccess: true,
      statusCode: 200,
      message: 'Healthy',
    });
  });

  it('falls back to the default message when the endpoint declares none', async () => {
    const context = contextFor(SampleController, SampleController.prototype.undeclared);

    await expect(run(context, { a: 1 })).resolves.toMatchObject({
      message: DEFAULT_SUCCESS_MESSAGE,
    });
  });

  it('reads a message declared on the controller class', async () => {
    const context = contextFor(AnnotatedController, AnnotatedController.prototype.handler);

    await expect(run(context, null)).resolves.toMatchObject({ message: 'Class message' });
  });

  it('turns an undefined result into null and copies the response status code', async () => {
    const context = contextFor(SampleController, SampleController.prototype.undeclared, 201);

    await expect(run(context, undefined)).resolves.toEqual({
      result: null,
      isSuccess: true,
      statusCode: 201,
      message: DEFAULT_SUCCESS_MESSAGE,
    });
  });
});
