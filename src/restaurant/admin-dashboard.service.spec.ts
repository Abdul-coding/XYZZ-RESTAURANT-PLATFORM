import { ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client-runtime-utils';
import { PaymentIntentStatus, UserRole } from '../generated/prisma/client';
import { AdminDashboardService } from './admin-dashboard.service';

describe('AdminDashboardService', () => {
  const admin = { sub: 'admin-1', role: UserRole.ADMIN };
  const manager = { sub: 'manager-1', role: UserRole.MANAGER };

  it('returns overview totals, net revenue, hourly revenue, and payment channels', async () => {
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            totalAmount: new Decimal(100),
            refundedAmount: new Decimal(30),
            createdAt: new Date('2026-10-17T06:15:00.000Z'),
          },
          {
            totalAmount: new Decimal(200),
            refundedAmount: new Decimal(0),
            createdAt: new Date('2026-10-17T06:30:00.000Z'),
          },
        ]),
      },
      complaint: { count: jest.fn().mockResolvedValue(2) },
      rating: {
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 4.5 }, _count: 4 }),
      },
      paymentIntent: {
        groupBy: jest.fn().mockResolvedValue([
          {
            channel: 'ONLINE',
            _count: { _all: 2 },
            _sum: { totalAmount: new Decimal(300) },
          },
        ]),
      },
    };
    const service = new AdminDashboardService(prisma as never);

    const result = await service.overview(admin, {
      branchId: 'branch-1',
      from: '2026-10-17T00:00:00.000Z',
      to: '2026-10-17T23:59:59.999Z',
    });

    expect(result.orders).toBe(2);
    expect(result.revenue.gross.toString()).toBe('300');
    expect(result.revenue.refunded.toString()).toBe('30');
    expect(result.revenue.net.toString()).toBe('270');
    expect(result.averageOrderValue.toString()).toBe('150');
    expect(result.openComplaints).toBe(2);
    expect(result.averageRating).toBe(4.5);
    expect(result.revenueByHour[6].revenue.toString()).toBe('270');
    expect(result.paymentChannels[0]).toMatchObject({ channel: 'ONLINE', count: 2 });
  });

  it('lists pending bills for the selected branch', async () => {
    const prisma = {
      paymentIntent: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{ id: 'bill-1' }]),
      },
    };
    const service = new AdminDashboardService(prisma as never);

    const result = await service.bills(admin, { branchId: 'branch-1' });

    expect(result).toEqual({ items: [{ id: 'bill-1' }], page: 1, size: 25, total: 1 });
    expect(prisma.paymentIntent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: PaymentIntentStatus.PAYMENT_PENDING,
        diningSession: { branchId: { in: ['branch-1'] } },
      }),
    }));
  });

  it('rejects a manager requesting another branch', async () => {
    const prisma = {
      staffAssignment: {
        findMany: jest.fn().mockResolvedValue([{ branchId: 'branch-1' }]),
      },
      complaint: { count: jest.fn(), findMany: jest.fn() },
    };
    const service = new AdminDashboardService(prisma as never);

    await expect(service.complaints(manager, { branchId: 'branch-2' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.complaint.findMany).not.toHaveBeenCalled();
  });
});
