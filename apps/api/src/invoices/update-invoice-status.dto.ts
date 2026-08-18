import { IsIn, IsInt, Min } from "class-validator";

export class UpdateInvoiceStatusDto {
  @IsIn(["PAID", "CANCELLED"])
  status!: "PAID" | "CANCELLED";

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

