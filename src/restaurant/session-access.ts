import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DiningSessionStatus, Prisma } from '../generated/prisma/client';

export const EMPTY_SESSION_TIMEOUT_MS = 10 * 60 * 1000;

const ACTIVE_SESSION_MESSAGE = 'Valid active X-Session-Token required';
const EXPIRED_SESSION_MESSAGE = 'This table session expired because no order was placed. Scan the QR code again.';

export function emptySessionDeadline(startedAt: Date) {
  return new Date(startedAt.getTime() + EMPTY_SESSION_TIMEOUT_MS);
}

export function assertActiveSession<T extends { sessionToken: string; status: DiningSessionStatus }>(
  session: T | null,
  token?: string,
): asserts session is T {
  if (!session) {
    throw new NotFoundException({ code: 'SESSION_NOT_FOUND', message: 'Session not found' });
  }
  if (token && token === session.sessionToken && session.status === DiningSessionStatus.CANCELLED) {
    throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: EXPIRED_SESSION_MESSAGE });
  }
  if (!token || token !== session.sessionToken || session.status !== DiningSessionStatus.ACTIVE) {
    throw new UnauthorizedException(ACTIVE_SESSION_MESSAGE);
  }
}

export async function lockActiveDiningSession(tx: Prisma.TransactionClient, sessionId: string) {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status::text AS status
    FROM dining_sessions
    WHERE id::text = ${sessionId}
    FOR UPDATE
  `;
  if (rows[0]?.status !== DiningSessionStatus.ACTIVE) {
    throw new ConflictException({
      code: 'SESSION_EXPIRED',
      message: 'This table session is no longer active. Scan the QR code again.',
    });
  }
}
