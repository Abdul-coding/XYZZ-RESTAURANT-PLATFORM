import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './auth/auth.decorators';
import { HealthResponseDto } from './common/swagger.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Public()
  @ApiOperation({ summary: 'Health check', description: 'Confirms that the XYZZ backend process is responding.' })
  @ApiOkResponse({ type: HealthResponseDto })
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'xyzz-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
