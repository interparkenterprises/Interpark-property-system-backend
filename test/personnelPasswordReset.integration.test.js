import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../src/lib/prisma.js';
import { generateAccountToken } from '../src/utils/accountToken.js';
import { comparePassword, hashPassword } from '../src/utils/hashPassword.js';
import { generatePersonnelToken } from '../src/utils/generateToken.js';
import { createProtectPersonnel } from '../src/middleware/authMiddleware.js';
import { PersonnelPasswordResetService } from '../src/services/personnelPasswordReset.service.js';

const runIntegration = process.env.RUN_PERSONNEL_DB_INTEGRATION === '1';
process.env.JWT_SECRET ||= 'personnel-password-reset-integration-secret';

test('PostgreSQL password reset is atomic and invalidates the previous personnel session', {
  skip: !runIntegration
}, async () => {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.equal(databaseUrl.hostname, '127.0.0.1');
  assert.equal(databaseUrl.pathname.slice(1), 'interpark_personnel_test');

  const managerId = randomUUID();
  const userId = randomUUID();
  const personnelId = randomUUID();
  const oldPasswordChangedAt = new Date(Date.now() - 60_000);
  const generated = generateAccountToken('PERSONNEL_PASSWORD_RESET');
  const delivery = { deliverPasswordReset: async () => {
    throw new Error('Delivery is not used during reset consumption');
  } };
  const service = new PersonnelPasswordResetService(prisma, delivery);

  try {
    await prisma.user.create({ data: {
      id: managerId, name: 'Reset Integration Manager',
      email: `reset-manager-${managerId}@example.test`, password: 'test-only',
      role: 'MANAGER', isApproved: true
    } });
    await prisma.user.create({ data: {
      id: userId, name: 'Reset Integration Worker',
      email: `reset-worker-${userId}@example.test`, password: await hashPassword('OldPersonnel#Pass2026'),
      role: 'PERSONNEL', isApproved: true, canManagerLogin: true,
      passwordChangedAt: oldPasswordChangedAt, isManagedUser: true, createdByManagerId: managerId
    } });
    await prisma.servicePersonnel.create({ data: {
      id: personnelId, personnelType: 'EXTERNAL', name: 'Reset Integration Worker',
      email: `reset-worker-${userId}@example.test`, jobRole: 'Security officer',
      status: 'ACTIVE', portalAccessStatus: 'ACTIVE', userId, createdById: managerId
    } });
    await prisma.accountToken.create({ data: {
      userId, type: 'PERSONNEL_PASSWORD_RESET', tokenHash: generated.tokenHash,
      expiresAt: generated.expiresAt, deliveryStatus: 'ACCEPTED',
      deliveryAttemptedAt: new Date(), deliveredAt: new Date(), providerMessageId: 'integration-reset'
    } });

    const oldSession = generatePersonnelToken(userId, {
      csrfHash: 'integration-csrf-hash', passwordChangedAt: oldPasswordChangedAt
    });
    const resetAt = new Date();
    const outcomes = await Promise.allSettled([
      service.reset(generated.rawToken, 'NewPersonnel#Pass2026', {}, resetAt),
      service.reset(generated.rawToken, 'NewPersonnel#Pass2026', {}, resetAt)
    ]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);

    const [user, token, audits] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.accountToken.findUnique({ where: { tokenHash: generated.tokenHash } }),
      prisma.rBACAuditLog.findMany({ where: { action: 'PERSONNEL_PORTAL_PASSWORD_RESET', targetUser: userId } })
    ]);
    assert.equal(await comparePassword('NewPersonnel#Pass2026', user.password), true);
    assert.equal(user.passwordChangedAt.getTime(), resetAt.getTime());
    assert.ok(token.usedAt);
    assert.equal(audits.length, 1);

    const req = { headers: { cookie: `personnel_token=${oldSession}` }, cookies: {} };
    const response = { statusCode: 200, body: null };
    const res = {
      status(code) { response.statusCode = code; return this; },
      json(body) { response.body = body; return this; }
    };
    let nextCalled = false;
    await createProtectPersonnel(prisma)(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 401);
  } finally {
    await prisma.rBACAuditLog.deleteMany({ where: {
      OR: [{ performedBy: userId }, { targetUser: userId }]
    } });
    await prisma.accountToken.deleteMany({ where: { userId } });
    await prisma.servicePersonnel.deleteMany({ where: { id: personnelId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.user.deleteMany({ where: { id: managerId } });
  }
});
