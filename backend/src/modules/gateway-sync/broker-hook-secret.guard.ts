import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { BrokerAuthService } from './broker-hooks.service';

// The broker hooks are public to the JWT guard and gated by MQTT_AUTH_HOOK_SECRET instead (api-design
// 01 and 02). Guards run before body validation, so a caller without the secret learns nothing about
// the body; with the variable unset the routes answer 404.
@Injectable()
export class BrokerHookSecretGuard implements CanActivate {
  constructor(private readonly brokerAuth: BrokerAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    this.brokerAuth.assertSecret(request.headers['x-broker-secret']);
    return true;
  }
}
