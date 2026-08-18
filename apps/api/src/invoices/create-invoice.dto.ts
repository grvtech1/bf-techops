import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";

export class CreateInvoiceLineDto {
  @IsString()
  @MaxLength(240)
  description!: string;

  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity!: number;

  @IsInt()
  @Min(0)
  @Max(100_000_000)
  unitPriceMinor!: number;
}

export class CreateInvoiceDto {
  @IsUUID()
  storeId!: string;

  @IsString()
  @MaxLength(160)
  customerName!: string;

  @IsEmail()
  @MaxLength(254)
  customerContact!: string;

  @IsOptional()
  @IsIn(["INR"])
  currency: string = "INR";

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  discountMinor: number = 0;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  taxRateBasisPoints: number = 0;

  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  items!: CreateInvoiceLineDto[];
}

