import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException,
  NotImplementedException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DiningSessionStatus, OrderItemStatus, OrderStatus, PaymentStatus,
  Prisma, TableStatus, UserRole, WaiterStatus,
} from '../generated/prisma/client';
import { Decimal, PrismaClientKnownRequestError } from '@prisma/client-runtime-utils';
import { hash } from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import {
  CalculateCartDto, ComplaintDto, CreateBranchDto, CreateCategoryDto,
  CreateMenuItemDto, CreateOrderDto, CreateSessionDto, CreateTableDto,
  CreateUserDto, RatingDto, TipDto,
} from './restaurant.dto';
import { AuditLogService } from './audit-log.service';
import { EVENT_PUBLISHER, EventPublisher } from './event-publisher';
import { WaiterAssignmentService } from './waiter-assignment.service';

const money = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(2);

@Injectable()
export class RestaurantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogService,
    private readonly waiterAssignment: WaiterAssignmentService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  listBranches() {
    return this.prisma.branch.findMany({ where: { isActive: true, deletedAt: null } });
  }
  branch(id: string) {
    return this.prisma.branch.findFirstOrThrow({ where: { id, deletedAt: null } });
  }
  createBranch(dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: { ...dto, code: dto.code.toUpperCase() } });
  }
  async createTable(dto: CreateTableDto) {
    return this.prisma.restaurantTable.create({
      data: { ...dto, qrToken: `TBL_${randomBytes(24).toString('base64url')}` },
    });
  }
  table(id: string) {
    return this.prisma.restaurantTable.findFirstOrThrow({
      where: { id, deletedAt: null }, include: { branch: true },
    });
  }
  async scanQr(qrToken: string) {
    const table = await this.prisma.restaurantTable.findUnique({
      where: { qrToken }, include: { branch: true },
    });
    if (!table || table.deletedAt || !table.branch.isActive) throw new NotFoundException('Invalid QR code');
    const activeSession = await this.prisma.diningSession.findFirst({
      where: { tableId: table.id, status: DiningSessionStatus.ACTIVE },
      select: { id: true, status: true, sessionToken: true },
    });
    return {
      branch: { id: table.branch.id, name: table.branch.name },
      table: { id: table.id, number: table.tableNumber },
      activeSession,
    };
  }
  async createSession(dto: CreateSessionDto) {
    return this.prisma.$transaction(async (tx) => {
      const table = await tx.restaurantTable.findUnique({ where: { id: dto.tableId } });
      if (!table || table.deletedAt || table.status === TableStatus.OUT_OF_SERVICE) {
        throw new NotFoundException('Table unavailable');
      }
      const existing = await tx.diningSession.findFirst({
        where: { tableId: dto.tableId, status: DiningSessionStatus.ACTIVE },
      });
      if (existing) return existing;
      const session = await tx.diningSession.create({
        data: {
          tableId: table.id,
          branchId: table.branchId,
          sessionToken: `DST_${randomBytes(32).toString('base64url')}`,
        },
      });
      await tx.restaurantTable.update({
        where: { id: table.id }, data: { status: TableStatus.OCCUPIED },
      });
      return session;
    });
  }
  async requireSession(sessionId: string, token?: string) {
    const session = await this.prisma.diningSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException({ code: 'SESSION_NOT_FOUND', message: 'Session not found' });
    if (!token || token !== session.sessionToken || session.status !== DiningSessionStatus.ACTIVE) {
      throw new UnauthorizedException('Valid active X-Session-Token required');
    }
    await this.prisma.diningSession.update({
      where: { id: session.id }, data: { lastActiveAt: new Date() },
    });
    return session;
  }
  session(id: string, token?: string) {
    return this.requireSession(id, token);
  }
  async closeSession(id: string, token?: string) {
    await this.requireSession(id, token);
    const openOrders = await this.prisma.order.count({
      where: { diningSessionId: id, status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] } },
    });
    if (openOrders) throw new ConflictException('All orders must be completed before closing');
    const session = await this.prisma.$transaction(async (tx) => {
      const closed = await tx.diningSession.update({
        where: { id }, data: { status: DiningSessionStatus.COMPLETED, endedAt: new Date() },
      });
      await tx.restaurantTable.update({
        where: { id: closed.tableId }, data: { status: TableStatus.AVAILABLE },
      });
      await this.audit.record({
        action: 'SESSION_COMPLETED',
        resourceType: 'DiningSession',
        resourceId: closed.id,
        metadata: { tableId: closed.tableId, branchId: closed.branchId },
      }, tx);
      return closed;
    });
    this.events.publish(`session:${id}`, 'session.completed', { sessionId: id });
    return session;
  }
  menu(branchId: string) {
    return this.prisma.menuCategory.findMany({
      where: { branchId, isActive: true, deletedAt: null },
      orderBy: { displayOrder: 'asc' },
      include: {
        items: {
          where: { isAvailable: true, deletedAt: null },
          orderBy: { displayOrder: 'asc' },
          include: { variants: true, addonGroups: { include: { addons: true } } },
        },
      },
    });
  }
  menuItem(id: string) {
    return this.prisma.menuItem.findFirstOrThrow({
      where: { id, deletedAt: null },
      include: { variants: true, addonGroups: { include: { addons: true } } },
    });
  }
  createCategory(dto: CreateCategoryDto) {
    return this.prisma.menuCategory.create({ data: dto });
  }
  createMenuItem(dto: CreateMenuItemDto) {
    const { variants, addonGroups, ...item } = dto;
    return this.prisma.menuItem.create({
      data: {
        ...item,
        variants: variants?.length ? { create: variants } : undefined,
        addonGroups: addonGroups?.length ? {
          create: addonGroups.map(({ addons, ...group }) => ({
            ...group, addons: { create: addons },
          })),
        } : undefined,
      },
      include: { variants: true, addonGroups: { include: { addons: true } } },
    });
  }
  async calculateCart(dto: CalculateCartDto) {
    const ids = [...new Set(dto.items.map((item) => item.menuItemId))];
    const records = await this.prisma.menuItem.findMany({
      where: { id: { in: ids }, branchId: dto.branchId, isAvailable: true, deletedAt: null },
      include: { variants: true, addonGroups: { include: { addons: true } } },
    });
    if (records.length !== ids.length) {
      throw new BadRequestException({ code: 'ITEM_NOT_AVAILABLE', message: 'One or more items are unavailable' });
    }
    const indexed = new Map(records.map((item) => [item.id, item]));
    const lines = dto.items.map((requested) => {
      const item = indexed.get(requested.menuItemId)!;
      const variant = requested.variantId
        ? item.variants.find((entry) => entry.id === requested.variantId && entry.isAvailable)
        : undefined;
      if (requested.variantId && !variant) throw new BadRequestException('Invalid variant');
      const addonPool = item.addonGroups.flatMap((group) => group.addons.map((addon) => ({ ...addon, group })));
      const addons = (requested.addonIds ?? []).map((id) => {
        const addon = addonPool.find((entry) => entry.id === id && entry.isAvailable);
        if (!addon) throw new BadRequestException('Invalid add-on');
        return addon;
      });
      for (const group of item.addonGroups) {
        const count = addons.filter((addon) => addon.addonGroupId === group.id).length;
        if (count < group.minSelection || count > group.maxSelection) {
          throw new BadRequestException(`Select ${group.minSelection}-${group.maxSelection} options for ${group.name}`);
        }
      }
      const unitPrice = money(variant?.price ?? item.basePrice).add(
        addons.reduce((sum, addon) => sum.add(addon.price), money(0)),
      );
      return {
        requested, item, variant, addons, unitPrice,
        lineTotal: unitPrice.mul(requested.quantity),
      };
    });
    const subtotal = lines.reduce((sum, line) => sum.add(line.lineTotal), money(0));
    const tax = await this.prisma.taxConfiguration.findFirst({
      where: {
        isActive: true,
        OR: [{ branchId: dto.branchId }, { branchId: null }],
        validFrom: { lte: new Date() },
        AND: [{ OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] }],
      },
      orderBy: [{ branchId: 'desc' }, { validFrom: 'desc' }],
    });
    const taxPercentage = tax?.percentage ?? money(0);
    const taxAmount = subtotal.mul(taxPercentage).div(100).toDecimalPlaces(2);
    return { lines, subtotal, taxPercentage, taxAmount, total: subtotal.add(taxAmount) };
  }
  private verifyPayment(reference: string) {
    if (this.config.get('PAYMENT_DEMO_MODE', 'false') === 'true' && reference.startsWith('demo_pay_')) return;
    throw new NotImplementedException(
      'Configure a signed Razorpay/Stripe webhook before disabling PAYMENT_DEMO_MODE',
    );
  }
  async createOrder(dto: CreateOrderDto, token?: string) {
    const session = await this.requireSession(dto.diningSessionId, token);
    if (session.branchId !== dto.branchId) throw new BadRequestException('Branch/session mismatch');
    this.verifyPayment(dto.paymentReference);
    const cart = await this.calculateCart(dto);
    const order = await this.prisma.$transaction(async (tx) => {
      try {
        const waiter = await this.waiterAssignment.assignWaiter(session.branchId, tx);
        const created = await tx.order.create({
          data: {
            diningSessionId: session.id,
            waiterId: waiter?.userId,
            orderNumber: `ORD-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
            subtotalAmount: cart.subtotal,
            taxPercentage: cart.taxPercentage,
            taxAmount: cart.taxAmount,
            totalAmount: cart.total,
            items: {
              create: cart.lines.map((line) => ({
                menuItemId: line.item.id,
                variantId: line.variant?.id,
                itemName: line.item.name,
                variantName: line.variant?.name,
                quantity: line.requested.quantity,
                unitPrice: line.unitPrice,
                lineTotal: line.lineTotal,
                addons: {
                  create: line.addons.map((addon) => ({
                    addonId: addon.id, addonName: addon.name, addonPrice: addon.price,
                  })),
                },
              })),
            },
            payments: {
              create: {
                provider: dto.provider ?? 'DEMO',
                providerReference: dto.paymentReference,
                amount: cart.total,
                status: PaymentStatus.SUCCESS,
                paidAt: new Date(),
              },
            },
          },
          include: { items: { include: { addons: true } }, payments: true },
        });
        await tx.diningSession.update({
          where: { id: session.id }, data: { totalSpend: { increment: cart.total } },
        });
        await this.audit.record({
          action: 'ORDER_CREATED',
          resourceType: 'Order',
          resourceId: created.id,
          metadata: {
            diningSessionId: session.id,
            waiterId: waiter?.userId ?? null,
            totalAmount: created.totalAmount.toString(),
          },
        }, tx);
        return created;
      } catch (error) {
        if (this.isProviderReferenceConflict(error)) {
          throw new ConflictException({
            code: 'PAYMENT_ALREADY_PROCESSED',
            message: 'Payment already processed',
          });
        }
        throw error;
      }
    });
    this.events.publish(`kitchen:${session.branchId}`, 'order.created', order);
    if (order.waiterId) this.events.publish(`waiter:${order.waiterId}`, 'order.assigned', order);
    this.events.publish(`session:${session.id}`, 'order.created', order);
    return order;
  }

  private isProviderReferenceConflict(error: unknown) {
    return error instanceof PrismaClientKnownRequestError
      && error.code === 'P2002'
      && Array.isArray(error.meta?.target)
      && error.meta.target.includes('providerReference');
  }
  async order(id: string, token?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id }, include: { items: { include: { addons: true } }, payments: true },
    });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    await this.requireSession(order.diningSessionId, token);
    return order;
  }
  async sessionOrders(sessionId: string, token?: string) {
    await this.requireSession(sessionId, token);
    return this.prisma.order.findMany({
      where: { diningSessionId: sessionId }, include: { items: true }, orderBy: { createdAt: 'desc' },
    });
  }
  kitchenQueue(branchId: string) {
    return this.prisma.order.findMany({
      where: {
        diningSession: { branchId },
        status: { in: [OrderStatus.ORDER_PLACED, OrderStatus.PREPARING] },
      },
      include: { items: true, diningSession: { include: { table: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }
  async startOrder(orderId: string) {
    const order = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.PREPARING, preparingStartedAt: new Date() },
      });
      await this.audit.record({
        action: 'ORDER_PREPARING',
        resourceType: 'Order',
        resourceId: updated.id,
        metadata: { diningSessionId: updated.diningSessionId },
      }, tx);
      return updated;
    });
    this.events.publish(`session:${order.diningSessionId}`, 'order.preparing', order);
    return order;
  }
  async markReady(itemId: string) {
    const item = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.orderItem.update({
        where: { id: itemId }, data: { status: OrderItemStatus.READY, readyAt: new Date() },
        include: { order: true },
      });
      await this.audit.record({
        action: 'ITEM_READY',
        resourceType: 'OrderItem',
        resourceId: updated.id,
        metadata: { orderId: updated.orderId, diningSessionId: updated.order.diningSessionId },
      }, tx);
      return updated;
    });
    this.events.publish(`session:${item.order.diningSessionId}`, 'order_item.ready', item);
    if (item.order.waiterId) this.events.publish(`waiter:${item.order.waiterId}`, 'order_item.ready', item);
    return item;
  }
  assignedOrders(waiterId: string) {
    return this.prisma.order.findMany({
      where: { waiterId, status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] } },
      include: { items: true, diningSession: { include: { table: true } } },
    });
  }
  readyItems(waiterId: string) {
    return this.prisma.orderItem.findMany({
      where: { order: { waiterId }, status: OrderItemStatus.READY },
      include: { order: { include: { diningSession: { include: { table: true } } } } },
    });
  }
  async deliverItem(itemId: string, waiterId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const found = await tx.orderItem.findUnique({
        where: { id: itemId },
        include: { order: { include: { diningSession: true } } },
      });
      if (!found || found.order.waiterId !== waiterId || found.status !== OrderItemStatus.READY) {
        throw new BadRequestException('Item is not ready or is assigned to another waiter');
      }
      const item = await tx.orderItem.update({
        where: { id: itemId }, data: { status: OrderItemStatus.DELIVERED, deliveredAt: new Date() },
        include: { order: true },
      });
      await this.audit.record({
        actorId: waiterId,
        action: 'ITEM_DELIVERED',
        resourceType: 'OrderItem',
        resourceId: item.id,
        metadata: { orderId: item.orderId, diningSessionId: item.order.diningSessionId },
      }, tx);
      const remaining = await tx.orderItem.count({
        where: { orderId: found.orderId, status: { not: OrderItemStatus.DELIVERED } },
      });
      let completedOrder = null;
      if (!remaining) {
        completedOrder = await tx.order.update({
          where: { id: found.orderId }, data: { status: OrderStatus.COMPLETED, completedAt: new Date() },
        });
        await this.waiterAssignment.releaseWaiter(waiterId, found.order.diningSession.branchId, tx);
        await this.audit.record({
          actorId: waiterId,
          action: 'ORDER_COMPLETED',
          resourceType: 'Order',
          resourceId: completedOrder.id,
          metadata: { diningSessionId: completedOrder.diningSessionId },
        }, tx);
      }
      return { item, completedOrder };
    });
    const item = result.item;
    this.events.publish(`session:${item.order.diningSessionId}`, 'order_item.delivered', item);
    if (result.completedOrder) {
      this.events.publish(`session:${result.completedOrder.diningSessionId}`, 'order.completed', result.completedOrder);
    }
    return item;
  }
  async rating(dto: RatingDto, token?: string) {
    await this.authorizeOrder(dto.orderId, token);
    return this.prisma.rating.create({ data: dto });
  }
  async complaint(dto: ComplaintDto, token?: string) {
    await this.authorizeOrder(dto.orderId, token);
    return this.prisma.complaint.create({ data: dto });
  }
  async tip(dto: TipDto, token?: string) {
    const order = await this.authorizeOrder(dto.orderId, token);
    if (!order.waiterId) throw new BadRequestException('No waiter assigned');
    return this.prisma.tip.create({ data: { ...dto, waiterId: order.waiterId } });
  }
  private async authorizeOrder(orderId: string, token?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    await this.requireSession(order.diningSessionId, token);
    return order;
  }
  async createUser(dto: CreateUserDto) {
    const { password, branchId, ...user } = dto;
    return this.prisma.user.create({
      data: {
        ...user,
        passwordHash: await hash(password, 12),
        assignments: branchId ? {
          create: {
            branchId,
            waiterStatus: dto.role === UserRole.WAITER ? WaiterStatus.IDLE : undefined,
            lastIdleAt: dto.role === UserRole.WAITER ? new Date() : undefined,
          },
        } : undefined,
      },
      select: { id: true, email: true, firstName: true, role: true },
    });
  }

  async validateStaffBranch(userId: string, branchId: string) {
    const assignment = await this.prisma.staffAssignment.findUnique({
      where: { userId_branchId: { userId, branchId } },
      include: { user: true },
    });
    if (!assignment || !assignment.user.isActive || assignment.user.deletedAt) {
      throw new UnauthorizedException('Staff member is not assigned to this branch');
    }
    return assignment;
  }
}
