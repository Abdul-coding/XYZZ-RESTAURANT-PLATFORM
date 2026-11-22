import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsInt,
  IsDateString, IsNumber, IsOptional, IsString, IsUrl, IsUUID, Max, Min, MinLength,
  ValidateNested,
} from 'class-validator';
import { CollectionMethod, OrderStatus, PaymentChannel, UserRole } from '../generated/prisma/client';

export class CreateBranchDto {
  @ApiProperty({ example: 'XYZZ-DEMO', minLength: 2 })
  @IsString() @MinLength(2) code!: string;

  @ApiProperty({ example: 'XYZZ Demo Branch', minLength: 2 })
  @IsString() @MinLength(2) name!: string;

  @ApiPropertyOptional({ example: 'Demo Address' })
  @IsOptional() @IsString() address?: string;
}
export class CreateTableDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() branchId!: string;

  @ApiProperty({ example: 4, minimum: 1 })
  @IsInt() @Min(1) tableNumber!: number;
}
export class CreateSessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() tableId!: string;
}
export class CreateCategoryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() branchId!: string;

  @ApiProperty({ example: 'Burgers' })
  @IsString() name!: string;

  @ApiPropertyOptional({ example: 1, default: 0 })
  @IsOptional() @IsInt() displayOrder?: number;
}
export class VariantDto {
  @ApiProperty({ example: 'Large' })
  @IsString() name!: string;

  @ApiProperty({ example: 160, minimum: 0 })
  @IsNumber() @Min(0) price!: number;
}
export class AddonDto {
  @ApiProperty({ example: 'Extra Cheese' })
  @IsString() name!: string;

  @ApiProperty({ example: 20, minimum: 0 })
  @IsNumber() @Min(0) price!: number;
}
export class AddonGroupDto {
  @ApiProperty({ example: 'Extras' })
  @IsString() name!: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional() @IsBoolean() isRequired?: boolean;

  @ApiPropertyOptional({ example: 0, minimum: 0, default: 0 })
  @IsOptional() @IsInt() @Min(0) minSelection?: number;

  @ApiPropertyOptional({ example: 2, minimum: 1, default: 1 })
  @IsOptional() @IsInt() @Min(1) maxSelection?: number;

  @ApiProperty({ type: [AddonDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => AddonDto) addons!: AddonDto[];
}
export class UpdateMenuItemAvailabilityDto {
  @ApiProperty({ example: false })
  @IsBoolean() isAvailable!: boolean;
}
export class UpdateMenuItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() categoryId!: string;

  @ApiProperty({ example: 'Chicken Burger' })
  @IsString() name!: string;

  @ApiPropertyOptional({ example: 'Grilled chicken patty with house sauce' })
  @IsOptional() @IsString() description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/images/chicken-burger.jpg' })
  @IsOptional() @IsUrl() imageUrl?: string;

  @ApiProperty({ example: 120, minimum: 0 })
  @IsNumber() @Min(0) basePrice!: number;

  @ApiPropertyOptional({ type: [VariantDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VariantDto)
  variants?: VariantDto[];

  @ApiPropertyOptional({ type: [AddonGroupDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AddonGroupDto)
  addonGroups?: AddonGroupDto[];
}
export class CreateMenuItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() branchId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID() categoryId!: string;

  @ApiProperty({ example: 'Chicken Burger' })
  @IsString() name!: string;

  @ApiPropertyOptional({ example: 'Grilled chicken patty with house sauce' })
  @IsOptional() @IsString() description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/images/chicken-burger.jpg' })
  @IsOptional() @IsUrl() imageUrl?: string;

  @ApiProperty({ example: 120, minimum: 0 })
  @IsNumber() @Min(0) basePrice!: number;

  @ApiPropertyOptional({ type: [VariantDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VariantDto)
  variants?: VariantDto[];

  @ApiPropertyOptional({ type: [AddonGroupDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AddonGroupDto)
  addonGroups?: AddonGroupDto[];
}
export class CartItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() menuItemId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID() variantId?: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 50 })
  @IsInt() @Min(1) @Max(50) quantity!: number;

  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 20 })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('4', { each: true }) addonIds?: string[];
}
export class CalculateCartDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() branchId!: string;

  @ApiProperty({ type: [CartItemDto], minItems: 1, maxItems: 50 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => CartItemDto) items!: CartItemDto[];
}
export class IdentifyCustomerDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() diningSessionId!: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional() @IsString() phone?: string;

  @ApiPropertyOptional({ example: 'alex@xyzz.com' })
  @IsOptional() @IsEmail() email?: string;

  @ApiPropertyOptional({ example: 'Alex' })
  @IsOptional() @IsString() name?: string;
}
export class CreatePaymentIntentDto extends CalculateCartDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() diningSessionId!: string;

  @ApiProperty({ enum: PaymentChannel, example: PaymentChannel.PAY_AT_TABLE })
  @IsEnum(PaymentChannel) channel!: PaymentChannel;
}
export class ConfirmPaymentIntentDto {
  @ApiProperty({ example: 'demo_pay_abc123', minLength: 4 })
  @IsString() @MinLength(4) paymentReference!: string;
}
export class CollectBillDto {
  @ApiProperty({ enum: CollectionMethod, example: CollectionMethod.CASH })
  @IsEnum(CollectionMethod) method!: CollectionMethod;
}
export class AssistedOrderDto extends CalculateCartDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() tableId!: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional() @IsString() phone?: string;

