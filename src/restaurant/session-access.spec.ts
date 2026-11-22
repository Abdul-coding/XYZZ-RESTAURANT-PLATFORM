import { DiningSessionStatus } from '../generated/prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { assertActiveSession, emptySessionDeadline, EMPTY_SESSION_TIMEOUT_MS } from './session-access';

describe('session access', () => {
  const session = { sessionToken: 'DST_token', status: DiningSessionStatus.ACTIVE };

  it('sets the empty-session deadline 10 minutes after opening', () => {
    const startedAt = new Date('2026-10-17T06:00:00.000Z');
    expect(emptySessionDeadline(startedAt).getTime() - startedAt.getTime()).toBe(EMPTY_SESSION_TIMEOUT_MS);
  });

  it('rejects an expired session token with SESSION_EXPIRED', () => {
    expect(() => assertActiveSession(
      { ...session, status: DiningSessionStatus.CANCELLED },
      session.sessionToken,
    )).toThrow(UnauthorizedException);
    try {
      assertActiveSession({ ...session, status: DiningSessionStatus.CANCELLED }, session.sessionToken);
    } catch (error) {
      expect(error).toMatchObject({
        response: {
          code: 'SESSION_EXPIRED',
          message: 'This table session expired because no order was placed. Scan the QR code again.',
        },
      });
    }
  });

  it('accepts the token for an active session', () => {
    expect(() => assertActiveSession(session, session.sessionToken)).not.toThrow();
  });
});
