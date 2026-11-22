import {
  BadRequestException, ConflictException, Inject, Injectable,
  NotFoundException, NotImplementedException, Optional,
} from '@nestjs/common';
import {
  CollectionMethod, PaymentChannel, PaymentIntentStatus,
  PaymentStatus, Prisma, WaiterStatus,
} from '../generated/prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { AuditLogService } from './audit-log.service';
import { EVENT_PUBLISHER, EventPublisher } from './event-publisher';
import { RestaurantService } from './restaurant.service';
import { WaiterAssignmentService } from './waiter-assignment.service';
import { BillLine, mergeBillItems } from './session-bill';
import { AssistedOrderDto, CalculateCartDto, CartItemDto } from './restaurant.dto';
import { CustomerService } from './customer.service';
import { assertActiveSession, lockActiveDiningSession } from './session-access';

export type CreateIntentInput = CalculateCartDto & {
  diningSessionId: string;
  channel: PaymentChannel;
};

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly waiterAssignment: WaiterAssignmentService,
    private readonly restaurant: RestaurantService,
    private readonly audit: AuditLogService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Optional() private readonly customers?: CustomerService,
  ) {}

  async createIntent(dto: CreateIntentInput, token?: string) {
    const session = await this.requireSession(dto.diningSessionId, token);
    if (!session.customerId) {
      throw new BadRequestException({
        code: 'CUSTOMER_REQUIRED',
        message: 'Identify the customer with phone or email before checkout',
      });
    }
    if (session.branchId !== dto.branchId) throw new BadRequestException('Branch/session mismatch');
    if (dto.channel === PaymentChannel.WAITER_ASSISTED) {
      throw new BadRequestException('Use waiter assisted-orders for this payment path');
    }

    const pending = await this.prisma.paymentIntent.findFirst({
      where: { diningSessionId: session.id, status: PaymentIntentStatus.PAYMENT_PENDING },
    });
    if (pending && pending.channel !== dto.channel) {
      throw new ConflictException({
        code: 'PENDING_BILL_EXISTS',
        message: 'This session already has an unpaid bill on a different payment path',
      });
    }
    if (pending && dto.channel === PaymentChannel.PAY_AT_TABLE) {
      const existing = (pending.cartSnapshot as BillLine[]) ?? [];
      const merged = mergeBillItems(existing, dto.items.map(toBillLine));
      const cart = await this.restaurant.calculateCart({ branchId: dto.branchId, items: merged });
      const updated = await this.prisma.$transaction(async (tx) => {
        await lockActiveDiningSession(tx, session.id);
        return tx.paymentIntent.update({
          where: { id: pending.id },
          data: {
            cartSnapshot: merged as Prisma.InputJsonValue,
            subtotalAmount: cart.subtotal,
            taxPercentage: cart.taxPercentage,
            taxAmount: cart.taxAmount,
            totalAmount: cart.total,
          },
        });
      });
      this.events.publish(`session:${session.id}`, 'bill.pending', updated);
      if (updated.collectorWaiterId) {
        this.events.publish(`waiter:${updated.collectorWaiterId}`, 'bill.pending', updated);
      }
      return updated;
    }
    if (pending) {
      throw new ConflictException({
        code: 'PENDING_BILL_EXISTS',
        message: 'This session already has an unpaid checkout',
      });
    }

    const cart = await this.restaurant.calculateCart(dto);
    const snapshot = dto.items.map(toBillLine) as Prisma.InputJsonValue;

    if (dto.channel === PaymentChannel.PAY_AT_TABLE) {
      const bill = await this.prisma.$transaction(async (tx) => {
        await lockActiveDiningSession(tx, session.id);
        const waiter = await this.waiterAssignment.assignWaiter(session.branchId, tx);
        if (!waiter) {
          throw new ConflictException({
            code: 'NO_WAITER_AVAILABLE',
            message: 'No waiter is available to collect payment',
          });
        }
        const created = await tx.paymentIntent.create({
          data: {
            diningSessionId: session.id,
            customerId: session.customerId!,
            channel: dto.channel,
            status: PaymentIntentStatus.PAYMENT_PENDING,
            collectorWaiterId: waiter.userId,
            cartSnapshot: snapshot,
            subtotalAmount: cart.subtotal,
            taxPercentage: cart.taxPercentage,
            taxAmount: cart.taxAmount,
            totalAmount: cart.total,
          },
        });
        await this.audit.record({
          action: 'BILL_PENDING',
          resourceType: 'PaymentIntent',
          resourceId: created.id,
          metadata: { diningSessionId: session.id, waiterId: waiter.userId },
        }, tx);
        return created;
      });
      this.events.publish(`session:${session.id}`, 'bill.pending', bill);
      if (bill.collectorWaiterId) {
        this.events.publish(`waiter:${bill.collectorWaiterId}`, 'bill.pending', bill);
      }
      return bill;
    }

    const intent = await this.prisma.$transaction(async (tx) => {
      await lockActiveDiningSession(tx, session.id);
      return tx.paymentIntent.create({
        data: {
          diningSessionId: session.id,
          customerId: session.customerId!,
          channel: PaymentChannel.ONLINE,
          status: PaymentIntentStatus.PAYMENT_PENDING,
          cartSnapshot: snapshot,
          subtotalAmount: cart.subtotal,
          taxPercentage: cart.taxPercentage,
          taxAmount: cart.taxAmount,
          totalAmount: cart.total,
          provider: 'DEMO',
        },
      });
    });
    this.events.publish(`session:${session.id}`, 'payment.intent.created', intent);
    return intent;
  }

  async collectBill(billId: string, waiterId: string, method: CollectionMethod) {
    if (method !== CollectionMethod.CASH && method !== CollectionMethod.CARD) {
      throw new BadRequestException('Pay-at-table collection must be cash or card');
    }
    const order = await this.prisma.$transaction(async (tx) => {
      const bill = await tx.paymentIntent.findUnique({
        where: { id: billId },
        include: { diningSession: true },
      });
      if (!bill || bill.status !== PaymentIntentStatus.PAYMENT_PENDING) {
        throw new BadRequestException('Bill is not waiting for collection');
      }
      if (bill.collectorWaiterId !== waiterId) {
        throw new BadRequestException('This bill is assigned to another waiter');
      }
      await lockActiveDiningSession(tx, bill.diningSessionId);
      const items = (bill.cartSnapshot as BillLine[]) ?? [];
      const cart = await this.restaurant.calculateCart({
        branchId: bill.diningSession.branchId,
        items,
      });
      const created = await tx.order.create({
        data: {
          diningSessionId: bill.diningSessionId,
          customerId: bill.customerId,
          waiterId: bill.collectorWaiterId,
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
              provider: method,
              providerReference: `${method.toLowerCase()}_${bill.id}`,
              amount: cart.total,
              status: PaymentStatus.SUCCESS,
              paidAt: new Date(),
            },
          },
        },
        include: { items: { include: { addons: true } }, payments: true },
      });
      await tx.paymentIntent.update({
        where: { id: bill.id },
        data: {
          status: PaymentIntentStatus.PAYMENT_SUCCESS,
          collectionMethod: method,
          orderId: created.id,
          provider: method,
          providerReference: `${method.toLowerCase()}_${bill.id}`,
        },
      });
      await tx.diningSession.update({
        where: { id: bill.diningSessionId },
        data: { totalSpend: { increment: cart.total } },
      });
      await this.audit.record({
        actorId: waiterId,
        action: 'BILL_COLLECTED',
        resourceType: 'PaymentIntent',
        resourceId: bill.id,
        metadata: { orderId: created.id, method },
      }, tx);
      await this.audit.record({
        actorId: waiterId,
        action: 'ORDER_CREATED',
        resourceType: 'Order',
        resourceId: created.id,
        metadata: { diningSessionId: bill.diningSessionId, waiterId },
      }, tx);
      return { created, branchId: bill.diningSession.branchId, sessionId: bill.diningSessionId };
    });
    this.events.publish(`kitchen:${order.branchId}`, 'order.created', order.created);
    this.events.publish(`waiter:${waiterId}`, 'order.assigned', order.created);
    this.events.publish(`session:${order.sessionId}`, 'order.created', order.created);
    this.events.publish(`session:${order.sessionId}`, 'payment.completed', { billId, orderId: order.created.id });
    return order.created;
  }

  async cancelBill(billId: string, actor: { waiterId?: string; sessionToken?: string }) {
    const bill = await this.prisma.paymentIntent.findUnique({
      where: { id: billId },
      include: { diningSession: true },
    });
    if (!bill || bill.status !== PaymentIntentStatus.PAYMENT_PENDING) {
      throw new BadRequestException('Only unpaid bills can be cancelled');
    }
    if (actor.waiterId) {
      if (bill.collectorWaiterId !== actor.waiterId) {
        throw new BadRequestException('This bill is assigned to another waiter');
      }
    } else {
      await this.requireSession(bill.diningSessionId, actor.sessionToken);
    }
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.paymentIntent.update({
        where: { id: bill.id },
        data: { status: PaymentIntentStatus.CANCELLED },
      });
      if (bill.collectorWaiterId) {
        await this.waiterAssignment.releaseWaiter(
          bill.collectorWaiterId,
          bill.diningSession.branchId,
          tx,
        );
      }
      await this.audit.record({
        actorId: actor.waiterId,
        action: 'BILL_CANCELLED',
        resourceType: 'PaymentIntent',
        resourceId: bill.id,
        metadata: { diningSessionId: bill.diningSessionId },
      }, tx);
      return updated;
    });
    this.events.publish(`session:${bill.diningSessionId}`, 'bill.cancelled', cancelled);
    if (bill.collectorWaiterId) {
      this.events.publish(`waiter:${bill.collectorWaiterId}`, 'bill.cancelled', cancelled);
    }
    return cancelled;
  }

  pendingBills(waiterId: string) {
    return this.prisma.paymentIntent.findMany({
      where: {
        collectorWaiterId: waiterId,
        status: PaymentIntentStatus.PAYMENT_PENDING,
      },
      include: { diningSession: { include: { table: true } }, customer: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async assistedOrder(waiterId: string, dto: AssistedOrderDto) {
    if (dto.method !== CollectionMethod.CASH && dto.method !== CollectionMethod.CARD) {
      throw new BadRequestException('Assisted orders accept cash or card only');
    }
    if (!this.customers) {
      throw new BadRequestException('Customer service is not configured');
    }
    const table = await this.prisma.restaurantTable.findFirst({
      where: { id: dto.tableId, deletedAt: null },
    });
    if (!table) throw new NotFoundException('Table not found');
    if (table.branchId !== dto.branchId) throw new BadRequestException('Branch/table mismatch');
    const assignment = await this.prisma.staffAssignment.findUnique({
      where: { userId_branchId: { userId: waiterId, branchId: table.branchId } },
    });
    if (!assignment || assignment.waiterStatus !== WaiterStatus.IDLE) {
      throw new BadRequestException('Only idle waiters can place assisted orders');
    }
    const session = await this.restaurant.createSession({ tableId: dto.tableId });
    const identified = await this.customers.identify(session.id, dto, session.sessionToken);
    const customerId = identified.session.customerId ?? identified.customer.id;
    const cart = await this.restaurant.calculateCart(dto);
    const bill = await this.prisma.$transaction(async (tx) => {
      await lockActiveDiningSession(tx, session.id);
      await this.waiterAssignment.assignSpecificWaiter(waiterId, table.branchId, tx);
      return tx.paymentIntent.create({
        data: {
          diningSessionId: session.id,
          customerId,
          channel: PaymentChannel.WAITER_ASSISTED,
          status: PaymentIntentStatus.PAYMENT_PENDING,
          collectorWaiterId: waiterId,
          cartSnapshot: dto.items.map(toBillLine) as Prisma.InputJsonValue,
          subtotalAmount: cart.subtotal,
          taxPercentage: cart.taxPercentage,
          taxAmount: cart.taxAmount,
          totalAmount: cart.total,
        },
      });
    });
    return this.collectBill(bill.id, waiterId, dto.method);
  }

  async confirmOnline(intentId: string, paymentReference: string, token?: string) {
    if (!paymentReference.startsWith('demo_pay_')) {
      throw new NotImplementedException(
        'Configure a signed Razorpay/Stripe webhook before using live online payment',
      );
    }
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      include: { diningSession: true },
    });
    if (!intent) throw new NotFoundException('Payment intent not found');
    await this.requireSession(intent.diningSessionId, token);
    if (intent.channel !== PaymentChannel.ONLINE || intent.status !== PaymentIntentStatus.PAYMENT_PENDING) {
      throw new BadRequestException('Intent is not an unpaid online checkout');
    }
    const items = (intent.cartSnapshot as BillLine[]) ?? [];
    const cart = await this.restaurant.calculateCart({
      branchId: intent.diningSession.branchId,
      items,
    });
    const order = await this.prisma.$transaction(async (tx) => {
      await lockActiveDiningSession(tx, intent.diningSessionId);
      const waiter = await this.waiterAssignment.assignWaiter(intent.diningSession.branchId, tx);
      const created = await tx.order.create({
        data: {
          diningSessionId: intent.diningSessionId,
          customerId: intent.customerId,
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
              provider: intent.provider ?? 'DEMO',
              providerReference: paymentReference,
              amount: cart.total,
              status: PaymentStatus.SUCCESS,
              paidAt: new Date(),
            },
          },
        },
        include: { items: { include: { addons: true } }, payments: true },
      });
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentIntentStatus.PAYMENT_SUCCESS,
          orderId: created.id,
          providerReference: paymentReference,
        },
      });
      await tx.diningSession.update({
        where: { id: intent.diningSessionId },
        data: { totalSpend: { increment: cart.total } },
      });
      await this.audit.record({
        action: 'ORDER_CREATED',
        resourceType: 'Order',
        resourceId: created.id,
        metadata: { diningSessionId: intent.diningSessionId, waiterId: waiter?.userId ?? null },
      }, tx);
      return { created, waiterId: waiter?.userId, branchId: intent.diningSession.branchId };
    });
    this.events.publish(`kitchen:${order.branchId}`, 'order.created', order.created);
    if (order.waiterId) this.events.publish(`waiter:${order.waiterId}`, 'order.assigned', order.created);
    this.events.publish(`session:${intent.diningSessionId}`, 'order.created', order.created);
    return order.created;
  }

  private async requireSession(sessionId: string, token?: string) {
    const session = await this.prisma.diningSession.findUnique({ where: { id: sessionId } });
    assertActiveSession(session, token);
    await this.prisma.diningSession.update({
      where: { id: session.id }, data: { lastActiveAt: new Date() },
    });
    return session;
  }
}

function toBillLine(item: CartItemDto): BillLine {
  return {
    menuItemId: item.menuItemId,
    quantity: item.quantity,
    variantId: item.variantId,
    addonIds: item.addonIds ?? [],
  };
}