  @ApiPropertyOptional({ example: 'alex@xyzz.com' })
  @IsOptional() @IsEmail() email?: string;

  @ApiPropertyOptional({ example: 'Alex' })
  @IsOptional() @IsString() name?: string;

  @ApiProperty({ enum: CollectionMethod, example: CollectionMethod.CASH })
  @IsEnum(CollectionMethod) method!: CollectionMethod;
}
export class CreateOrderDto extends CalculateCartDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() diningSessionId!: string;

  @ApiProperty({ example: 'demo_pay_abc123', minLength: 4 })
  @IsString() @MinLength(4) paymentReference!: string;

  @ApiPropertyOptional({ example: 'DEMO', default: 'DEMO' })
  @IsOptional() @IsString() provider?: string;
}
export class RatingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() orderId!: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt() @Min(1) @Max(5) rating!: number;

  @ApiPropertyOptional({ example: 'Excellent service' })
  @IsOptional() @IsString() feedback?: string;
}
export class ComplaintDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() orderId!: string;

  @ApiProperty({ example: 'Food Quality' })
  @IsString() category!: string;

  @ApiProperty({ example: 'Burger was cold', minLength: 5 })
  @IsString() @MinLength(5) description!: string;
}
export class TipDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() orderId!: string;

  @ApiProperty({ example: 50, minimum: 1 })
  @IsNumber() @Min(1) amount!: number;
}
export class CreateUserDto {
  @ApiProperty({ example: 'Demo' })
  @IsString() firstName!: string;

  @ApiPropertyOptional({ example: 'Waiter' })
  @IsOptional() @IsString() lastName?: string;

  @ApiProperty({ example: 'waiter@xyzz.local' })
  @IsEmail() email!: string;

  @ApiProperty({ example: 'ChangeMe123!', minLength: 8 })
  @IsString() @MinLength(8) password!: string;

  @ApiProperty({ enum: UserRole, example: UserRole.WAITER })
  @IsEnum(UserRole) role!: UserRole;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID() branchId?: string;
}

export const STAFF_CANCEL_REASONS = [
  'Customer changed mind',
  'Item unavailable',
  'Kitchen issue',
  'Wrong order',
  'Duplicate order',
  'Other',
] as const;

export class CancelOrderDto {
  @ApiProperty({ enum: STAFF_CANCEL_REASONS, example: 'Customer changed mind' })
  @IsIn(STAFF_CANCEL_REASONS)
  reason!: (typeof STAFF_CANCEL_REASONS)[number];

  @ApiPropertyOptional({ example: 'Guest left before the food was served' })
  @IsOptional() @IsString() note?: string;
}

export class UpdateStaffStatusDto {
  @ApiProperty({ example: false })
  @IsBoolean() isActive!: boolean;
}

export class UpdateWaiterAssignmentDto {
  @ApiProperty({ enum: ['IDLE', 'OFFLINE'], description: 'IDLE marks the waiter available. OFFLINE takes them off the floor.' })
  @IsIn(['IDLE', 'OFFLINE'])
  waiterStatus!: 'IDLE' | 'OFFLINE';
}

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID() branchId?: string;

  @ApiPropertyOptional({ example: '2026-10-17T00:00:00.000Z' })
  @IsOptional() @IsDateString() from?: string;

  @ApiPropertyOptional({ example: '2026-10-17T23:59:59.999Z' })
  @IsOptional() @IsDateString() to?: string;

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;

  @ApiPropertyOptional({ example: 25, minimum: 1, maximum: 100, default: 25 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) size?: number;

  @ApiPropertyOptional({ example: true, description: 'Only orders with a partial or full refund.' })
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() refunded?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Only orders with an open complaint.' })
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() hasComplaint?: boolean;
}

export class ListStaffQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID() branchId?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional() @IsEnum(UserRole) role?: UserRole;

  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}
