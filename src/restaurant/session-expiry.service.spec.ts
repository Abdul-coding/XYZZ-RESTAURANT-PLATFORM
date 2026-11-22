import { DiningSessionStatus, TableStatus } from '../generated/prisma/client';
import { SessionExpiryService } from './session-expiry.service';

describe('SessionExpiryService', () => {
  const now = new Date('2026-10-17T06:20:00.000Z');
  const stale = {
    id: 'session-1',
    tableId: 'table-1',
    branchId: 'branch-1',
    status: DiningSessionStatus.ACTIVE,
    startedAt: new Date('2026-10-17T06:00:00.000Z'),
  };

  function service(prisma: object, publish = jest.fn()) {
    return {
      publish,
      expiry: new SessionExpiryService(prisma as never, { record: jest.fn() } as never, { publish } as never),
    };
  }

  it('cancels an orderless session after 10 minutes and releases the table', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'ACTIVE' }]),
      diningSession: {
        findUnique: jest.fn().mockResolvedValue(stale),
        update: jest.fn().mockResolvedValue({ ...stale, status: DiningSessionStatus.CANCELLED }),
        count: jest.fn().mockResolvedValue(0),
      },
      order: { count: jest.fn().mockResolvedValue(0) },
      paymentIntent: { count: jest.fn().mockResolvedValue(0) },
      restaurantTable: {
        findUnique: jest.fn().mockResolvedValue({ id: 'table-1', status: TableStatus.OCCUPIED }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      diningSession: { findMany: jest.fn().mockResolvedValue([stale]) },
      $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const { expiry, publish } = service(prisma);

    const expired = await expiry.expireDueSessions(now);

    expect(expired.map((session) => session.id)).toEqual(['session-1']);
    expect(tx.diningSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { status: DiningSessionStatus.CANCELLED, endedAt: expect.any(Date) },
    });
    expect(tx.restaurantTable.update).toHaveBeenCalledWith({
      where: { id: 'table-1' },
      data: { status: TableStatus.AVAILABLE },
    });
    expect(publish).toHaveBeenCalledWith('session:session-1', 'session.expired', expect.objectContaining({
      reason: 'IDLE_NO_ORDER',
    }));
    expect(publish).toHaveBeenCalledWith('floor:branch-1', 'session.expired', expect.objectContaining({
      tableId: 'table-1',
    }));
  });

  it('leaves a session open when an order arrives before the lock is committed', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'ACTIVE' }]),
      diningSession: { findUnique: jest.fn().mockResolvedValue(stale) },
      order: { count: jest.fn().mockResolvedValue(1) },
      paymentIntent: { count: jest.fn() },
      restaurantTable: { update: jest.fn() },
    };
    const prisma = {
      diningSession: { findMany: jest.fn().mockResolvedValue([stale]) },
      $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const { expiry, publish } = service(prisma);

    await expect(expiry.expireDueSessions(now)).resolves.toEqual([]);
    expect(tx.restaurantTable.update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('closes a visit once every order is finished and nothing is waiting to be paid', async () => {
    const tx = {
      diningSession: {
        findUnique: jest.fn().mockResolvedValue(stale),
        update: jest.fn().mockResolvedValue({ ...stale, status: DiningSessionStatus.COMPLETED }),
        count: jest.fn().mockResolvedValue(0),
      },
      order: { count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1) },
      paymentIntent: { count: jest.fn().mockResolvedValue(0) },
      restaurantTable: { updateMany: jest.fn() },
    };
    const { expiry } = service({});

    const closed = await expiry.settleSession('session-1', tx as never);

    expect(closed?.status).toBe(DiningSessionStatus.COMPLETED);
    expect(tx.diningSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { status: DiningSessionStatus.COMPLETED, endedAt: expect.any(Date) },
    });
    expect(tx.restaurantTable.updateMany).toHaveBeenCalledWith({
      where: { id: 'table-1', status: TableStatus.OCCUPIED },
      data: { status: TableStatus.AVAILABLE },
    });
  });

  it('keeps the table occupied while an order is still open', async () => {
    const tx = {
      diningSession: { findUnique: jest.fn().mockResolvedValue(stale), update: jest.fn() },
      order: { count: jest.fn().mockResolvedValue(1) },
      paymentIntent: { count: jest.fn() },
      restaurantTable: { updateMany: jest.fn() },
    };
    const { expiry } = service({});

    await expect(expiry.settleSession('session-1', tx as never)).resolves.toBeNull();
    expect(tx.diningSession.update).not.toHaveBeenCalled();
  });

  it('leaves a session open while a pay-at-table bill is pending', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'ACTIVE' }]),
      diningSession: { findUnique: jest.fn().mockResolvedValue(stale) },
      order: { count: jest.fn().mockResolvedValue(0) },
      paymentIntent: { count: jest.fn().mockResolvedValue(1) },
      restaurantTable: { update: jest.fn() },
    };
    const prisma = {
      diningSession: { findMany: jest.fn().mockResolvedValue([stale]) },
      $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    await expect(service(prisma).expiry.expireDueSessions(now)).resolves.toEqual([]);
    expect(tx.restaurantTable.update).not.toHaveBeenCalled();
  });
});
