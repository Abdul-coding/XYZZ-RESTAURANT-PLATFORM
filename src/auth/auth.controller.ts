import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto, LoginResponseDto } from '../common/swagger.dto';
import { Public } from './auth.decorators';
import { LoginDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @ApiOperation({ summary: 'Staff login', description: 'Authenticates restaurant staff and returns JWT access and refresh tokens.' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
}
