import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsEnum, IsInt,
  IsNumber, IsOptional, IsString, IsUrl, IsUUID, Max, Min, MinLength,
  ValidateNested,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateBranchDto {
  @IsString() @MinLength(2) code!: string;
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() address?: string;
}
export class CreateTableDto {
  @IsUUID() branchId!: string;
  @IsInt() @Min(1) tableNumber!: number;
}
export class CreateSessionDto { @IsUUID() tableId!: string; }
export class CreateCategoryDto {
  @IsUUID() branchId!: string;
  @IsString() name!: string;
  @IsOptional() @IsInt() displayOrder?: number;
}
export class VariantDto {
  @IsString() name!: string;
  @IsNumber() @Min(0) price!: number;
}
export class AddonDto {
  @IsString() name!: string;
  @IsNumber() @Min(0) price!: number;
}
export class AddonGroupDto {
  @IsString() name!: string;
  @IsOptional() @IsBoolean() isRequired?: boolean;
  @IsOptional() @IsInt() @Min(0) minSelection?: number;
  @IsOptional() @IsInt() @Min(1) maxSelection?: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => AddonDto) addons!: AddonDto[];
}
export class CreateMenuItemDto {
  @IsUUID() branchId!: string;
  @IsUUID() categoryId!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUrl() imageUrl?: string;
  @IsNumber() @Min(0) basePrice!: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VariantDto)
  variants?: VariantDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AddonGroupDto)
  addonGroups?: AddonGroupDto[];
}
export class CartItemDto {
  @IsUUID() menuItemId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsInt() @Min(1) @Max(50) quantity!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('4', { each: true }) addonIds?: string[];
}
export class CalculateCartDto {
  @IsUUID() branchId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => CartItemDto) items!: CartItemDto[];
}
export class CreateOrderDto extends CalculateCartDto {
  @IsUUID() diningSessionId!: string;
  @IsString() @MinLength(4) paymentReference!: string;
  @IsOptional() @IsString() provider?: string;
}
export class RatingDto {
  @IsUUID() orderId!: string;
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() feedback?: string;
}
export class ComplaintDto {
  @IsUUID() orderId!: string;
  @IsString() category!: string;
  @IsString() @MinLength(5) description!: string;
}
export class TipDto {
  @IsUUID() orderId!: string;
  @IsNumber() @Min(1) amount!: number;
}
export class CreateUserDto {
  @IsString() firstName!: string;
  @IsOptional() @IsString() lastName?: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsEnum(UserRole) role!: UserRole;
  @IsOptional() @IsUUID() branchId?: string;
}
