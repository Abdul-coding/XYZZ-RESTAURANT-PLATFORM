import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EVENT_PUBLISHER, EventPublisher } from './event-publisher';
import { IdentityInput, normalizeIdentity, resolveCustomerMatch } from './customer-identity';
import { assertActiveSession } from './session-access';

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async identify(sessionId: string, dto: IdentityInput, token?: string) {
    const session = await this.requireSession(sessionId, token);
    const identity = normalizeIdentity(dto);
    const byPhone = identity.phone
      ? await this.prisma.customer.findUnique({ where: { phone: identity.phone } })
      : null;
    const byEmail = identity.email
      ? await this.prisma.customer.findUnique({ where: { email: identity.email } })
      : null;
    const match = resolveCustomerMatch(byPhone, byEmail);
    const customer = match
      ? await this.prisma.customer.update({
          where: { id: match.id },
          data: {
            phone: identity.phone ?? match.phone,
            email: identity.email ?? match.email,
            name: identity.name,
          },
        })
      : await this.prisma.customer.create({
          data: { phone: identity.phone, email: identity.email, name: identity.name },
        });
    const attached = await this.prisma.diningSession.update({
      where: { id: session.id },
      data: { customerId: customer.id },
    });
    this.events.publish(`session:${session.id}`, 'customer.identified', { customerId: customer.id });
    return { customer, session: attached };
  }

  private async requireSession(sessionId: string, token?: string) {
    const session = await this.prisma.diningSession.findUnique({ where: { id: sessionId } });
    assertActiveSession(session, token);
    await this.prisma.diningSession.update({
      where: { id: session.id }, data: { lastActiveAt: new Date() },
    });
    return session;
  }
}
