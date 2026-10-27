import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  Caller,
  CheckPolicies,
  CurrentCaller,
  Public,
} from '../../common/decorators/access.decorator';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SepayPaymentDto } from './dto/billing-queries.dto';
import { toPaymentView } from './invoices.controller';
import { PaymentRow } from './payments.repository';
import { SepayService, SepayWebhook } from './sepay.service';

// SePay sandbox endpoints (billing task 3.2, api-design 11, 12, 15). The webhook is the one
// @RawResponse() route of the application (D-038): SePay expects `{ "success": true }`.
@Controller()
export class SepayController {
  constructor(private readonly sepay: SepayService) {}

  private async view(payment: PaymentRow) {
    return { ...toPaymentView(payment), vietQr: await this.sepay.vietQr(payment) };
  }

  // Org Manager (own, `payment.payOnline.own`).
  @Post('invoices/:id/payments/sepay')
  @CheckPolicies((ability) => ability.can('payOnline', 'Invoice'))
  @ResponseMessage('Scan the QR code to pay (sandbox).')
  async request(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SepayPaymentDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.view(await this.sepay.request(id, dto.lineSeq, caller));
  }

  // The payment page polls this until CONFIRMED (MSG20) or EXPIRED (MSG25).
  @Get('payments/:id')
  @CheckPolicies((ability) => ability.can('read', 'Payment'))
  @ResponseMessage('OK')
  async find(@Param('id', ParseUUIDPipe) id: string, @CurrentCaller() caller: Caller) {
    return this.view(await this.sepay.find(id, caller));
  }

  @Post('payments/sepay/webhook')
  @Public()
  @RawResponse()
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Headers('authorization') authorization: string | undefined,
    @Body() hook: SepayWebhook,
  ): Promise<{ success: true }> {
    await this.sepay.handleWebhook(authorization, hook);
    return { success: true };
  }
}
