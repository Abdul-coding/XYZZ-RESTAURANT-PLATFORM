import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
  NotImplementedException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DiningSessionStatus, OrderItemStatus, OrderStatus, PaymentIntentStatus, PaymentStatus,
  Prisma, TableStatus, UserRole, WaiterStatus, CancelSource,
} from '../generated/prisma/client';
import { Decimal, PrismaClientKnownRequestError } from '@prisma/client-runtime-utils';
import { hash } from 'bcrypt';
import { randomBytes, randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import {
  CalculateCartDto, CancelOrderDto, ComplaintDto, CreateBranchDto, CreateCategoryDto,
  CreateMenuItemDto, CreateOrderDto, CreateSessionDto, CreateTableDto,
  UpdateMenuItemDto,
  CreateUserDto, ListOrdersQueryDto, ListStaffQueryDto, RatingDto, TipDto,
} from './restaurant.dto';
import { AuditLogService } from './audit-log.service';
import { EVENT_PUBLISHER, EventPublisher } from './event-publisher';
import { assertActiveSession, lockActiveDiningSession } from './session-access';
import { SessionExpiryService } from './session-expiry.service';
import { customerTableUrl, tableQrPng } from './table-qr';
import { WaiterAssignmentService } from './waiter-assignment.service';

const money = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(2);

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const symbols = '!@#$%&*';
  let body = '';
  for (let index = 0; index < 12; index += 1) body += alphabet[randomInt(alphabet.length)];
  return `${body}${symbols[randomInt(symbols.length)]}${randomInt(10, 100)}`;
}

