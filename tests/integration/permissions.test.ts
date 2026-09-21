import { afterAll, beforeEach, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { confirmWithdrawal } from '@/lib/inventory/confirm';
import { setStorage } from '@/lib/storage';
import { createSubmission } from '@/lib/withdrawals/create';
import { runExtraction } from '@/lib/withdrawals/extract';
import { describeWithDb } from '../helpers/db';
import {
  MemoryStorage,
  balanceFor,
  resetBalances,
  resetWorkingData,
  resusLocation,
  userWithRole,
} from '../helpers/factory';

/**
 * Who may do what, enforced where it counts — in the service, not only in the UI.
 */
describeWithDb('role permissions', () => {
  beforeEach(async () => {
    await resetWorkingData(prisma);
    await resetBalances(prisma);
    setStorage(new MemoryStorage());
  });

  afterAll(async () => {
    setStorage(null);
    await prisma.$disconnect();
  });

  async function nurseSubmission() {
    const nurse = await userWithRole(prisma, 'nurse');
    const location = await resusLocation(prisma);
    const { id } = await createSubmission({
      user: nurse,
      locationId: location.id,
      image: { data: Buffer.from(`photo-${Math.random()}`), mediaType: 'image/jpeg' },
      demoScenario: 'high_confidence',
    });
    await runExtraction(id);
    return { id, nurse };
  }

  it('lets a nurse confirm their own submission', async () => {
    const { id, nurse } = await nurseSubmission();
    await expect(confirmWithdrawal({ submissionId: id, actor: nurse })).resolves.toBeTruthy();
  });

  it("stops a nurse confirming somebody else's submission", async () => {
    const { id } = await nurseSubmission();
    const other = await prisma.user.create({
      data: { email: `other-${Date.now()}@demo.local`, name: 'Other Nurse', role: 'nurse', passwordHash: 'scrypt$aa$bb' },
    });
    const before = (await balanceFor(prisma, 'IVC-18G-BLUE')).quantityOnHand;

    await expect(confirmWithdrawal({ submissionId: id, actor: other })).rejects.toThrow(/belongs to someone else/i);
    expect((await balanceFor(prisma, 'IVC-18G-BLUE')).quantityOnHand).toBe(before);
  });

  it("lets a supply reviewer confirm another user's submission, recorded as theirs", async () => {
    const { id } = await nurseSubmission();
    const reviewer = await userWithRole(prisma, 'supply_reviewer');

    await confirmWithdrawal({ submissionId: id, actor: reviewer });

    const tx = await prisma.inventoryTransaction.findFirstOrThrow({ where: { submissionId: id } });
    expect(tx.actorRole).toBe('supply_reviewer');
    expect(tx.actorId).toBe(reviewer.id);
  });

  it('lets an admin confirm too', async () => {
    const { id } = await nurseSubmission();
    const admin = await userWithRole(prisma, 'admin');
    await expect(confirmWithdrawal({ submissionId: id, actor: admin })).resolves.toBeTruthy();
  });

  it('refuses a submission that does not exist', async () => {
    const nurse = await userWithRole(prisma, 'nurse');
    await expect(confirmWithdrawal({ submissionId: 'nope', actor: nurse })).rejects.toThrow(/no longer exists/i);
  });

  it('refuses a cancelled submission', async () => {
    const { id, nurse } = await nurseSubmission();
    await prisma.withdrawalSubmission.update({ where: { id }, data: { status: 'cancelled' } });
    await expect(confirmWithdrawal({ submissionId: id, actor: nurse })).rejects.toThrow();
    expect(await prisma.inventoryTransaction.count({ where: { submissionId: id } })).toBe(0);
  });
});
