import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { RestaurantService } from './restaurant.service';

const actor = { sub: 'admin-1', role: UserRole.ADMIN };
const item = {
  id: 'item-1',
  branchId: 'branch-1',
  variants: [
    { id: 'v-quarter', name: 'Quarter' },
    { id: 'v-half', name: 'Half' },
  ],
  addonGroups: [],
};
const saved = {
  ...item,
  name: 'Hyderabadi Chicken Biryani',
  basePrice: 120,
  variants: [
    { id: 'v-quarter', name: 'Quarter', price: 110, isAvailable: true },
    { id: 'v-full', name: 'Full', price: 220, isAvailable: true },
  ],
  addonGroups: [],
};

function service(prisma: object, audit = { record: jest.fn() }) {
  return {
    audit,
    restaurant: new RestaurantService(
      prisma as never,
      { get: jest.fn() } as never,
      audit as never,
      {} as never,
      {} as never,
      { publish: jest.fn() } as never,
    ),
  };
}

describe('RestaurantService menu editing', () => {
  it('updates an item and retires a variant that an order already used', async () => {
    const tx = {
      menuItem: {
        update: jest.fn(),
        findFirstOrThrow: jest.fn().mockResolvedValue(saved),
      },
      menuItemVariant: { update: jest.fn(), create: jest.fn(), delete: jest.fn() },
      orderItem: {
        count: jest.fn().mockImplementation(({ where }: { where: { variantId: string } }) =>
          Promise.resolve(where.variantId === 'v-half' ? 2 : 0)),
      },
      menuItemAddonGroup: { update: jest.fn(), create: jest.fn(), delete: jest.fn() },
      menuItemAddon: { update: jest.fn(), create: jest.fn(), delete: jest.fn(), count: jest.fn() },
      orderItemAddon: { count: jest.fn() },
    };
    const prisma = {
      menuItem: { findFirst: jest.fn().mockResolvedValue(item) },
      menuCategory: { findFirst: jest.fn().mockResolvedValue({ id: 'cat-1', branchId: 'branch-1' }) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
      $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const { restaurant, audit } = service(prisma);

    const updated = await restaurant.updateMenuItem(actor, 'item-1', {
      categoryId: 'cat-1',
      name: 'Hyderabadi Chicken Biryani',
      basePrice: 120,
      variants: [
        { name: 'Quarter', price: 110 },
        { name: 'Full', price: 220 },
      ],
    });

    expect(updated).toEqual(saved);
    expect(tx.menuItemVariant.update).toHaveBeenCalledWith({
      where: { id: 'v-quarter' },
      data: { price: 110, isAvailable: true },
    });
    expect(tx.menuItemVariant.create).toHaveBeenCalledWith({
      data: { menuItemId: 'item-1', name: 'Full', price: 220 },
    });
    expect(tx.menuItemVariant.update).toHaveBeenCalledWith({
      where: { id: 'v-half' },
      data: { isAvailable: false },
    });
    expect(tx.menuItemVariant.delete).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'MENU_ITEM_UPDATED',
      resourceId: 'item-1',
    }), tx);
  });

  it('refuses a manager who is not assigned to the item branch', async () => {
    const prisma = {
      menuItem: { findFirst: jest.fn().mockResolvedValue(item) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
      staffAssignment: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const { restaurant } = service(prisma);

    await expect(restaurant.updateMenuItem(
      { sub: 'manager-1', role: UserRole.MANAGER },
      'item-1',
      { categoryId: 'cat-1', name: 'Biryani', basePrice: 100 },
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an assigned manager hide an item', async () => {
    const prisma = {
      menuItem: {
        findFirst: jest.fn().mockResolvedValue(item),
        update: jest.fn().mockResolvedValue({ id: 'item-1', isAvailable: false }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
      staffAssignment: { findUnique: jest.fn().mockResolvedValue({ id: 'assign-1' }) },
    };
    const { restaurant, audit } = service(prisma);

    await expect(restaurant.setMenuItemAvailability(
      { sub: 'manager-1', role: UserRole.MANAGER },
      'item-1',
      false,
    )).resolves.toEqual({ id: 'item-1', isAvailable: false });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'MENU_ITEM_UNAVAILABLE' }));
  });
});
