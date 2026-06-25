import { Decimal } from '@prisma/client-runtime-utils';

describe('pricing arithmetic', () => {
  it('uses decimal arithmetic for GST', () => {
    const subtotal = new Decimal(500);
    const tax = subtotal.mul(18).div(100).toDecimalPlaces(2);
    expect(tax.toString()).toBe('90');
    expect(subtotal.add(tax).toString()).toBe('590');
  });
});
