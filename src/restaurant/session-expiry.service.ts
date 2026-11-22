import {
  ConflictException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { DiningSessionStatus, OrderStatus, PaymentIntentStatus, Prisma, TableStatus } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditLogService } from './audit-log.service';
import { EVENT_PUBLISHER, EventPublisher } from './event-publisher';
import { EMPTY_SESSION_TIMEOUT_MS, lockActiveDiningSession } from './session-access';

const SWEEP_INTERVAL_MS = 60_000;

type ExpiryCandidate = {
  id: string;
  tableId: string;
  branchId: string;
};

@Injectable()
export class SessionExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionExpiryService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  onModuleInit() {
    void this.expireDueSessions().catch((error: unknown) => {
      this.logger.error('Empty-session expiry sweep failed', error);
    });
    void this.settleFinishedSessions().catch((error: unknown) => {
      this.logger.error('Finished-session sweep failed', error);
    });
    this.timer = setInterval(() => {
      void this.expireDueSessions().catch((error: unknown) => {
        this.logger.error('Empty-session expiry sweep failed', error);
      });
      void this.settleFinishedSessions().catch((error: unknown) => {
        this.logger.error('Finished-session sweep failed', error);
      });
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async expireDueSessions(now = new Date()) {
    const cutoff = new Date(now.getTime() - EMPTY_SESSION_TIMEOUT_MS);
    const candidates = await this.prisma.diningSession.findMany({
      where: {
        status: DiningSessionStatus.ACTIVE,
        startedAt: { lte: cutoff },
        orders: { none: {} },
        paymentIntents: { none: { status: PaymentIntentStatus.PAYMENT_PENDING } },
      },
      select: { id: true, tableId: true, branchId: true },
    });
    const expired: ExpiryCandidate[] = [];
    for (const candidate of candidates) {
      try {
        const result = await this.expireOne(candidate, cutoff);
        if (result) expired.push(result);
      } catch (error) {
        this.logger.error(`Failed to expire dining session ${candidate.id}`, error);
      }
    }
    for (const session of expired) {
      const payload = {
        sessionId: session.id,
        tableId: session.tableId,
        branchId: session.branchId,
        reason: 'IDLE_NO_ORDER',
      };
      this.events.publish(`session:${session.id}`, 'session.expired', payload);
      this.events.publish(`floor:${session.branchId}`, 'session.expired', payload);
    }
    return expired;
  }

  async settleFinishedSessions() {
    const candidates = await this.prisma.diningSession.findMany({
      where: {
        status: DiningSessionStatus.ACTIVE,
        AND: [
          { orders: { some: {} } },
          { orders: { none: { status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] } } } },
          { paymentIntents: { none: { status: PaymentIntentStatus.PAYMENT_PENDING } } },
        ],
      },
      select: { id: true, tableId: true, branchId: true },
    });
    const settled: ExpiryCandidate[] = [];
    for (const candidate of candidates) {
      const closed = await this.prisma.$transaction((tx) => this.settleSession(candidate.id, tx));
      if (!closed) continue;
      settled.push(candidate);
      const payload = { sessionId: candidate.id, tableId: candidate.tableId, branchId: candidate.branchId, reason: 'ORDERS_SETTLED' };
      this.events.publish(`session:${candidate.id}`, 'session.completed', payload);
      this.events.publish(`floor:${candidate.branchId}`, 'session.completed', payload);
    }
    return settled;
  }

  async settleSession(sessionId: string, tx: Prisma.TransactionClient = this.prisma) {
    const session = await tx.diningSession.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== DiningSessionStatus.ACTIVE) return null;
    const openOrders = await tx.order.count({
      where: { diningSessionId: sessionId, status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] } },
    });
    if (openOrders > 0) return null;
    const orders = await tx.order.count({ where: { diningSessionId: sessionId } });
    if (orders === 0) return null;
    const pendingBills = await tx.paymentIntent.count({
      where: { diningSessionId: sessionId, status: PaymentIntentStatus.PAYMENT_PENDING },
    });
    if (pendingBills > 0) return null;

    const closed = await tx.diningSession.update({
      where: { id: sessionId },
      data: { status: DiningSessionStatus.COMPLETED, endedAt: new Date() },
    });
    const anotherActiveSession = await tx.diningSession.count({
      where: { tableId: session.tableId, status: DiningSessionStatus.ACTIVE, id: { not: sessionId } },
    });
    if (anotherActiveSession === 0) {
      await tx.restaurantTable.updateMany({
        where: { id: session.tableId, status: TableStatus.OCCUPIED },
        data: { status: TableStatus.AVAILABLE },
      });
    }
    await this.audit.record({
      action: 'SESSION_COMPLETED',
      resourceType: 'DiningSession',
      resourceId: sessionId,
      metadata: { tableId: session.tableId, branchId: session.branchId, reason: 'ORDERS_SETTLED' },
    }, tx);
    return closed;
  }

  private expireOne(candidate: ExpiryCandidate, cutoff: Date) {
    return this.prisma.$transaction(async (tx) => {
      try {
        await lockActiveDiningSession(tx, candidate.id);
      } catch (error) {
        if (error instanceof ConflictException) return null;
        throw error;
      }
      const session = await tx.diningSession.findUnique({ where: { id: candidate.id } });
      if (!session || session.status !== DiningSessionStatus.ACTIVE || session.startedAt > cutoff) return null;
      const orders = await tx.order.count({ where: { diningSessionId: session.id } });
      if (orders > 0) return null;
      const pendingPayments = await tx.paymentIntent.count({
        where: { diningSessionId: session.id, status: PaymentIntentStatus.PAYMENT_PENDING },
      });
      if (pendingPayments > 0) return null;

      await tx.diningSession.update({
        where: { id: session.id },
        data: { status: DiningSessionStatus.CANCELLED, endedAt: new Date() },
      });
      const anotherActiveSession = await tx.diningSession.count({
        where: {
          tableId: session.tableId,
          status: DiningSessionStatus.ACTIVE,
          id: { not: session.id },
        },
      });
      const table = await tx.restaurantTable.findUnique({ where: { id: session.tableId } });
      if (table?.status === TableStatus.OCCUPIED && anotherActiveSession === 0) {
        await tx.restaurantTable.update({
          where: { id: table.id },
          data: { status: TableStatus.AVAILABLE },
        });
      }
      await this.audit.record({
        action: 'SESSION_EXPIRED',
        resourceType: 'DiningSession',
        resourceId: session.id,
        metadata: {
          reason: 'IDLE_NO_ORDER',
          tableId: session.tableId,
          branchId: session.branchId,
        },
      }, tx);
      return candidate;
    });
  }
}
