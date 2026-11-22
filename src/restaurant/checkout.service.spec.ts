import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentChannel, PaymentIntentStatus } from '../generated/prisma/client';
import { CheckoutService } from './checkout.service';

describe('CheckoutService', () => {
  const session = {
    id: 'session-1',
    branchId: 'branch-1',
    customerId: 'cust-1',
    sessionToken: 'DST_token',
    status: 'ACTIVE',
  };
  const cart = {
    lines: [{
      requested: { menuItemId: 'item-1', quantity: 1, addonIds: [] },
      item: { id: 'item-1', name: 'Burger' },
      variant: undefined,
      addons: [],
      unitPrice: { toString: () => '100' },
      lineTotal: { toString: () => '100' },
    }],
    subtotal: 100,
    taxPercentage: 18,
    taxAmount: 18,
    total: 118,
  };

  it('rejects checkout before the customer is identified', async () => {
    const prisma = {
      diningSession: {
        findUnique: jest.fn().mockResolvedValue({ ...session, customerId: null }),
        update: jest.fn().mockResolvedValue({ ...session, customerId: null }),
      },
    };
    const checkout = new CheckoutService(
      prisma as never,
      { assignWaiter: jest.fn(), releaseWaiter: jest.fn() } as never,
      { calculateCart: jest.fn() } as never,
      { record: jest.fn() } as never,
      { publish: jest.fn() } as never,
    );

    await expect(checkout.createIntent({
      diningSessionId: 'session-1',
      branchId: 'branch-1',
      channel: PaymentChannel.PAY_AT_TABLE,
      items: [{ menuItemId: 'item-1', quantity: 1 }],
    }, 'DST_token')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('opens a pay-at-table bill, assigns a collector, and does not create an order', async () => {
    const prisma = {
      diningSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockResolvedValue(session),
      },
      paymentIntent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'bill-1',
          status: PaymentIntentStatus.PAYMENT_PENDING,
          collectorWaiterId: 'waiter-1',
          diningSessionId: 'session-1',
        }),
      },
      $transaction: jest.fn(async (fn: (tx: object) => Promise<unknown>) => fn({
        $queryRaw: jest.fn().mockResolvedValue([{ status: 'ACTIVE' }]),
        paymentIntent: {
          create: jest.fn().mockResolvedValue({
            id: 'bill-1',
            status: PaymentIntentStatus.PAYMENT_PENDING,
            collectorWaiterId: 'waiter-1',
            diningSessionId: 'session-1',
            channel: PaymentChannel.PAY_AT_TABLE,
          }),
        },
      })),
    };
    const assignWaiter = jest.fn().mockResolvedValue({ userId: 'waiter-1' });
    const restaurant = { calculateCart: jest.fn().mockResolvedValue(cart) };
    const events = { publish: jest.fn() };
    const checkout = new CheckoutService(
      prisma as never,
      { assignWaiter, releaseWaiter: jest.fn() } as never,
      restaurant as never,
      { record: jest.fn() } as never,
      events as never,
    );

    const bill = await checkout.createIntent({
      diningSessionId: 'session-1',
      branchId: 'branch-1',
      channel: PaymentChannel.PAY_AT_TABLE,
      items: [{ menuItemId: 'item-1', quantity: 1 }],
    }, 'DST_token');

    expect(assignWaiter).toHaveBeenCalled();
    expect(bill.status).toBe(PaymentIntentStatus.PAYMENT_PENDING);
    expect(events.publish).toHaveBeenCalledWith('session:session-1', 'bill.pending', expect.anything());
    expect(events.publish).not.toHaveBeenCalledWith(expect.stringMatching(/^kitchen:/), 'order.created', expect.anything());
  });

  it('merges new items into the existing unpaid session bill', async () => {
    const pending = {
      id: 'bill-1',
      channel: PaymentChannel.PAY_AT_TABLE,
      status: PaymentIntentStatus.PAYMENT_PENDING,
      cartSnapshot: [{ menuItemId: 'item-1', quantity: 1, addonIds: [] }],
      collectorWaiterId: 'waiter-1',
      diningSessionId: 'session-1',
    };
    const prisma = {
      diningSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockResolvedValue(session),
      },
      paymentIntent: {
        findFirst: jest.fn().mockResolvedValue(pending),
      },
      $transaction: jest.fn(async (fn: (tx: {
        $queryRaw: jest.Mock;
        paymentIntent: { update: jest.Mock };
      }) => Promise<unknown>) => fn({
        $queryRaw: jest.fn().mockResolvedValue([{ status: 'ACTIVE' }]),
        paymentIntent: {
          update: jest.fn().mockResolvedValue({ ...pending, totalAmount: 236 }),
        },
      })),
    };
    const checkout = new CheckoutService(
      prisma as never,
      { assignWaiter: jest.fn(), releaseWaiter: jest.fn() } as never,
      { calculateCart: jest.fn().mockResolvedValue({ ...cart, total: 236 }) } as never,
      { record: jest.fn() } as never,
      { publish: jest.fn() } as never,
    );

    await checkout.createIntent({
      diningSessionId: 'session-1',
      branchId: 'branch-1',
      channel: PaymentChannel.PAY_AT_TABLE,
      items: [{ menuItemId: 'item-1', quantity: 1 }],
    }, 'DST_token');

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('does not merge an online checkout into a pay-at-table bill', async () => {
    const prisma = {
      diningSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockResolvedValue(session),
      },
      paymentIntent: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'bill-1',
          channel: PaymentChannel.PAY_AT_TABLE,
          status: PaymentIntentStatus.PAYMENT_PENDING,
        }),
      },
    };
    const checkout = new CheckoutService(
      prisma as never,
      { assignWaiter: jest.fn(), releaseWaiter: jest.fn() } as never,
      { calculateCart: jest.fn() } as never,
      { record: jest.fn() } as never,
      { publish: jest.fn() } as never,
    );

    await expect(checkout.createIntent({
      diningSessionId: 'session-1',
      branchId: 'branch-1',
      channel: PaymentChannel.ONLINE,
      items: [{ menuItemId: 'item-1', quantity: 1 }],
    }, 'DST_token')).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates the kitchen order only after the waiter collects cash or card', async () => {
    const bill = {
      id: 'bill-1',
      diningSessionId: 'session-1',
      customerId: 'cust-1',
      collectorWaiterId: 'waiter-1',
      channel: PaymentChannel.PAY_AT_TABLE,
      status: PaymentIntentStatus.PAYMENT_PENDING,
      cartSnapshot: [{ menuItemId: 'item-1', quantity: 1, addonIds: [] }],
      subtotalAmount: 100,
      taxPercentage: 18,
      taxAmount: 18,
      totalAmount: 118,
      providerReference: null,
      diningSession: { id: 'session-1', branchId: 'branch-1' },
    };
    const createdOrder = {
      id: 'order-1',
      waiterId: 'waiter-1',
      diningSessionId: 'session-1',
      items: [],
      payments: [],
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'ACTIVE' }]),
      paymentIntent: {
        findUnique: jest.fn().mockResolvedValue(bill),
        update: jest.fn().mockResolvedValue({
          ...bill,
          status: PaymentIntentStatus.PAYMENT_SUCCESS,
          orderId: 'order-1',
        }),
      },
      order: { create: jest.fn().mockResolvedValue(createdOrder) },
      diningSession: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const assignWaiter = jest.fn();
    const events = { publish: jest.fn() };
    const checkout = new CheckoutService(
      prisma as never,
      { assignWaiter, releaseWaiter: jest.fn() } as never,
      { calculateCart: jest.fn().mockResolvedValue(cart) } as never,
      { record: jest.fn() } as never,
      events as never,
    );

    const order = await checkout.collectBill('bill-1', 'waiter-1', 'CASH');

    expect(assignWaiter).not.toHaveBeenCalled();
    expect(tx.order.create).toHaveBeenCalled();
    expect(order.id).toBe('order-1');
    expect(events.publish).toHaveBeenCalledWith('kitchen:branch-1', 'order.created', createdOrder);
    expect(events.publish).toHaveBeenCalledWith('session:session-1', 'order.created', createdOrder);
  });
});
