import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  ComplaintStatus, OrderStatus, PaymentIntentStatus, PaymentStatus, Prisma, UserRole,
} from '../generated/prisma/client';
import { Decimal } from '@prisma/client-runtime-utils';
import { PrismaService } from '../database/prisma.service';
import {
  AdminBillsQueryDto, AdminComplaintsQueryDto, AdminDateRangeQueryDto,
  AdminPageQueryDto, AdminRatingsQueryDto, SalesByItemQueryDto,
} from './admin-dashboard.dto';

type StaffActor = { sub: string; role: UserRole };

const zero = () => new Decimal(0);

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(actor: StaffActor, query: AdminDateRangeQueryDto) {
    const branchIds = await this.branchScope(actor, query.branchId);
    const { from, to } = this.dateRange(query);
    const orderWhere: Prisma.OrderWhereInput = {
      deletedAt: null,
      createdAt: { gte: from, lte: to },
      ...(branchIds ? { diningSession: { branchId: { in: branchIds } } } : {}),
    };
    const complaintWhere: Prisma.ComplaintWhereInput = {
      status: ComplaintStatus.OPEN,
      order: orderWhere,
    };
    const ratingWhere: Prisma.RatingWhereInput = {
      createdAt: { gte: new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000), lte: to },
      ...(branchIds ? { order: { diningSession: { branchId: { in: branchIds } } } } : {}),
    };

    const [orders, openComplaints, ratingAggregate, channels] = await Promise.all([
      this.prisma.order.findMany({
        where: orderWhere,
        select: {
          totalAmount: true,
          refundedAmount: true,
          createdAt: true,
        },
      }),
      this.prisma.complaint.count({ where: complaintWhere }),
      this.prisma.rating.aggregate({ where: ratingWhere, _avg: { rating: true }, _count: true }),
      this.prisma.paymentIntent.groupBy({
        by: ['channel'],
        where: {
          orderId: { not: null },
          order: orderWhere,
        },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
    ]);

    const grossRevenue = orders.reduce((total, order) => total.add(order.totalAmount), zero());
    const refunded = orders.reduce((total, order) => total.add(order.refundedAmount), zero());
    const netRevenue = grossRevenue.sub(refunded);
    const hourly = new Map<number, Decimal>();
    for (const order of orders) {
      const hour = order.createdAt.getUTCHours();
      hourly.set(hour, (hourly.get(hour) ?? zero()).add(order.totalAmount.sub(order.refundedAmount)));
    }

    return {
      range: { from, to },
      revenue: {
        gross: grossRevenue.toDecimalPlaces(2),
        refunded: refunded.toDecimalPlaces(2),
        net: netRevenue.toDecimalPlaces(2),
      },
      orders: orders.length,
      averageOrderValue: orders.length
        ? grossRevenue.div(orders.length).toDecimalPlaces(2)
        : zero(),
      openComplaints,
      averageRating: ratingAggregate._avg.rating
        ? Number(ratingAggregate._avg.rating.toFixed(2))
        : null,
      ratings: ratingAggregate._count,
      revenueByHour: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        revenue: (hourly.get(hour) ?? zero()).toDecimalPlaces(2),
      })),
      paymentChannels: channels.map((channel) => ({
        channel: channel.channel,
        count: channel._count._all,
        amount: channel._sum.totalAmount ?? zero(),
      })),
    };
  }

  async salesByItem(actor: StaffActor, query: SalesByItemQueryDto) {
    const branchIds = await this.branchScope(actor, query.branchId);
    const { from, to } = this.dateRange(query);
    const items = await this.prisma.orderItem.groupBy({
      by: ['menuItemId', 'itemName'],
      where: {
        order: {
          deletedAt: null,
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: from, lte: to },
          ...(branchIds ? { diningSession: { branchId: { in: branchIds } } } : {}),
        },
      },
      _sum: { quantity: true, lineTotal: true },
      _count: { _all: true },
      orderBy: { _sum: { lineTotal: 'desc' } },
      take: query.limit ?? 10,
    });
    return items.map((item) => ({
      menuItemId: item.menuItemId,
      itemName: item.itemName,
      quantity: item._sum.quantity ?? 0,
      revenue: item._sum.lineTotal ?? zero(),
      orderLines: item._count._all,
    }));
  }

  async bills(actor: StaffActor, query: AdminBillsQueryDto) {
    const branchIds = await this.branchScope(actor, query.branchId);
    const { page, size } = this.page(query);
    const where: Prisma.PaymentIntentWhereInput = {
      status: query.status ?? PaymentIntentStatus.PAYMENT_PENDING,
      ...(query.from || query.to ? {
        createdAt: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        },
      } : {}),
      ...(branchIds ? { diningSession: { branchId: { in: branchIds } } } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.paymentIntent.count({ where }),
      this.prisma.paymentIntent.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * size,
        take: size,
        select: {
          id: true,
          channel: true,
          collectionMethod: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          customer: { select: { id: true, name: true, phone: true, email: true } },
          collectorWaiter: { select: { id: true, firstName: true, lastName: true } },
          diningSession: {
            select: {
              branchId: true,
              table: { select: { id: true, tableNumber: true } },
            },
          },
        },
      }),
    ]);
    return { items, page, size, total };
  }

  async complaints(actor: StaffActor, query: AdminComplaintsQueryDto) {
    const branchIds = await this.branchScope(actor, query.branchId);
    const { page, size } = this.page(query);
    const where: Prisma.ComplaintWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? {
        createdAt: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        },
      } : {}),
      ...(branchIds ? { order: { diningSession: { branchId: { in: branchIds } } } } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.complaint.count({ where }),
      this.prisma.complaint.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              totalAmount: true,
              customer: { select: { id: true, name: true, phone: true, email: true } },
              diningSession: { select: { branchId: true, table: { select: { tableNumber: true } } } },
            },
          },
        },
      }),
    ]);
    return { items, page, size, total };
  }

  async refunds(actor: StaffActor, query: AdminPageQueryDto) {
    const branchIds = await this.branchScope(actor, query.branchId);
    const { page, size } = this.page(query);
    const where: Prisma.PaymentWhereInput = {
      status: PaymentStatus.REFUNDED,
      ...(query.from || query.to ? {
        refundedAt: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        },
      } : {}),
      ...(branchIds ? { order: { diningSession: { branchId: { in: branchIds } } } } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: { refundedAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
        include: {
          refundedBy: { select: { id: true, firstName: true, lastName: true } },
          order: { select: { id: true, orderNumber: true, totalAmount: true } },
        },
      }),
    ]);
    return { items, page, size, total };
  }

  async ratings(actor: StaffActor, query: AdminRatingsQueryDto) {
    const branchIds = await this.branchScope(actor, query.branchId);
    const { page, size } = this.page(query);
    const where: Prisma.RatingWhereInput = {
      ...(query.rating ? { rating: query.rating } : {}),
      ...(query.from || query.to ? {
        createdAt: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        },
      } : {}),
      ...(branchIds ? { order: { diningSession: { branchId: { in: branchIds } } } } : {}),
    };
    const [total, aggregate, distribution, items] = await Promise.all([
      this.prisma.rating.count({ where }),
      this.prisma.rating.aggregate({ where, _avg: { rating: true } }),
      this.prisma.rating.groupBy({ by: ['rating'], where, _count: { _all: true }, orderBy: { rating: 'asc' } }),
      this.prisma.rating.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              waiter: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);
    return {
      items,
      page,
      size,
      total,
      average: aggregate._avg.rating ? Number(aggregate._avg.rating.toFixed(2)) : null,
      distribution: distribution.map((entry) => ({ rating: entry.rating, count: entry._count._all })),
    };
  }

  private page(query: AdminPageQueryDto) {
    return { page: query.page ?? 1, size: query.size ?? 25 };
  }

  private dateRange(query: AdminDateRangeQueryDto) {
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    ));
    return { from, to: query.to ? new Date(query.to) : now };
  }

  private async branchScope(actor: StaffActor, requested?: string) {
    if (actor.role === UserRole.ADMIN) return requested ? [requested] : undefined;
    const assignments = await this.prisma.staffAssignment.findMany({
      where: { userId: actor.sub },
      select: { branchId: true },
    });
    const allowed = assignments.map((assignment) => assignment.branchId);
    if (requested && !allowed.includes(requested)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only view data from your assigned branches',
      });
    }
    return requested ? [requested] : allowed;
  }
}
