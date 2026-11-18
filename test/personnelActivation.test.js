import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAccountToken } from '../src/utils/accountToken.js';
import {
  PersonnelActivationService,
  validatePersonnelPassword
} from '../src/services/personnelActivation.service.js';

const strongPassword = 'SecureWorker#2026';

const createHarness = ({
  tokenType = 'PERSONNEL_ACTIVATION',
  usedAt = null,
  expiresAt = new Date('2026-11-18T10:00:00Z'),
  deliveryStatus = 'ACCEPTED',
  personnelStatus = 'ACTIVE',
  portalAccessStatus = 'PENDING_ACTIVATION'
} = {}) => {
  const now = new Date('2026-11-17T10:00:00Z');
  const generated = generateAccountToken('PERSONNEL_ACTIVATION', now);
  const personnel = {
    id: 'personnel-1', status: personnelStatus, portalAccessStatus
  };
  const user = {
    id: 'user-1', role: 'PERSONNEL', isApproved: false, canManagerLogin: false,
    passwordChangedAt: null, servicePersonnel: personnel
  };
  const token = {
    id: 'token-1', userId: user.id, tokenHash: generated.tokenHash, type: tokenType,
    usedAt, expiresAt, deliveryStatus, user
  };
  const audits = [];
  const prisma = {
    $transaction: async callback => callback(prisma),
    accountToken: {
      findUnique: async ({ where }) => where.tokenHash === token.tokenHash ? token : null,
      updateMany: async ({ where, data }) => {
        if (where.id === token.id) {
          if (token.usedAt || token.expiresAt <= where.expiresAt.gt || token.deliveryStatus !== 'ACCEPTED') {
            return { count: 0 };
          }
          Object.assign(token, data);
          return { count: 1 };
        }
        return { count: 0 };
      }
    },
    user: {
      update: async ({ data }) => { Object.assign(user, data); return user; }
    },
    servicePersonnel: {
      update: async ({ data }) => { Object.assign(personnel, data); return personnel; }
    },
    rBACAuditLog: {
      create: async ({ data }) => { audits.push(data); return data; }
    }
  };
  return { service: new PersonnelActivationService(prisma), generated, token, user, personnel, audits, now };
};

test('valid activation consumes the token and enables the personnel account', async () => {
  const { service, generated, token, user, personnel, audits, now } = createHarness();
  const result = await service.activate(generated.rawToken, strongPassword, {}, now);
  assert.equal(result.activated, true);
  assert.equal(token.usedAt.getTime(), now.getTime());
  assert.equal(user.isApproved, true);
  assert.equal(user.canManagerLogin, true);
  assert.equal(user.passwordChangedAt.getTime(), now.getTime());
  assert.notEqual(user.password, strongPassword);
  assert.equal(personnel.portalAccessStatus, 'ACTIVE');
  assert.equal(audits[0].action, 'PERSONNEL_PORTAL_ACCOUNT_ACTIVATED');
});

test('expired activation tokens are rejected', async () => {
  const harness = createHarness({ expiresAt: new Date('2026-11-17T09:59:59Z') });
  await assert.rejects(
    harness.service.activate(harness.generated.rawToken, strongPassword, {}, harness.now),
    error => error.status === 400 && /invalid or expired/.test(error.message)
  );
});

test('used activation tokens are rejected', async () => {
  const harness = createHarness({ usedAt: new Date('2026-11-17T09:00:00Z') });
  await assert.rejects(
    harness.service.activate(harness.generated.rawToken, strongPassword, {}, harness.now),
    error => error.status === 400
  );
});

test('wrong-purpose tokens are rejected', async () => {
  const harness = createHarness({ tokenType: 'PERSONNEL_PASSWORD_RESET' });
  await assert.rejects(
    harness.service.activate(harness.generated.rawToken, strongPassword, {}, harness.now),
    error => error.status === 400
  );
});

test('disabled portal access cannot be reactivated with an old invitation', async () => {
  const harness = createHarness({ portalAccessStatus: 'DISABLED' });
  await assert.rejects(
    harness.service.activate(harness.generated.rawToken, strongPassword, {}, harness.now),
    error => error.status === 403 && /disabled/.test(error.message)
  );
  assert.equal(harness.user.isApproved, false);
});

test('password strength requires length and mixed character classes', () => {
  for (const password of ['Abc#123', 'alllowercase#2026', 'ALLUPPERCASE#2026', 'NoNumbersHere!', 'NoSpecialChar2026', 'Has Space#1A']) {
    assert.throws(() => validatePersonnelPassword(password));
  }
  assert.equal(validatePersonnelPassword('Abcd#123'), 'Abcd#123');
  assert.equal(validatePersonnelPassword(strongPassword), strongPassword);
});
