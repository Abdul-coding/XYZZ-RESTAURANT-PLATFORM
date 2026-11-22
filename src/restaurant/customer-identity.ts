import { BadRequestException, ConflictException } from '@nestjs/common';

export type IdentityInput = {
  phone?: string;
  email?: string;
  name?: string;
};

export type NormalizedIdentity = {
  phone?: string;
  email?: string;
  name?: string;
};

export type CustomerMatch = {
  id: string;
  phone: string | null;
  email: string | null;
};

export function normalizeIdentity(input: IdentityInput): NormalizedIdentity {
  const email = input.email?.trim().toLowerCase() || undefined;
  const phone = normalizePhone(input.phone);
  const name = input.name?.trim() || undefined;
  if (!email && !phone) {
    throw new BadRequestException('Phone or email is required');
  }
  return { email, phone, name };
}

export function normalizePhone(phone?: string) {
  if (!phone?.trim()) return undefined;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  return trimmed.includes('+') || trimmed.startsWith('00') ? `+${digits}` : digits;
}

export function resolveCustomerMatch(
  byPhone: CustomerMatch | null,
  byEmail: CustomerMatch | null,
): CustomerMatch | null {
  if (byPhone && byEmail && byPhone.id !== byEmail.id) {
    throw new ConflictException({
      code: 'CUSTOMER_IDENTITY_CONFLICT',
      message: 'Phone and email belong to different customers',
    });
  }
  return byPhone ?? byEmail;
}
