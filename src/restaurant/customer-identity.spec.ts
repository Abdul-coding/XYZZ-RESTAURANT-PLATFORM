import { ConflictException } from '@nestjs/common';
import { normalizeIdentity, resolveCustomerMatch } from './customer-identity';

describe('customer identity', () => {
  it('requires phone or email', () => {
    expect(() => normalizeIdentity({})).toThrow('Phone or email is required');
  });

  it('normalizes email and phone', () => {
    expect(normalizeIdentity({
      email: '  Alex@XYZZ.com ',
      phone: ' +91 98765 43210 ',
    })).toEqual({
      email: 'alex@xyzz.com',
      phone: '+919876543210',
    });
  });

  it('reuses a customer when phone or email matches the same record', () => {
    const existing = { id: 'c1', phone: '+919876543210', email: 'alex@xyzz.com' };
    expect(resolveCustomerMatch(existing, null)).toBe(existing);
  });

  it('rejects phone and email that belong to different customers', () => {
    expect(() => resolveCustomerMatch(
      { id: 'by-phone', phone: '+919876543210', email: null },
      { id: 'by-email', phone: null, email: 'alex@xyzz.com' },
    )).toThrow(ConflictException);
  });
});
