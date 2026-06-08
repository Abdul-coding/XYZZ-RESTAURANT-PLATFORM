import {
  PrismaClient, UserRole, WaiterStatus,
} from '@prisma/client';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const branch = await prisma.branch.upsert({
    where: { code: 'XYZZ-DEMO' },
    update: {},
    create: { code: 'XYZZ-DEMO', name: 'XYZZ Demo Branch', address: 'Demo Address' },
  });
  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@xyzz.local' },
    update: {},
    create: {
      firstName: 'Platform',
      lastName: 'Admin',
      email: 'admin@xyzz.local',
      passwordHash,
      role: UserRole.ADMIN,
    },
  });
  const waiter = await prisma.user.upsert({
    where: { email: 'waiter@xyzz.local' },
    update: {},
    create: {
      firstName: 'Demo',
      lastName: 'Waiter',
      email: 'waiter@xyzz.local',
      passwordHash,
      role: UserRole.WAITER,
    },
  });
  await prisma.staffAssignment.upsert({
    where: { userId_branchId: { userId: admin.id, branchId: branch.id } },
    update: {},
    create: { userId: admin.id, branchId: branch.id },
  });
  await prisma.staffAssignment.upsert({
    where: { userId_branchId: { userId: waiter.id, branchId: branch.id } },
    update: {},
    create: {
      userId: waiter.id,
      branchId: branch.id,
      waiterStatus: WaiterStatus.IDLE,
      lastIdleAt: new Date(),
    },
  });
  for (let tableNumber = 1; tableNumber <= 5; tableNumber++) {
    await prisma.restaurantTable.upsert({
      where: { branchId_tableNumber: { branchId: branch.id, tableNumber } },
      update: {},
      create: {
        branchId: branch.id,
        tableNumber,
        qrToken: `TBL_${randomBytes(24).toString('base64url')}`,
      },
    });
  }
  const existingTax = await prisma.taxConfiguration.findFirst({
    where: { branchId: branch.id, name: 'GST', isActive: true },
  });
  if (!existingTax) {
    await prisma.taxConfiguration.create({
      data: { branchId: branch.id, name: 'GST', percentage: 18 },
    });
  }
  console.log({ branchId: branch.id, adminEmail: 'admin@xyzz.local', password: 'ChangeMe123!' });
}

main().finally(() => prisma.$disconnect());
