import {
  Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Req, Sse,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Public, Roles } from '../auth/auth.decorators';
import { StaffRequest } from '../auth/jwt-auth.guard';
import {
  CalculateCartDto, ComplaintDto, CreateBranchDto, CreateCategoryDto,
  CreateMenuItemDto, CreateOrderDto, CreateSessionDto, CreateTableDto,
  CreateUserDto, RatingDto, TipDto,
} from './restaurant.dto';
import { EVENT_STREAM_PROVIDER, EventStreamProvider } from './event-publisher';
import { RestaurantService } from './restaurant.service';

const token = (value?: string) => value;

@Controller()
export class RestaurantController {
  constructor(
    private readonly service: RestaurantService,
    @Inject(EVENT_STREAM_PROVIDER) private readonly events: EventStreamProvider,
  ) {}

  @Public() @Get('branches') branches() { return this.service.listBranches(); }
  @Public() @Get('branches/:id') branch(@Param('id') id: string) { return this.service.branch(id); }
  @Roles(UserRole.ADMIN) @Post('admin/branches')
  createBranch(@Body() dto: CreateBranchDto) { return this.service.createBranch(dto); }

  @Get('tables/:id') table(@Param('id') id: string) { return this.service.table(id); }
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Post('admin/tables')
  createTable(@Body() dto: CreateTableDto) { return this.service.createTable(dto); }
  @Public() @Get('table-session/:qrToken')
  scan(@Param('qrToken') qrToken: string) { return this.service.scanQr(qrToken); }

  @Public() @Post('dining-sessions')
  createSession(@Body() dto: CreateSessionDto) { return this.service.createSession(dto); }
  @Public() @Get('dining-sessions/:id')
  session(@Param('id') id: string, @Headers('x-session-token') value?: string) {
    return this.service.session(id, token(value));
  }
  @Public() @Patch('dining-sessions/:id/close')
  closeSession(@Param('id') id: string, @Headers('x-session-token') value?: string) {
    return this.service.closeSession(id, token(value));
  }
  @Public() @Get('dining-sessions/:id/orders')
  sessionOrders(@Param('id') id: string, @Headers('x-session-token') value?: string) {
    return this.service.sessionOrders(id, token(value));
  }

  @Public() @Get('menu/:branchId')
  menu(@Param('branchId') branchId: string) { return this.service.menu(branchId); }
  @Public() @Get('menu/items/:id')
  menuItem(@Param('id') id: string) { return this.service.menuItem(id); }
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Post('admin/menu-categories')
  createCategory(@Body() dto: CreateCategoryDto) { return this.service.createCategory(dto); }
  @Roles(UserRole.ADMIN, UserRole.MANAGER) @Post('admin/menu-items')
  createMenuItem(@Body() dto: CreateMenuItemDto) { return this.service.createMenuItem(dto); }

  @Public() @Post('cart/calculate')
  calculate(@Body() dto: CalculateCartDto) { return this.service.calculateCart(dto); }
  @Public() @Post('orders')
  createOrder(@Body() dto: CreateOrderDto, @Headers('x-session-token') value?: string) {
    return this.service.createOrder(dto, token(value));
  }
  @Public() @Get('orders/:id')
  order(@Param('id') id: string, @Headers('x-session-token') value?: string) {
    return this.service.order(id, token(value));
  }
  @Public() @Get('orders/:id/tracking')
  tracking(@Param('id') id: string, @Headers('x-session-token') value?: string) {
    return this.service.order(id, token(value));
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CHEF) @Get('kitchen/orders')
  kitchen(@Query('branchId') branchId: string) { return this.service.kitchenQueue(branchId); }
  @Roles(UserRole.CHEF) @Patch('kitchen/orders/:id/start')
  start(@Param('id') id: string) { return this.service.startOrder(id); }
  @Roles(UserRole.CHEF) @Patch('kitchen/order-items/:id/ready')
  ready(@Param('id') id: string) { return this.service.markReady(id); }

  @Roles(UserRole.WAITER) @Get('waiters/me/orders')
  waiterOrders(@Req() req: StaffRequest) { return this.service.assignedOrders(req.user!.sub); }
  @Roles(UserRole.WAITER) @Get('waiters/me/ready-items')
  readyItems(@Req() req: StaffRequest) { return this.service.readyItems(req.user!.sub); }
  @Roles(UserRole.WAITER) @Patch('order-items/:id/deliver')
  deliver(@Param('id') id: string, @Req() req: StaffRequest) {
    return this.service.deliverItem(id, req.user!.sub);
  }

  @Public() @Post('ratings')
  rating(@Body() dto: RatingDto, @Headers('x-session-token') value?: string) {
    return this.service.rating(dto, token(value));
  }
  @Public() @Post('complaints')
  complaint(@Body() dto: ComplaintDto, @Headers('x-session-token') value?: string) {
    return this.service.complaint(dto, token(value));
  }
  @Public() @Post('tips')
  tip(@Body() dto: TipDto, @Headers('x-session-token') value?: string) {
    return this.service.tip(dto, token(value));
  }
  @Roles(UserRole.ADMIN) @Post('admin/users')
  createUser(@Body() dto: CreateUserDto) { return this.service.createUser(dto); }

  @Public() @Sse('events/customer/:sessionId')
  async customerEvents(
    @Param('sessionId') id: string,
    @Headers('x-session-token') value?: string,
  ) {
    await this.service.requireSession(id, token(value));
    return this.events.stream(`session:${id}`);
  }
  @Roles(UserRole.WAITER) @Sse('events/waiter')
  waiterEvents(@Req() req: StaffRequest) { return this.events.stream(`waiter:${req.user!.sub}`); }
  @Roles(UserRole.CHEF) @Sse('events/kitchen/:branchId')
  async kitchenEvents(@Param('branchId') id: string, @Req() req: StaffRequest) {
    await this.service.validateStaffBranch(req.user!.sub, id);
    return this.events.stream(`kitchen:${id}`);
  }
}
