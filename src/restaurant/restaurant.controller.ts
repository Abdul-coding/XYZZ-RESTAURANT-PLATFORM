import {
  Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Req, Sse,
} from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiHeader,
  ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../generated/prisma/client';
import { Public, Roles } from '../auth/auth.decorators';
import { StaffRequest } from '../auth/jwt-auth.guard';
import { ApiErrorResponseDto, ApiSuccessResponseDto } from '../common/swagger.dto';
import {
  CalculateCartDto, ComplaintDto, CreateBranchDto, CreateCategoryDto,
  CreateMenuItemDto, CreateOrderDto, CreateSessionDto, CreateTableDto,
  CreateUserDto, RatingDto, TipDto,
} from './restaurant.dto';
import { EVENT_STREAM_PROVIDER, EventStreamProvider } from './event-publisher';
import { RestaurantService } from './restaurant.service';

const token = (value?: string) => value;

@ApiTags('Restaurant Operations')
@Controller()
export class RestaurantController {
  constructor(
    private readonly service: RestaurantService,
    @Inject(EVENT_STREAM_PROVIDER) private readonly events: EventStreamProvider,
  ) {}

  @Public()
  @ApiOperation({ summary: 'List active branches' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @Get('branches') branches() { return this.service.listBranches(); }

  @Public()
  @ApiOperation({ summary: 'Get branch details' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @Get('branches/:id') branch(@Param('id') id: string) { return this.service.branch(id); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Create branch', description: 'Admin-only branch creation endpoint.' })
  @ApiBody({ type: CreateBranchDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN) @Post('admin/branches')
  createBranch(@Body() dto: CreateBranchDto) { return this.service.createBranch(dto); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get table details' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @Get('tables/:id') table(@Param('id') id: string) { return this.service.table(id); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Create restaurant table', description: 'Creates a table and generates its QR token.' })
  @ApiBody({ type: CreateTableDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Post('admin/tables')
  createTable(@Body() dto: CreateTableDto) { return this.service.createTable(dto); }

  @ApiOperation({ summary: 'Scan table QR token', description: 'Returns branch, table, and any active dining session for a QR token.' })
  @ApiParam({ name: 'qrToken', example: 'TBL_abc123' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @Public() @Get('table-session/:qrToken')
  scan(@Param('qrToken') qrToken: string) { return this.service.scanQr(qrToken); }

  @ApiOperation({ summary: 'Create dining session', description: 'Creates or returns the active session for a table.' })
  @ApiBody({ type: CreateSessionDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @Public() @Post('dining-sessions')
  createSession(@Body() dto: CreateSessionDto) { return this.service.createSession(dto); }

  @ApiOperation({ summary: 'Get dining session', description: 'Requires the anonymous customer session token.' })
  @ApiSecurity('session-token')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'X-Session-Token', required: true, description: 'Anonymous dining session token' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @Public() @Get('dining-sessions/:id')
  session(@Param('id') id: string, @Headers('x-session-token') value?: string) {
    return this.service.session(id, token(value));
  }

  @ApiOperation({ summary: 'Close dining session', description: 'Allowed only when all session orders are completed or cancelled.' })
  @ApiSecurity('session-token')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @Public() @Patch('dining-sessions/:id/close')
  closeSession(@Param('id') id: string, @Headers('x-session-token') value?: string) {
    return this.service.closeSession(id, token(value));
  }

  @ApiOperation({ summary: 'List orders in a dining session' })
  @ApiSecurity('session-token')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @Public() @Get('dining-sessions/:id/orders')
  sessionOrders(@Param('id') id: string, @Headers('x-session-token') value?: string) {
    return this.service.sessionOrders(id, token(value));
  }

  @ApiOperation({ summary: 'Get branch menu', description: 'Returns categories, available items, variants, and add-ons.' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @Public() @Get('menu/:branchId')
  menu(@Param('branchId') branchId: string) { return this.service.menu(branchId); }

  @ApiOperation({ summary: 'Get menu item details' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @Public() @Get('menu/items/:id')
  menuItem(@Param('id') id: string) { return this.service.menuItem(id); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Create menu category' })
  @ApiBody({ type: CreateCategoryDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Post('admin/menu-categories')
  createCategory(@Body() dto: CreateCategoryDto) { return this.service.createCategory(dto); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Create menu item', description: 'Creates a branch-specific menu item with variants and add-on groups.' })
  @ApiBody({ type: CreateMenuItemDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Post('admin/menu-items')
  createMenuItem(@Body() dto: CreateMenuItemDto) { return this.service.createMenuItem(dto); }

  @ApiOperation({ summary: 'Calculate cart totals', description: 'Calculates subtotal, tax snapshot, and grand total without persisting a cart.' })
  @ApiBody({ type: CalculateCartDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @Public() @Post('cart/calculate')
  calculate(@Body() dto: CalculateCartDto) { return this.service.calculateCart(dto); }

  @ApiOperation({ summary: 'Create paid order', description: 'Requires X-Session-Token. Creates order only after server-side payment verification/demo reference validation.' })
  @ApiSecurity('session-token')
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @ApiBody({ type: CreateOrderDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @Public() @Post('orders')
  createOrder(@Body() dto: CreateOrderDto, @Headers('x-session-token') value?: string) {
    return this.service.createOrder(dto, token(value));
  }

  @ApiOperation({ summary: 'Get order details' })
  @ApiSecurity('session-token')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @Public() @Get('orders/:id')
  order(@Param('id') id: string, @Headers('x-session-token') value?: string) {
    return this.service.order(id, token(value));
  }

  @ApiOperation({ summary: 'Get customer order tracking', description: 'Returns order and item-level status for customer tracking.' })
  @ApiSecurity('session-token')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @Public() @Get('orders/:id/tracking')
  tracking(@Param('id') id: string, @Headers('x-session-token') value?: string) {
    return this.service.order(id, token(value));
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get kitchen queue' })
  @ApiQuery({ name: 'branchId', format: 'uuid', required: true })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CHEF) @Get('kitchen/orders')
  kitchen(@Query('branchId') branchId: string) { return this.service.kitchenQueue(branchId); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Start preparing order', description: 'Chef-only transition from ORDER_PLACED to PREPARING.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.CHEF) @Patch('kitchen/orders/:id/start')
  start(@Param('id') id: string) { return this.service.startOrder(id); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Mark order item ready', description: 'Chef-only item-level READY transition.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.CHEF) @Patch('kitchen/order-items/:id/ready')
  ready(@Param('id') id: string) { return this.service.markReady(id); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get current waiter assigned orders' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.WAITER) @Get('waiters/me/orders')
  waiterOrders(@Req() req: StaffRequest) { return this.service.assignedOrders(req.user!.sub); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get current waiter ready items' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.WAITER) @Get('waiters/me/ready-items')
  readyItems(@Req() req: StaffRequest) { return this.service.readyItems(req.user!.sub); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Deliver ready item', description: 'Waiter-only item-level DELIVERED transition.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.WAITER) @Patch('order-items/:id/deliver')
  deliver(@Param('id') id: string, @Req() req: StaffRequest) {
    return this.service.deliverItem(id, req.user!.sub);
  }

  @ApiOperation({ summary: 'Submit order rating' })
  @ApiSecurity('session-token')
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @ApiBody({ type: RatingDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @Public() @Post('ratings')
  rating(@Body() dto: RatingDto, @Headers('x-session-token') value?: string) {
    return this.service.rating(dto, token(value));
  }

  @ApiOperation({ summary: 'Submit complaint' })
  @ApiSecurity('session-token')
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @ApiBody({ type: ComplaintDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @Public() @Post('complaints')
  complaint(@Body() dto: ComplaintDto, @Headers('x-session-token') value?: string) {
    return this.service.complaint(dto, token(value));
  }

  @ApiOperation({ summary: 'Submit waiter tip' })
  @ApiSecurity('session-token')
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @ApiBody({ type: TipDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @Public() @Post('tips')
  tip(@Body() dto: TipDto, @Headers('x-session-token') value?: string) {
    return this.service.tip(dto, token(value));
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Create staff user', description: 'Admin-only staff user creation endpoint.' })
  @ApiBody({ type: CreateUserDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN) @Post('admin/users')
  createUser(@Body() dto: CreateUserDto) { return this.service.createUser(dto); }

  @ApiOperation({ summary: 'Customer SSE event stream', description: 'Server-Sent Events stream for a dining session.' })
  @ApiSecurity('session-token')
  @ApiParam({ name: 'sessionId', format: 'uuid' })
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @ApiOkResponse({ description: 'text/event-stream' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @Public() @Sse('events/customer/:sessionId')
  async customerEvents(
    @Param('sessionId') id: string,
    @Headers('x-session-token') value?: string,
  ) {
    await this.service.requireSession(id, token(value));
    return this.events.stream(`session:${id}`);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Waiter SSE event stream', description: 'Server-Sent Events stream for the authenticated waiter.' })
  @ApiOkResponse({ description: 'text/event-stream' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.WAITER) @Sse('events/waiter')
  waiterEvents(@Req() req: StaffRequest) { return this.events.stream(`waiter:${req.user!.sub}`); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Kitchen SSE event stream', description: 'Server-Sent Events stream for a branch kitchen. Chef must belong to the branch.' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiOkResponse({ description: 'text/event-stream' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.CHEF) @Sse('events/kitchen/:branchId')
  async kitchenEvents(@Param('branchId') id: string, @Req() req: StaffRequest) {
    await this.service.validateStaffBranch(req.user!.sub, id);
    return this.events.stream(`kitchen:${id}`);
  }
}
