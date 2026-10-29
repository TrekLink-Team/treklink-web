import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { SepayService } from './sepay.service';

// Guards run before DTO validation, so unauthenticated callers see no body-field errors.
@Injectable()
export class SepayWebhookGuard implements CanActivate {
  constructor(private readonly sepay: SepayService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    this.sepay.assertWebhookKey(request.headers.authorization);
    return true;
  }
}
