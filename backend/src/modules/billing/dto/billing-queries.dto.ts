import { InvoiceStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';

// billing api-design 08.
export class InvoiceQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsUUID()
  contractId?: string;

  @IsOptional()
  @IsIn(Object.values(InvoiceStatus))
  status?: InvoiceStatus;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  overdue?: boolean;
}

// billing api-design 14.
export class PaymentQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsUUID()
  contractId?: string;

  @IsOptional()
  @IsIn(Object.values(PaymentStatus))
  status?: PaymentStatus;
}

// billing api-design 13. More than the amount still due is the service's 400 OVERPAYMENT.
export class CounterPaymentDto {
  @IsIn([PaymentMethod.CASH, PaymentMethod.BANK_TRANSFER])
  method!: typeof PaymentMethod.CASH | typeof PaymentMethod.BANK_TRANSFER;

  @IsInt()
  @Min(1)
  amountVnd!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  reference!: string;
}

// billing api-design 11: one line, or by default every line due now.
export class SepayPaymentDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  lineSeq?: number;
}

// billing api-design 12, the SePay webhook body (docs.sepay.vn/tich-hop-webhooks.html). Every field
// SePay sends is declared, because the global pipe refuses unknown ones; billing reads id, the
// transfer type and amount, and the content. A missing or non-positive amount is 400 and records
// nothing (review of #92).
export class SepayWebhookDto {
  @IsNotEmpty()
  id!: number | string;

  @IsOptional()
  @IsString()
  gateway?: string;

  @IsOptional()
  @IsString()
  transactionDate?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  code?: string | null;

  @IsOptional()
  @IsString()
  content?: string | null;

  @IsOptional()
  @IsIn(['in', 'out'])
  transferType?: string;

  @IsInt()
  @Min(1)
  transferAmount!: number;

  @IsOptional()
  @IsNumber()
  accumulated?: number;

  @IsOptional()
  @IsString()
  subAccount?: string | null;

  @IsOptional()
  @IsString()
  referenceCode?: string;

  @IsOptional()
  @IsString()
  description?: string | null;
}
