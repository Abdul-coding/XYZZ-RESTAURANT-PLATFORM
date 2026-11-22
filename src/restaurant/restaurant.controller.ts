import {
  Body, Controller, Get, Header, Headers, Inject, Param, Patch, Post, Query, Req, Sse,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiHeader,
  ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiSecurity, ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../generated/prisma/client';
import { Public, Roles } from '../auth/auth.decorators';
import { StaffRequest } from '../auth/jwt-auth.guard';
import { ApiErrorResponseDto, ApiSuccessResponseDto } from '../common/swagger.dto';
import {
  CalculateCartDto, CollectBillDto, ComplaintDto, ConfirmPaymentIntentDto,
  CreateBranchDto, CreateCategoryDto, CreateMenuItemDto, CreateOrderDto,
  CancelOrderDto, CreatePaymentIntentDto, CreateSessionDto, CreateTableDto, CreateUserDto, ListOrdersQueryDto, ListStaffQueryDto, UpdateStaffStatusDto, UpdateWaiterAssignmentDto,
  IdentifyCustomerDto, AssistedOrderDto, RatingDto, TipDto,
  UpdateMenuItemAvailabilityDto, UpdateMenuItemDto,
} from './restaurant.dto';
import { EVENT_STREAM_PROVIDER, EventStreamProvider } from './event-publisher';
import { RestaurantService } from './restaurant.service';
import { CustomerService } from './customer.service';
import { CheckoutService } from './checkout.service';

const token = (value?: string) => value;

@ApiTags('Restaurant Operations')
@Controller()
export class RestaurantController {
  constructor(
    private readonly service: RestaurantService,
    private readonly customers: CustomerService,
    private readonly checkout: CheckoutService,
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

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'List branch tables', description: 'Returns each table with the customer URL encoded in its printed QR.' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Get('admin/branches/:branchId/tables')
  listTables(@Param('branchId') branchId: string, @Req() req: StaffRequest) { return this.service.listTables(branchId, req.user!); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Download table QR image', description: 'PNG of https://<customer-app>/t/<qrToken> for printing on the table.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('image/png')
  @ApiOkResponse({ description: 'image/png' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Header('Cache-Control', 'private, no-store')
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Get('admin/tables/:id/qr.png')
  async tableQrPng(@Param('id') id: string) {
    const image = await this.service.tableQrImage(id);
    return new StreamableFile(image.png, {
      type: 'image/png',
      disposition: `inline; filename="${image.filename}"`,
    });
  }

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

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'List the full branch menu', description: 'Admin or branch manager sees every category and item, including ones hidden from customers.' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Get('admin/branches/:branchId/menu')
  adminMenu(@Param('branchId') branchId: string, @Req() req: StaffRequest) {
    return this.service.adminMenu(req.user!, branchId);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Update menu item', description: 'Admin or branch manager replaces the item details, variants, and add-on groups. Options already used by an order are retired instead of deleted.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateMenuItemDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Patch('admin/menu-items/:id')
  updateMenuItem(@Param('id') id: string, @Body() dto: UpdateMenuItemDto, @Req() req: StaffRequest) {
    return this.service.updateMenuItem(req.user!, id, dto);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Show or hide a menu item' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateMenuItemAvailabilityDto })
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Patch('admin/menu-items/:id/availability')
  setMenuItemAvailability(
    @Param('id') id: string,
    @Body() dto: UpdateMenuItemAvailabilityDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.setMenuItemAvailability(req.user!, id, dto.isAvailable);
  }

  @ApiOperation({ summary: 'Calculate cart totals', description: 'Calculates subtotal, tax snapshot, and grand total without persisting a cart.' })
  @ApiBody({ type: CalculateCartDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @Public() @Post('cart/calculate')
  calculate(@Body() dto: CalculateCartDto) { return this.service.calculateCart(dto); }

  @ApiOperation({ summary: 'Identify customer', description: 'Upserts a customer by phone/email and attaches them to the dining session before checkout.' })
  @ApiSecurity('session-token')
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @ApiBody({ type: IdentifyCustomerDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @Public() @Post('customers/identify')
  identify(@Body() dto: IdentifyCustomerDto, @Headers('x-session-token') value?: string) {
    return this.customers.identify(dto.diningSessionId, dto, token(value));
  }

  @ApiOperation({ summary: 'Create payment intent or pay-at-table bill' })
  @ApiSecurity('session-token')
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @ApiBody({ type: CreatePaymentIntentDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @Public() @Post('payment-intents')
  createIntent(@Body() dto: CreatePaymentIntentDto, @Headers('x-session-token') value?: string) {
    return this.checkout.createIntent(dto, token(value));
  }

  @ApiOperation({ summary: 'Confirm demo online payment and create the kitchen order' })
  @ApiSecurity('session-token')
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @ApiBody({ type: ConfirmPaymentIntentDto })
  @Public() @Post('payment-intents/:id/confirm')
  confirmIntent(
    @Param('id') id: string,
    @Body() dto: ConfirmPaymentIntentDto,
    @Headers('x-session-token') value?: string,
  ) {
    return this.checkout.confirmOnline(id, dto.paymentReference, token(value));
  }

  @ApiOperation({ summary: 'Cancel unpaid session bill' })
  @ApiSecurity('session-token')
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @Public() @Patch('bills/:id/cancel')
  cancelBill(@Param('id') id: string, @Headers('x-session-token') value?: string) {
    return this.checkout.cancelBill(id, { sessionToken: token(value) });
  }

  @ApiOperation({ summary: 'Create paid order', description: 'Requires identified customer + X-Session-Token. Demo path: demo_pay_* reference. Prefer POST /payment-intents.' })
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

  @ApiOperation({ summary: 'Cancel order within 60 seconds of payment', description: 'No auto refund. Manager/Admin refund separately.' })
  @ApiSecurity('session-token')
  @ApiHeader({ name: 'X-Session-Token', required: true })
  @Public() @Post('orders/:id/cancel')
  cancelOrder(@Param('id') id: string, @Headers('x-session-token') value?: string) {
    return this.service.cancelOrder(id, token(value));
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Staff cancel an order', description: 'Admin can cancel an order at any branch. A manager can cancel an order at their own branch. There is no time limit. Delivered or completed orders are refused. This does not refund the payment.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: CancelOrderDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Branches the signed-in staff member can use', description: 'Admins receive every active branch. Managers receive only the branches they are assigned to.' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Get('admin/me/branches')
  myBranches(@Req() req: StaffRequest) {
    return this.service.myBranches(req.user!);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'List orders', description: 'Paginated orders for a branch and time range. Admins may omit branchId to include every branch. Managers are limited to their own branches.' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Get('admin/orders')
  listOrders(@Query() query: ListOrdersQueryDto, @Req() req: StaffRequest) {
    return this.service.listOrders(req.user!, query);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Post('admin/orders/:id/cancel')
  adminCancelOrder(@Param('id') id: string, @Body() dto: CancelOrderDto, @Req() req: StaffRequest) {
    return this.service.adminCancelOrder(req.user!, id, dto);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get kitchen queue' })
  @ApiQuery({ name: 'branchId', format: 'uuid', required: true })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CHEF) @Get('kitchen/orders')
  kitchen(@Query('branchId') branchId: string, @Req() req: StaffRequest) { return this.service.kitchenQueue(branchId, req.user!); }

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
  @ApiOperation({ summary: 'List pay-at-table bills waiting for collection' })
  @Roles(UserRole.WAITER) @Get('waiters/me/pending-bills')
  pendingBills(@Req() req: StaffRequest) { return this.checkout.pendingBills(req.user!.sub); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Collect cash or card for a pay-at-table bill and send it to the kitchen' })
  @ApiBody({ type: CollectBillDto })
  @Roles(UserRole.WAITER) @Patch('bills/:id/collect')
  collectBill(@Param('id') id: string, @Body() dto: CollectBillDto, @Req() req: StaffRequest) {
    return this.checkout.collectBill(id, req.user!.sub, dto.method);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Waiter cancels an unpaid collection bill' })
  @Roles(UserRole.WAITER) @Patch('waiters/me/bills/:id/cancel')
  waiterCancelBill(@Param('id') id: string, @Req() req: StaffRequest) {
    return this.checkout.cancelBill(id, { waiterId: req.user!.sub });
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Idle waiter places an assisted cash/card order for a customer' })
  @ApiBody({ type: AssistedOrderDto })
  @Roles(UserRole.WAITER) @Post('waiter/assisted-orders')
  assisted(@Body() dto: AssistedOrderDto, @Req() req: StaffRequest) {
    return this.checkout.assistedOrder(req.user!.sub, dto);
  }

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
  @ApiOperation({ summary: 'List staff users', description: 'Admins see every account, including the stored temporary password. Managers see staff assigned to their branches and do not receive passwords.' })
  @ApiQuery({ name: 'branchId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'role', required: false, enum: UserRole })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive'] })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Get('admin/users')
  listUsers(@Query() query: ListStaffQueryDto, @Req() req: StaffRequest) {
    return this.service.listUsers(req.user!, query);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Activate or deactivate a staff account', description: 'Admin only. A deactivated account cannot sign in. An admin cannot deactivate themselves.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateStaffStatusDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN) @Patch('admin/users/:id')
  setStaffActive(@Param('id') id: string, @Body() dto: UpdateStaffStatusDto, @Req() req: StaffRequest) {
    return this.service.setStaffActive(req.user!.sub, id, dto.isActive);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Create staff user', description: 'Admin-only staff user creation endpoint.' })
  @ApiBody({ type: CreateUserDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN) @Post('admin/users')
  createUser(@Body() dto: CreateUserDto) { return this.service.createUser(dto); }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Issue a new temporary password', description: 'Admin only. Replaces the sign-in password and stores the new temporary password so it can be revealed from the staff list. Accounts created before this field existed have no stored password to recover.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN) @Post('admin/users/:id/temporary-password')
  issueTemporaryPassword(@Param('id') id: string, @Req() req: StaffRequest) {
    return this.service.issueTemporaryPassword(req.user!.sub, id);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'List waiter status for a branch', description: 'Active waiters assigned to the branch, with open orders and pending bills. Admins can request any branch. Managers can request only their own.' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Get('admin/branches/:branchId/waiters')
  listBranchWaiters(@Param('branchId') branchId: string, @Req() req: StaffRequest) {
    return this.service.listBranchWaiters(req.user!, branchId);
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Set a waiter available or offline', description: 'IDLE returns the waiter to the floor. If they still have open orders they stay engaged. OFFLINE stops new assignments.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateWaiterAssignmentDto })
  @ApiOkResponse({ type: ApiSuccessResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Patch('admin/staff-assignments/:id')
  setWaiterStatus(@Param('id') id: string, @Body() dto: UpdateWaiterAssignmentDto, @Req() req: StaffRequest) {
    return this.service.setWaiterStatus(req.user!, id, dto.waiterStatus);
  }

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
