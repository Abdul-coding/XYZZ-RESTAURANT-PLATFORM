import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min,
} from 'class-validator';
import {
  ComplaintStatus, PaymentIntentStatus,
} from '../generated/prisma/client';

export class AdminBranchQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID() branchId?: string;
}

export class AdminDateRangeQueryDto extends AdminBranchQueryDto {
  @ApiPropertyOptional({ example: '2026-10-17T00:00:00.000Z' })
  @IsOptional() @IsDateString() from?: string;

  @ApiPropertyOptional({ example: '2026-10-17T23:59:59.999Z' })
  @IsOptional() @IsDateString() to?: string;
}

export class AdminPageQueryDto extends AdminDateRangeQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;

  @ApiPropertyOptional({ example: 25, minimum: 1, maximum: 100, default: 25 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) size?: number;
}

export class AdminBillsQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ enum: PaymentIntentStatus })
  @IsOptional() @IsEnum(PaymentIntentStatus) status?: PaymentIntentStatus;
}

export class AdminComplaintsQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ enum: ComplaintStatus })
  @IsOptional() @IsEnum(ComplaintStatus) status?: ComplaintStatus;
}

export class AdminRatingsQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
}

export class SalesByItemQueryDto extends AdminDateRangeQueryDto {
  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 100, default: 10 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
