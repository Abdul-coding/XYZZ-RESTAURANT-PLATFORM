import { NotFoundException } from '@nestjs/common';
import { RestaurantService } from './restaurant.service';

describe('RestaurantService table QR', () => {
  const table = {
    id: 'table-1',
    branchId: 'branch-1',
    tableNumber: 4,
    qrToken: 'TBL_token',
    deletedAt: null,
  };

  function service(prisma: object, appUrl?: string) {
    return new RestaurantService(
      prisma as never,
      { get: () => appUrl } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  it('lists tables with the printable customer URL', async () => {
    const prisma = {
      branch: { findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
      restaurantTable: { findMany: jest.fn().mockResolvedValue([table]) },
    };

    const result = await service(prisma, 'https://order.xyzz.com').listTables('branch-1');

    expect(result).toEqual([
      { ...table, qrUrl: 'https://order.xyzz.com/t/TBL_token' },
    ]);
  });

  it('returns a PNG named for the table number', async () => {
    const prisma = {
      restaurantTable: { findFirst: jest.fn().mockResolvedValue(table) },
    };

    const image = await service(prisma).tableQrImage('table-1');

    expect(image.filename).toBe('table-4.png');
    expect(image.png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('rejects a missing table when downloading the QR', async () => {
    const prisma = {
      restaurantTable: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    await expect(service(prisma).tableQrImage('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
