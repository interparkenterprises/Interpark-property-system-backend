import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../src/lib/prisma.js';
import { generateAccountToken } from '../src/utils/accountToken.js';
import { comparePassword } from '../src/utils/hashPassword.js';
import { PersonnelActivationService } from '../src/services/personnelActivation.service.js';

const runIntegration = process.env.RUN_PERSONNEL_DB_INTEGRATION === '1';

test('PostgreSQL activation consumption and concurrent single-use enforcement', {
  skip: !runIntegration
}, async () => {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.equal(databaseUrl.hostname, '127.0.0.1');
  assert.equal(databaseUrl.pathname.slice(1), 'interpark_personnel_test');

  const managerId = randomUUID();
  const createdUserIds = [];
  const createdPersonnelIds = [];
  const service = new PersonnelActivationService(prisma);

  const createPendingAccount = async label => {
    const userId = randomUUID();
    const personnelId = randomUUID();
    const generated = generateAccountToken('PERSONNEL_ACTIVATION');
    createdUserIds.push(userId);
    createdPersonnelIds.push(personnelId);
    await prisma.user.create({
      data: {
        id: userId,
        name: `Activation Test ${label}`,
        email: `personnel-activation-${label}-${userId}@example.test`,
        password: 'unusable-test-hash',
        role: 'PERSONNEL',
        isApproved: false,
        canManagerLogin: false,
        isManagedUser: true,
        createdByManagerId: managerId
      }
    });
    await prisma.servicePersonnel.create({
      data: {
        id: personnelId,
        personnelType: 'EXTERNAL',
        name: `Activation Test ${label}`,
        email: `personnel-activation-${label}-${userId}@example.test`,
        jobRole: 'Integration tester',
        status: 'ACTIVE',
        portalAccessStatus: 'PENDING_ACTIVATION',
        userId,
        createdById: managerId
      }
    });
    const token = await prisma.accountToken.create({
      data: {
        userId,
        type: 'PERSONNEL_ACTIVATION',
        tokenHash: generated.tokenHash,
        expiresAt: generated.expiresAt,
        deliveryStatus: 'ACCEPTED',
        deliveryAttemptedAt: new Date(),
        deliveredAt: new Date(),
        providerMessageId: `test-${label}`
      }
    });
    return { userId, personnelId, generated, token };
  };

  try {
    await prisma.user.create({
      data: {
        id: managerId,
        name: 'Activation Integration Manager',
        email: `activation-manager-${managerId}@example.test`,
        password: 'integration-test-only',
        role: 'MANAGER',
        isApproved: true
      }
    });

    const first = await createPendingAccount('single');
    const activatedAt = new Date();
    await service.activate(first.generated.rawToken, 'Integration#Pass2026', {}, activatedAt);
    const [firstUser, firstPersonnel, firstToken] = await Promise.all([
      prisma.user.findUnique({ where: { id: first.userId } }),
      prisma.servicePersonnel.findUnique({ where: { id: first.personnelId } }),
      prisma.accountToken.findUnique({ where: { id: first.token.id } })
    ]);
    assert.equal(firstUser.isApproved, true);
    assert.equal(firstUser.canManagerLogin, true);
    assert.equal(await comparePassword('Integration#Pass2026', firstUser.password), true);
    assert.equal(firstPersonnel.portalAccessStatus, 'ACTIVE');
    assert.ok(firstToken.usedAt);

    const concurrent = await createPendingAccount('concurrent');
    const outcomes = await Promise.allSettled([
      service.activate(concurrent.generated.rawToken, 'Concurrent#Pass2026', {}),
      service.activate(concurrent.generated.rawToken, 'Concurrent#Pass2026', {})
    ]);
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length, 1);
  } finally {
    await prisma.rBACAuditLog.deleteMany({
      where: {
        OR: [
          { performedBy: { in: createdUserIds } },
          { targetUser: { in: createdUserIds } }
        ]
      }
    });
    await prisma.accountToken.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.servicePersonnel.deleteMany({ where: { id: { in: createdPersonnelIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: managerId } });
  }
});
