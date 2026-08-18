import { IsISO8601, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";

export class PaymentWebhookDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,120}$/)
  providerEventId!: string;

  @IsIn(["payment.captured", "payment.refunded"])
  eventType!: "payment.captured" | "payment.refunded";

  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,120}$/)
  providerPaymentId!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,120}$/)
  providerRefundId?: string;

  @IsUUID()
  invoiceId!: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountMinor!: number;

  @IsIn(["INR"])
  currency!: string;

  @IsISO8601({ strict: true })
  @MaxLength(40)
  occurredAt!: string;
}
