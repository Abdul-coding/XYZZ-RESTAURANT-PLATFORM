import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/auth.decorators';
import { StaffRequest } from '../auth/jwt-auth.guard';
import { ApiErrorResponseDto, ApiSuccessResponseDto } from '../common/swagger.dto';
import { UserRole } from '../generated/prisma/client';
import {
  AdminBillsQueryDto, AdminComplaintsQueryDto, AdminDateRangeQueryDto,
  AdminPageQueryDto, AdminRatingsQueryDto, SalesByItemQueryDto,
} from './admin-dashboard.dto';
import { AdminDashboardService } from './admin-dashboard.service';

@ApiTags('Admin Dashboard')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('admin')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @ApiOperation({ summary: 'Dashboard overview metrics' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @Get('reports/overview')
  overview(@Query() query: AdminDateRangeQueryDto, @Req() req: StaffRequest) {
    return this.dashboard.overview(req.user!, query);
  }

  @ApiOperation({ summary: 'Top-selling menu items' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @Get('reports/sales-by-item')
  salesByItem(@Query() query: SalesByItemQueryDto, @Req() req: StaffRequest) {
    return this.dashboard.salesByItem(req.user!, query);
  }

  @ApiOperation({ summary: 'List payment intents and pending table bills' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @Get('bills')
  bills(@Query() query: AdminBillsQueryDto, @Req() req: StaffRequest) {
    return this.dashboard.bills(req.user!, query);
  }

  @ApiOperation({ summary: 'List customer complaints' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @Get('complaints')
  complaints(@Query() query: AdminComplaintsQueryDto, @Req() req: StaffRequest) {
    return this.dashboard.complaints(req.user!, query);
  }

  @ApiOperation({ summary: 'List refunded payments' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @Get('refunds')
  refunds(@Query() query: AdminPageQueryDto, @Req() req: StaffRequest) {
    return this.dashboard.refunds(req.user!, query);
  }

  @ApiOperation({ summary: 'List ratings with average and distribution' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @Get('ratings')
  ratings(@Query() query: AdminRatingsQueryDto, @Req() req: StaffRequest) {
    return this.dashboard.ratings(req.user!, query);
  }
}
