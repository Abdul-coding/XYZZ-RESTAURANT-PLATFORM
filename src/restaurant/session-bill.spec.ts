import { mergeBillItems } from './session-bill';

describe('session bill merge', () => {
  it('appends new lines onto an unpaid bill', () => {
    const merged = mergeBillItems(
      [{ menuItemId: 'burger', quantity: 1, variantId: undefined, addonIds: [] }],
      [{ menuItemId: 'fries', quantity: 2, variantId: undefined, addonIds: [] }],
    );
    expect(merged).toEqual([
      { menuItemId: 'burger', quantity: 1, variantId: undefined, addonIds: [] },
      { menuItemId: 'fries', quantity: 2, variantId: undefined, addonIds: [] },
    ]);
  });

  it('increases quantity when the same line is added again', () => {
    const merged = mergeBillItems(
      [{ menuItemId: 'burger', quantity: 1, variantId: 'large', addonIds: ['cheese'] }],
      [{ menuItemId: 'burger', quantity: 2, variantId: 'large', addonIds: ['cheese'] }],
    );
    expect(merged).toEqual([
      { menuItemId: 'burger', quantity: 3, variantId: 'large', addonIds: ['cheese'] },
    ]);
  });
});
