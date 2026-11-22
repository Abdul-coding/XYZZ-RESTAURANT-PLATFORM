import { ConflictException } from '@nestjs/common';
import { CustomerService } from './customer.service';

describe('CustomerService.identify', () => {
  const session = {
    id: 'session-1',
    branchId: 'branch-1',
    sessionToken: 'DST_token',
    status: 'ACTIVE',
  };

  function service(prisma: object) {
    return new CustomerService(prisma as never, { publish: jest.fn() } as never);
  }

  it('creates a customer and attaches them to the session', async () => {
    const prisma = {
      diningSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        update: jest.fn()
          .mockResolvedValueOnce(session)
          .mockResolvedValueOnce({ ...session, customerId: 'cust-1' }),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'cust-1', phone: '+919876543210', email: 'alex@xyzz.com', name: null,
        }),
      },
    };
    const customers = service(prisma);

    const result = await customers.identify('session-1', {
      phone: '+91 98765 43210',
      email: 'Alex@XYZZ.com',
    }, 'DST_token');

    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: { phone: '+919876543210', email: 'alex@xyzz.com', name: undefined },
    });
    expect(prisma.diningSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { customerId: 'cust-1' },
    });
    expect(result.customer.id).toBe('cust-1');
  });

  it('reuses an existing customer by phone', async () => {
    const existing = { id: 'cust-1', phone: '+919876543210', email: null, name: null };
    const prisma = {
      diningSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        update: jest.fn()
          .mockResolvedValueOnce(session)
          .mockResolvedValueOnce({ ...session, customerId: 'cust-1' }),
      },
      customer: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(existing)
          .mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValue({ ...existing, email: 'alex@xyzz.com' }),
      },
    };

    await service(prisma).identify('session-1', {
      phone: '+919876543210',
      email: 'alex@xyzz.com',
    }, 'DST_token');

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { phone: '+919876543210', email: 'alex@xyzz.com', name: undefined },
    });
  });

  it('rejects mismatched phone and email owners', async () => {
    const prisma = {
      diningSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockResolvedValue(session),
      },
      customer: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 'a', phone: '+919876543210', email: null })
          .mockResolvedValueOnce({ id: 'b', phone: null, email: 'alex@xyzz.com' }),
      },
    };

    await expect(service(prisma).identify('session-1', {
      phone: '+919876543210',
      email: 'alex@xyzz.com',
    }, 'DST_token')).rejects.toBeInstanceOf(ConflictException);
  });
});
