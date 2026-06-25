import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorDetailDto {
  @ApiProperty({ example: 'ORDER_NOT_FOUND' })
  code!: string;

  @ApiProperty({ example: 'Order not found' })
  message!: string;
}

export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ type: ApiErrorDetailDto })
  error!: ApiErrorDetailDto;
}

export class ApiSuccessResponseDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ example: {}, description: 'Endpoint-specific payload' })
  data!: unknown;

  @ApiProperty({ example: 'Success' })
  message!: string;
}

export class HealthDataDto {
  @ApiProperty({ example: 'ok' })
  status!: string;

  @ApiProperty({ example: 'xyzz-backend' })
  service!: string;

  @ApiProperty({ example: '2026-06-09T12:00:00.000Z' })
  timestamp!: string;
}

export class HealthResponseDto extends ApiSuccessResponseDto {
  @ApiProperty({ type: HealthDataDto })
  declare data: HealthDataDto;
}

export class AuthUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Platform' })
  firstName!: string;

  @ApiProperty({ example: 'ADMIN' })
  role!: string;
}

export class LoginDataDto {
  @ApiProperty({ example: 'jwt-access-token' })
  accessToken!: string;

  @ApiProperty({ example: 'jwt-refresh-token' })
  refreshToken!: string;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

export class LoginResponseDto extends ApiSuccessResponseDto {
  @ApiProperty({ type: LoginDataDto })
  declare data: LoginDataDto;
}
