import { WaiterStatus } from '@prisma/client';
import { WaiterAssignmentService } from './waiter-assignment.service';

describe('WaiterAssignmentService', () => {
  it('locks and assigns an idle waiter before checking engaged waiters', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValueOnce([{
        id: 'assignment-1',
        userId: 'waiter-1',
        branchId: 'branch-1',
        activeOrders: 0,
      }]),
      staffAssignment: { update: jest.fn().mockResolvedValue({ userId: 'waiter-1' }) },
    };
    const service = new WaiterAssignmentService({} as never);

    await service.assignWaiter('branch-1', tx as never);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.staffAssignment.update).toHaveBeenCalledWith({
      where: { id: 'assignment-1' },
      data: {
        activeOrders: { increment: 1 },
        waiterStatus: WaiterStatus.ENGAGED,
        lastAssignedAt: expect.any(Date),
      },
    });
  });

  it('falls back to engaged waiters when no idle waiter is available', async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'assignment-2', userId: 'waiter-2', branchId: 'branch-1', activeOrders: 2 }]),
      staffAssignment: { update: jest.fn().mockResolvedValue({ userId: 'waiter-2' }) },
    };
    const service = new WaiterAssignmentService({} as never);

    await service.assignWaiter('branch-1', tx as never);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.staffAssignment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'assignment-2' },
    }));
  });

  it('returns a waiter to idle when their active order count reaches zero', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValueOnce([{
        id: 'assignment-1',
        userId: 'waiter-1',
        branchId: 'branch-1',
        activeOrders: 1,
        lastIdleAt: null,
      }]),
      staffAssignment: { update: jest.fn().mockResolvedValue({ waiterStatus: WaiterStatus.IDLE }) },
    };
    const service = new WaiterAssignmentService({} as never);

    await service.releaseWaiter('waiter-1', 'branch-1', tx as never);

    expect(tx.staffAssignment.update).toHaveBeenCalledWith({
      where: { id: 'assignment-1' },
      data: {
        activeOrders: 0,
        waiterStatus: WaiterStatus.IDLE,
        lastIdleAt: expect.any(Date),
      },
    });
  });
});
