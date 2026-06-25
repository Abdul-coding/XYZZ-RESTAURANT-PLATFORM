import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsEnum, IsInt,
  IsNumber, IsOptional, IsString, IsUrl, IsUUID, Max, Min, MinLength,
  ValidateNested,
} from 'class-validator';
import { UserRole } from '../generated/prisma/client';

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