@Injectable()
export class RestaurantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogService,
    private readonly waiterAssignment: WaiterAssignmentService,
    private readonly sessions: SessionExpiryService,
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
    const table = await this.prisma.restaurantTable.create({
      data: { ...dto, qrToken: `TBL_${randomBytes(24).toString('base64url')}` },
    });
    return this.withQrUrl(table);
  }
  async listTables(branchId: string, actor?: { sub: string; role: UserRole }) {
    if (actor) await this.assertBranchAccess(actor, branchId);
    await this.prisma.branch.findFirstOrThrow({ where: { id: branchId, deletedAt: null } });
    const tables = await this.prisma.restaurantTable.findMany({
      where: { branchId, deletedAt: null },
      orderBy: { tableNumber: 'asc' },
    });
    return tables.map((table) => this.withQrUrl(table));
  }
  async table(id: string) {
    const table = await this.prisma.restaurantTable.findFirstOrThrow({
      where: { id, deletedAt: null }, include: { branch: true },
    });
    return this.withQrUrl(table);
  }
  async tableQrImage(id: string) {
    const table = await this.prisma.restaurantTable.findFirst({
      where: { id, deletedAt: null },
    });
    if (!table) throw new NotFoundException({ code: 'TABLE_NOT_FOUND', message: 'Table not found' });
    const qrUrl = customerTableUrl(this.customerAppUrl(), table.qrToken);
    return {
      filename: `table-${table.tableNumber}.png`,
      png: await tableQrPng(qrUrl),
    };
  }
  private customerAppUrl() {
    return this.config.get<string>('CUSTOMER_APP_URL');
  }
  private withQrUrl<T extends { qrToken: string }>(table: T) {
    return { ...table, qrUrl: customerTableUrl(this.customerAppUrl(), table.qrToken) };
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
    assertActiveSession(session, token);
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
    const pendingBills = await this.prisma.paymentIntent.count({
      where: { diningSessionId: id, status: PaymentIntentStatus.PAYMENT_PENDING },
    });
    if (pendingBills) throw new ConflictException('Pay the pending table bill before closing');
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
          include: {
            variants: { where: { isAvailable: true } },
            addonGroups: { include: { addons: { where: { isAvailable: true } } } },
          },
        },
      },
    });
  }
  menuItem(id: string) {
    return this.prisma.menuItem.findFirstOrThrow({
      where: { id, deletedAt: null },
      include: {
        variants: { where: { isAvailable: true } },
        addonGroups: { include: { addons: { where: { isAvailable: true } } } },
      },
    }).then((item) => this.withoutEmptyAddonGroups(item));
  }
  async updateMenuItem(actor: { sub: string; role: UserRole }, id: string, dto: UpdateMenuItemDto) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, deletedAt: null },
      include: { variants: true, addonGroups: { include: { addons: true } } },
    });
    if (!item) throw new NotFoundException({ code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found' });
    await this.assertBranchAccess(actor, item.branchId);
    const category = await this.prisma.menuCategory.findFirst({
      where: { id: dto.categoryId, branchId: item.branchId, deletedAt: null },
    });
    if (!category) {
      throw new BadRequestException({ code: 'CATEGORY_NOT_FOUND', message: 'Category is not in this branch' });
    }
    this.assertUniqueNames(dto.variants?.map((variant) => variant.name) ?? [], 'Variant names must be unique');
    this.assertUniqueNames(dto.addonGroups?.map((group) => group.name) ?? [], 'Add-on group names must be unique');
    for (const group of dto.addonGroups ?? []) {
      this.assertUniqueNames(group.addons.map((addon) => addon.name), `Add-on names in ${group.name} must be unique`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.menuItem.update({
        where: { id },
        data: {
          categoryId: dto.categoryId,
          name: dto.name,
          description: dto.description ?? null,
          imageUrl: dto.imageUrl ?? null,
          basePrice: dto.basePrice,
        },
      });
      await this.syncVariants(tx, item.variants, id, dto.variants ?? []);
      await this.syncAddonGroups(tx, item.addonGroups, id, dto.addonGroups ?? []);
      await this.audit.record({
        actorId: actor.sub,
        action: 'MENU_ITEM_UPDATED',
        resourceType: 'MenuItem',
        resourceId: id,
      }, tx);
      const updated = await tx.menuItem.findFirstOrThrow({
        where: { id },
        include: {
          variants: { where: { isAvailable: true } },
          addonGroups: { include: { addons: { where: { isAvailable: true } } } },
        },
      });
      return this.withoutEmptyAddonGroups(updated);
    });
  }
  async setMenuItemAvailability(
    actor: { sub: string; role: UserRole },
    id: string,
    isAvailable: boolean,
  ) {
    const item = await this.prisma.menuItem.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException({ code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found' });
    await this.assertBranchAccess(actor, item.branchId);
    const updated = await this.prisma.menuItem.update({
      where: { id },
      data: { isAvailable },
      select: { id: true, isAvailable: true },
    });
    await this.audit.record({
      actorId: actor.sub,
      action: isAvailable ? 'MENU_ITEM_AVAILABLE' : 'MENU_ITEM_UNAVAILABLE',
      resourceType: 'MenuItem',
      resourceId: id,
    });
    return updated;
  }
  async adminMenu(actor: { sub: string; role: UserRole }, branchId: string) {
    await this.assertBranchAccess(actor, branchId);
    const categories = await this.prisma.menuCategory.findMany({
      where: { branchId, deletedAt: null },
      orderBy: { displayOrder: 'asc' },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: { displayOrder: 'asc' },
          include: {
            variants: { where: { isAvailable: true } },
            addonGroups: { include: { addons: { where: { isAvailable: true } } } },
          },
        },
      },
    });
    return categories.map((category) => ({
      ...category,
      items: category.items.map((item) => this.withoutEmptyAddonGroups(item)),
    }));
  }
  private assertUniqueNames(names: string[], message: string) {
    if (new Set(names).size !== names.length) throw new BadRequestException(message);
  }
  private withoutEmptyAddonGroups<T extends { addonGroups: { addons: unknown[] }[] }>(item: T) {
    return { ...item, addonGroups: item.addonGroups.filter((group) => group.addons.length > 0) };
  }
  private async syncVariants(
    tx: Prisma.TransactionClient,
    existing: { id: string; name: string }[],
    menuItemId: string,
    incoming: { name: string; price: number }[],
  ) {
    const kept = new Set(incoming.map((variant) => variant.name));
    for (const variant of incoming) {
      const match = existing.find((entry) => entry.name === variant.name);
      if (match) {
        await tx.menuItemVariant.update({
          where: { id: match.id },
          data: { price: variant.price, isAvailable: true },
        });
      } else {
        await tx.menuItemVariant.create({ data: { menuItemId, name: variant.name, price: variant.price } });
      }
    }
    for (const leftover of existing.filter((entry) => !kept.has(entry.name))) {
      const used = await tx.orderItem.count({ where: { variantId: leftover.id } });
      if (used) {
        await tx.menuItemVariant.update({ where: { id: leftover.id }, data: { isAvailable: false } });
      } else {
        await tx.menuItemVariant.delete({ where: { id: leftover.id } });
      }
    }
  }
  private async syncAddonGroups(
    tx: Prisma.TransactionClient,
    existing: { id: string; name: string; addons: { id: string; name: string }[] }[],
    menuItemId: string,
    incoming: { name: string; isRequired?: boolean; minSelection?: number; maxSelection?: number; addons: { name: string; price: number }[] }[],
  ) {
    const kept = new Set(incoming.map((group) => group.name));
    for (const [index, group] of incoming.entries()) {
      const match = existing.find((entry) => entry.name === group.name);
      const data = {
        name: group.name,
        isRequired: group.isRequired ?? false,
        minSelection: group.minSelection ?? 0,
        maxSelection: group.maxSelection ?? 1,
        displayOrder: index,
      };
      const groupId = match
        ? (await tx.menuItemAddonGroup.update({ where: { id: match.id }, data })).id
        : (await tx.menuItemAddonGroup.create({ data: { ...data, menuItemId } })).id;
      await this.syncAddons(tx, match?.addons ?? [], groupId, group.addons);
    }
    for (const leftover of existing.filter((entry) => !kept.has(entry.name))) {
      await this.syncAddons(tx, leftover.addons, leftover.id, []);
      const remaining = await tx.menuItemAddon.count({ where: { addonGroupId: leftover.id } });
      if (!remaining) await tx.menuItemAddonGroup.delete({ where: { id: leftover.id } });
    }
  }
  private async syncAddons(
    tx: Prisma.TransactionClient,
    existing: { id: string; name: string }[],
    addonGroupId: string,
    incoming: { name: string; price: number }[],
  ) {
    const kept = new Set(incoming.map((addon) => addon.name));
    for (const addon of incoming) {
      const match = existing.find((entry) => entry.name === addon.name);
      if (match) {
        await tx.menuItemAddon.update({
          where: { id: match.id },
          data: { price: addon.price, isAvailable: true },
        });
      } else {
        await tx.menuItemAddon.create({ data: { addonGroupId, name: addon.name, price: addon.price } });
      }
    }
    for (const leftover of existing.filter((entry) => !kept.has(entry.name))) {
      const used = await tx.orderItemAddon.count({ where: { addonId: leftover.id } });
      if (used) {
        await tx.menuItemAddon.update({ where: { id: leftover.id }, data: { isAvailable: false } });
      } else {
        await tx.menuItemAddon.delete({ where: { id: leftover.id } });
      }
    }
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
    if (!session.customerId) {
      throw new BadRequestException({
        code: 'CUSTOMER_REQUIRED',
        message: 'Identify the customer with phone or email before payment',
      });
    }
    if (session.branchId !== dto.branchId) throw new BadRequestException('Branch/session mismatch');
    this.verifyPayment(dto.paymentReference);
    const cart = await this.calculateCart(dto);
    const order = await this.prisma.$transaction(async (tx) => {
      try {
        await lockActiveDiningSession(tx, session.id);
        const waiter = await this.waiterAssignment.assignWaiter(session.branchId, tx);
        const created = await tx.order.create({
          data: {
            diningSessionId: session.id,
            customerId: session.customerId,
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
  async kitchenQueue(branchId: string, actor?: { sub: string; role: UserRole }) {
    if (actor) await this.assertBranchAccess(actor, branchId);
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
        const settled = await this.sessions.settleSession(completedOrder.diningSessionId, tx);
        return { item, completedOrder, settled };
      }
      return { item, completedOrder, settled: null };
    });
    const item = result.item;
    this.events.publish(`session:${item.order.diningSessionId}`, 'order_item.delivered', item);
    if (result.completedOrder) {
      this.events.publish(`session:${result.completedOrder.diningSessionId}`, 'order.completed', result.completedOrder);
    }
    if (result.settled) this.publishSessionCompleted(result.settled);
    return item;
  }
  async rating(dto: RatingDto, token?: string) {
    await this.authorizeFeedback(dto.orderId, token);
    return this.prisma.rating.create({ data: dto });
  }
  async complaint(dto: ComplaintDto, token?: string) {
    await this.authorizeFeedback(dto.orderId, token);
    return this.prisma.complaint.create({ data: dto });
  }
  async tip(dto: TipDto, token?: string) {
    const order = await this.authorizeFeedback(dto.orderId, token);
    if (!order.waiterId) throw new BadRequestException('No waiter assigned');
    return this.prisma.tip.create({ data: { ...dto, waiterId: order.waiterId } });
  }
  private publishSessionCompleted(session: { id: string; tableId: string; branchId: string }) {
    const payload = { sessionId: session.id, tableId: session.tableId, branchId: session.branchId, reason: 'ORDERS_SETTLED' };
    this.events.publish(`session:${session.id}`, 'session.completed', payload);
    this.events.publish(`floor:${session.branchId}`, 'session.completed', payload);
  }
  private async authorizeFeedback(orderId: string, token?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { diningSession: true },
    });
    if (!order?.diningSession) throw new NotFoundException('Order not found');
    const session = order.diningSession;
    const open = session.status === DiningSessionStatus.ACTIVE || session.status === DiningSessionStatus.COMPLETED;
    if (!token || token !== session.sessionToken || !open) {
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Table session is no longer active' });
    }
    return order;
  }
  private async authorizeOrder(orderId: string, token?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    await this.requireSession(order.diningSessionId, token);
    return order;
  }
  async cancelOrder(orderId: string, token?: string) {
    const order = await this.authorizeOrder(orderId, token);
    if (Date.now() - order.createdAt.getTime() > 60_000) {
      throw new BadRequestException({
        code: 'CANCEL_WINDOW_EXPIRED',
        message: 'Orders can only be cancelled within 60 seconds',
      });
    }
    const delivered = await this.prisma.orderItem.count({
      where: { orderId, status: OrderItemStatus.DELIVERED },
    });
    if (delivered) {
      throw new BadRequestException('Delivered items cannot be cancelled; report a problem instead');
    }
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelSource: CancelSource.CUSTOMER },
      });
      const session = await tx.diningSession.findUnique({ where: { id: order.diningSessionId } });
      if (order.waiterId && session) {
        await this.waiterAssignment.releaseWaiter(order.waiterId, session.branchId, tx);
      }
      await this.audit.record({
        action: 'ORDER_CANCELLED',
        resourceType: 'Order',
        resourceId: orderId,
        metadata: { diningSessionId: order.diningSessionId },
      }, tx);
      const settled = await this.sessions.settleSession(order.diningSessionId, tx);
      return { updated, branchId: session?.branchId, settled };
    });
    this.events.publish(`session:${order.diningSessionId}`, 'order.cancelled', cancelled.updated);
    if (cancelled.settled) this.publishSessionCompleted(cancelled.settled);
    if (cancelled.branchId) this.events.publish(`kitchen:${cancelled.branchId}`, 'order.cancelled', cancelled.updated);
    if (order.waiterId) this.events.publish(`waiter:${order.waiterId}`, 'order.cancelled', cancelled.updated);
    return cancelled.updated;
  }

  async adminCancelOrder(
    actor: { sub: string; role: UserRole },
    orderId: string,
    dto: CancelOrderDto,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { select: { status: true } }, diningSession: { select: { branchId: true } } },
    });
    if (!order || !order.diningSession) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order not found' });
    }
    await this.assertBranchAccess(actor, order.diningSession.branchId);
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException({ code: 'ALREADY_CANCELLED', message: 'This order is already cancelled' });
    }
    if (order.status === OrderStatus.COMPLETED || order.items.some((item) => item.status === OrderItemStatus.DELIVERED)) {
      throw new BadRequestException({
        code: 'CANCEL_BLOCKED',
        message: 'Delivered or completed orders cannot be cancelled. Refund the order instead.',
      });
    }
    const note = dto.note?.trim() || undefined;
    if (dto.reason === 'Other' && !note) {
      throw new BadRequestException({ code: 'NOTE_REQUIRED', message: 'Add a note when the reason is Other' });
    }

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelSource: CancelSource.STAFF },
      });
      if (order.waiterId) {
        await this.waiterAssignment.releaseWaiter(order.waiterId, order.diningSession!.branchId, tx);
      }
      await this.audit.record({
        actorId: actor.sub,
        action: 'ORDER_CANCELLED',
        resourceType: 'Order',
        resourceId: orderId,
        metadata: { diningSessionId: order.diningSessionId, reason: dto.reason, note, source: 'STAFF' },
      }, tx);
      const settled = await this.sessions.settleSession(order.diningSessionId, tx);
      return { updated, settled };
    });
    this.events.publish(`session:${order.diningSessionId}`, 'order.cancelled', cancelled.updated);
    if (cancelled.settled) this.publishSessionCompleted(cancelled.settled);
    this.events.publish(`kitchen:${order.diningSession.branchId}`, 'order.cancelled', cancelled.updated);
    if (order.waiterId) this.events.publish(`waiter:${order.waiterId}`, 'order.cancelled', cancelled.updated);
    return cancelled.updated;
  }

  async myBranches(actor: { sub: string; role: UserRole }) {
    if (actor.role === UserRole.ADMIN) {
      return this.prisma.branch.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: { name: 'asc' },
      });
    }
    const assignments = await this.prisma.staffAssignment.findMany({
      where: { userId: actor.sub, branch: { isActive: true, deletedAt: null } },
      select: { branch: true },
      orderBy: { branch: { name: 'asc' } },
    });
    return assignments.map((assignment) => assignment.branch);
  }

  async listOrders(actor: { sub: string; role: UserRole }, query: ListOrdersQueryDto) {
    const page = query.page ?? 1;
    const size = query.size ?? 25;
    let branchIds: string[] | undefined;
    if (actor.role === UserRole.MANAGER) {
      const assignments = await this.prisma.staffAssignment.findMany({
        where: { userId: actor.sub },
        select: { branchId: true },
      });
      const allowed = assignments.map((assignment) => assignment.branchId);
      if (query.branchId && !allowed.includes(query.branchId)) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You can only view orders in your branch' });
      }
      branchIds = query.branchId ? [query.branchId] : allowed;
      if (!branchIds.length) return { items: [], page, size, total: 0 };
    } else if (query.branchId) {
      branchIds = [query.branchId];
    }

    const where: Prisma.OrderWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.refunded ? { refundStatus: { not: 'NONE' } } : {}),
      ...(query.hasComplaint ? { complaints: { some: { status: 'OPEN' } } } : {}),
      ...(query.from || query.to ? { createdAt: { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } } : {}),
      ...(branchIds ? { diningSession: { branchId: { in: branchIds } } } : {}),
    };
    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
        select: {
          id: true,
          orderNumber: true,
          createdAt: true,
          status: true,
          refundStatus: true,
          totalAmount: true,
          customer: { select: { name: true, phone: true } },
          waiter: { select: { firstName: true, lastName: true } },
          paymentIntent: { select: { channel: true } },
          diningSession: { select: { table: { select: { tableNumber: true } } } },
          _count: { select: { items: true } },
        },
      }),
    ]);
    return {
      items: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        status: order.status,
        refundStatus: order.refundStatus,
        totalAmount: order.totalAmount,
        itemCount: order._count.items,
        tableNumber: order.diningSession?.table?.tableNumber ?? null,
        customerName: order.customer?.name || order.customer?.phone || null,
        waiterName: [order.waiter?.firstName, order.waiter?.lastName].filter(Boolean).join(' ') || null,
        channel: order.paymentIntent?.channel ?? null,
      })),
      page,
      size,
      total,
    };
  }

  async listUsers(actor: { sub: string; role: UserRole }, query: ListStaffQueryDto) {
    let branchIds: string[] | undefined;
    if (actor.role === UserRole.MANAGER) {
      const assignments = await this.prisma.staffAssignment.findMany({
        where: { userId: actor.sub },
        select: { branchId: true },
      });
      const allowed = assignments.map((assignment) => assignment.branchId);
      if (query.branchId && !allowed.includes(query.branchId)) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You can only list staff in your branch' });
      }
      branchIds = query.branchId ? [query.branchId] : allowed;
      if (!branchIds.length) return [];
    } else if (query.branchId) {
      branchIds = [query.branchId];
    }

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(query.role ? { role: query.role } : {}),
        ...(query.status === 'active' ? { isActive: true } : {}),
        ...(query.status === 'inactive' ? { isActive: false } : {}),
        ...(branchIds ? { assignments: { some: { branchId: { in: branchIds } } } } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        temporaryPassword: true,
        createdAt: true,
        assignments: { select: { branch: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    return users.map((user) => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      temporaryPassword: actor.role === UserRole.ADMIN ? user.temporaryPassword : null,
      createdAt: user.createdAt,
      branches: user.assignments.map((assignment) => assignment.branch),
    }));
  }

  async setStaffActive(actorId: string, userId: string, isActive: boolean) {
    if (actorId === userId && !isActive) {
      throw new BadRequestException({
        code: 'CANNOT_DEACTIVATE_SELF',
        message: 'You cannot deactivate your own account',
      });
    }
    const existing = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Staff member not found' });
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: { id: true, isActive: true },
    });
    await this.audit.record({
      actorId,
      action: isActive ? 'STAFF_REACTIVATED' : 'STAFF_DEACTIVATED',
      resourceType: 'User',
      resourceId: userId,
    });
    return user;
  }

  async createUser(dto: CreateUserDto) {
    const { password, branchId, ...user } = dto;
    return this.prisma.user.create({
      data: {
        ...user,
        passwordHash: await hash(password, 12),
        temporaryPassword: password,
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

  async issueTemporaryPassword(actorId: string, userId: string) {
    const existing = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Staff member not found' });
    const temporaryPassword = generateTemporaryPassword();
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hash(temporaryPassword, 12), temporaryPassword },
    });
    await this.audit.record({
      actorId,
      action: 'STAFF_PASSWORD_ISSUED',
      resourceType: 'User',
      resourceId: userId,
    });
    return { id: userId, temporaryPassword };
  }

  async listBranchWaiters(actor: { sub: string; role: UserRole }, branchId: string) {
    await this.assertBranchAccess(actor, branchId);
    const assignments = await this.prisma.staffAssignment.findMany({
      where: { branchId, user: { role: UserRole.WAITER, deletedAt: null, isActive: true } },
      select: {
        id: true,
        userId: true,
        waiterStatus: true,
        lastAssignedAt: true,
        lastIdleAt: true,
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { user: { firstName: 'asc' } },
    });
    if (!assignments.length) return [];

    const userIds = assignments.map((assignment) => assignment.userId);
    const openStatuses = [OrderStatus.ORDER_PLACED, OrderStatus.PREPARING];
    const [orders, bills] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['waiterId'],
        where: { waiterId: { in: userIds }, status: { in: openStatuses }, diningSession: { branchId } },
        _count: { id: true },
      }),
      this.prisma.paymentIntent.groupBy({
        by: ['collectorWaiterId'],
        where: {
          collectorWaiterId: { in: userIds },
          status: PaymentIntentStatus.PAYMENT_PENDING,
          diningSession: { branchId },
        },
        _count: { id: true },
      }),
    ]);
    const orderCounts = new Map(orders.flatMap((row) => row.waiterId ? [[row.waiterId, row._count.id] as const] : []));
    const billCounts = new Map(bills.flatMap((row) => row.collectorWaiterId ? [[row.collectorWaiterId, row._count.id] as const] : []));

    return assignments.map((assignment) => ({
      id: assignment.id,
      userId: assignment.userId,
      firstName: assignment.user.firstName,
      lastName: assignment.user.lastName,
      email: assignment.user.email,
      waiterStatus: assignment.waiterStatus ?? WaiterStatus.IDLE,
      activeOrders: orderCounts.get(assignment.userId) ?? 0,
      pendingBills: billCounts.get(assignment.userId) ?? 0,
      lastAssignedAt: assignment.lastAssignedAt,
      lastIdleAt: assignment.lastIdleAt,
    }));
  }

  async setWaiterStatus(actor: { sub: string; role: UserRole }, assignmentId: string, requested: 'IDLE' | 'OFFLINE') {
    const assignment = await this.prisma.staffAssignment.findUnique({
      where: { id: assignmentId },
      include: { user: { select: { role: true, deletedAt: true, isActive: true } } },
    });
    if (!assignment || assignment.user.deletedAt || !assignment.user.isActive || assignment.user.role !== UserRole.WAITER) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Waiter assignment not found' });
    }
    await this.assertBranchAccess(actor, assignment.branchId);

    const openOrders = await this.prisma.order.count({
      where: {
        waiterId: assignment.userId,
        status: { in: [OrderStatus.ORDER_PLACED, OrderStatus.PREPARING] },
        diningSession: { branchId: assignment.branchId },
      },
    });
    const waiterStatus = requested === 'OFFLINE'
      ? WaiterStatus.OFFLINE
      : openOrders > 0 ? WaiterStatus.ENGAGED : WaiterStatus.IDLE;
    const updated = await this.prisma.staffAssignment.update({
      where: { id: assignmentId },
      data: {
        waiterStatus,
        lastIdleAt: waiterStatus === WaiterStatus.IDLE ? new Date() : assignment.lastIdleAt,
      },
      select: { id: true, waiterStatus: true, lastIdleAt: true },
    });
    await this.audit.record({
      actorId: actor.sub,
      action: requested === 'OFFLINE' ? 'WAITER_SET_OFFLINE' : 'WAITER_SET_AVAILABLE',
      resourceType: 'StaffAssignment',
      resourceId: assignmentId,
      metadata: { waiterStatus },
    });
    return { ...updated, activeOrders: openOrders };
  }

  private async assertBranchAccess(actor: { sub: string; role: UserRole }, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, deletedAt: null } });
    if (!branch) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Branch not found' });
    if (actor.role !== UserRole.MANAGER) return;
    const assignment = await this.prisma.staffAssignment.findUnique({
      where: { userId_branchId: { userId: actor.sub, branchId } },
      select: { id: true },
    });
    if (!assignment) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You can only manage your own branch' });
    }
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
