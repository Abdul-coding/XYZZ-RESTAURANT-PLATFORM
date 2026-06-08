import { Injectable } from '@nestjs/common';
import { Prisma, StaffAssignment, WaiterStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class WaiterAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async assignWaiter(
    branchId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<StaffAssignment | null> {
    const [idleWaiter] = await tx.$queryRaw<StaffAssignment[]>`
      SELECT sa.*
      FROM staff_assignments sa
      INNER JOIN users u ON u.id = sa."userId"
      WHERE sa."branchId" = ${branchId}
        AND sa."waiterStatus" = 'IDLE'::"WaiterStatus"
        AND u.role = 'WAITER'::"UserRole"
        AND u."isActive" = true
        AND u."deletedAt" IS NULL
      ORDER BY sa."lastIdleAt" ASC NULLS FIRST, sa."createdAt" ASC
      LIMIT 1
      FOR UPDATE OF sa SKIP LOCKED
    `;

    const selected = idleWaiter ?? (await this.findEngagedWaiter(branchId, tx));
    if (!selected) return null;

    return tx.staffAssignment.update({
      where: { id: selected.id },
      data: {
        activeOrders: { increment: 1 },
        waiterStatus: WaiterStatus.ENGAGED,
        lastAssignedAt: new Date(),
      },
    });
  }

  async releaseWaiter(
    userId: string,
    branchId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<StaffAssignment | null> {
    const [assignment] = await tx.$queryRaw<StaffAssignment[]>`
      SELECT *
      FROM staff_assignments
      WHERE "userId" = ${userId}
        AND "branchId" = ${branchId}
      ORDER BY "updatedAt" DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    if (!assignment) return null;

    const nextActiveOrders = Math.max(assignment.activeOrders - 1, 0);
    return tx.staffAssignment.update({
      where: { id: assignment.id },
      data: {
        activeOrders: nextActiveOrders,
        waiterStatus: nextActiveOrders > 0 ? WaiterStatus.ENGAGED : WaiterStatus.IDLE,
        lastIdleAt: nextActiveOrders === 0 ? new Date() : assignment.lastIdleAt,
      },
    });
  }

  private async findEngagedWaiter(
    branchId: string,
    tx: Prisma.TransactionClient,
  ): Promise<StaffAssignment | null> {
    const [waiter] = await tx.$queryRaw<StaffAssignment[]>`
      SELECT sa.*
      FROM staff_assignments sa
      INNER JOIN users u ON u.id = sa."userId"
      WHERE sa."branchId" = ${branchId}
        AND sa."waiterStatus" = 'ENGAGED'::"WaiterStatus"
        AND u.role = 'WAITER'::"UserRole"
        AND u."isActive" = true
        AND u."deletedAt" IS NULL
      ORDER BY sa."activeOrders" ASC, sa."lastAssignedAt" ASC NULLS FIRST, sa."createdAt" ASC
      LIMIT 1
      FOR UPDATE OF sa SKIP LOCKED
    `;
    return waiter ?? null;
  }
}
