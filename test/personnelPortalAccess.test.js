import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonnelPortalAccessService, PORTAL_RESEND_COOLDOWN_MS } from '../src/services/personnelPortalAccess.service.js';
import { createProtectPersonnel } from '../src/middleware/authMiddleware.js';
import { generatePersonnelToken } from '../src/utils/generateToken.js';

process.env.JWT_SECRET = 'personnel-portal-access-test-secret';

const manager = { id: 'manager-1', role: 'MANAGER' };
const otherManager = { id: 'manager-2', role: 'MANAGER' };
const admin = { id: 'admin-1', role: 'ADMIN' };

const createHarness = ({
  personnelOverrides = {},
  users = [],
  deliveryResult = { delivered: true, deliveryStatus: 'ACCEPTED', providerMessageId: 'email-1' }
} = {}) => {
  const state = {
    now: new Date('2026-11-17T10:00:00.000Z'),
    personnel: {
      id: 'personnel-1',
      createdById: manager.id,
      name: 'Jane Wanjiku',
      email: 'jane@example.test',
      userId: null,
      portalAccessStatus: null,
      ...personnelOverrides
    },
    users: [...users],
    tokens: [],
    audits: []
  };

  const hydratePersonnel = () => ({
    ...state.personnel,
    user: state.personnel.userId
      ? state.users.find(user => user.id === state.personnel.userId) || null
      : null
  });

  const prisma = {
    $transaction: async callback => callback(prisma),
    servicePersonnel: {
      findUnique: async ({ where }) => where.id === state.personnel.id ? hydratePersonnel() : null,
      update: async ({ where, data }) => {
        assert.equal(where.id, state.personnel.id);
        Object.assign(state.personnel, data);
        return hydratePersonnel();
      }
    },
    user: {
      findFirst: async ({ where }) => state.users.find(
        user => user.email.toLowerCase() === where.email.equals.toLowerCase()
      ) || null,
      findUnique: async ({ where }) => {
        if (where.email) return state.users.find(user => user.email === where.email) || null;
        const user = state.users.find(entry => entry.id === where.id) || null;
        if (!user) return null;
        return {
          ...user,
          servicePersonnel: state.personnel.userId === user.id
            ? {
                id: state.personnel.id,
                status: state.personnel.status || 'ACTIVE',
                portalAccessStatus: state.personnel.portalAccessStatus
              }
            : null
        };
      },
      create: async ({ data }) => {
        const user = {
          id: `user-${state.users.length + 1}`,
          passwordChangedAt: null,
          ...data
        };
        state.users.push(user);
        return user;
      },
      update: async ({ where, data }) => {
        const user = state.users.find(entry => entry.id === where.id);
        Object.assign(user, data);
        return { ...user };
      }
    },
    accountToken: {
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const token of state.tokens) {
          const typeMatches = Array.isArray(where.type?.in)
            ? where.type.in.includes(token.type)
            : token.type === where.type;
          if (token.userId === where.userId && typeMatches && (!where.usedAt || token.usedAt === null)) {
            Object.assign(token, data);
            count += 1;
          }
        }
        return { count };
      },
      create: async ({ data }) => {
        const token = {
          id: `token-${state.tokens.length + 1}`,
          usedAt: null,
          createdAt: state.now,
          deliveryStatus: 'PREPARED',
          ...data
        };
        state.tokens.push(token);
        return token;
      },
      update: async ({ where, data }) => {
        const token = state.tokens.find(entry => entry.id === where.id);
        Object.assign(token, data);
        return token;
      },
      findFirst: async ({ where }) => {
        return [...state.tokens]
          .filter(token => token.userId === where.userId
            && token.type === where.type
            && (!where.deliveryStatus || token.deliveryStatus !== where.deliveryStatus.not))
          .sort((a, b) => b.createdAt - a.createdAt)[0] || null;
      }
    },
    rBACAuditLog: {
      create: async ({ data }) => {
        state.audits.push(data);
        return data;
      }
    }
  };

  const delivery = {
    calls: [],
    async deliverActivationInvitation(input) {
      this.calls.push(input);
      return deliveryResult;
    }
  };
  return { state, prisma, delivery, service: new PersonnelPortalAccessService(prisma, delivery) };
};

test('only the profile creator or an administrator can manage portal access', async () => {
  const { service } = createHarness();
  assert.equal((await service.getAccess(manager, 'personnel-1')).portalState, 'NOT_GRANTED');
  assert.equal((await service.getAccess(admin, 'personnel-1')).portalState, 'NOT_GRANTED');
  await assert.rejects(
    service.getAccess(otherManager, 'personnel-1'),
    error => error.status === 403 && /creator/.test(error.message)
  );
});

test('property access alone cannot authorize a different manager', async () => {
  const { service } = createHarness({
    personnelOverrides: { assignments: [{ propertyId: 'shared-property' }] }
  });
  await assert.rejects(service.getAccess(otherManager, 'personnel-1'), error => error.status === 403);
});

test('invite creates a linked pending PERSONNEL account and hashed activation token', async () => {
  const { service, state, delivery } = createHarness();
  const result = await service.invite(manager, 'personnel-1', {}, state.now);
  const user = state.users[0];

  assert.equal(user.role, 'PERSONNEL');
  assert.equal(user.isApproved, false);
  assert.equal(user.canManagerLogin, false);
  assert.equal(user.passwordChangedAt, null);
  assert.equal(state.personnel.userId, user.id);
  assert.equal(state.tokens.length, 1);
  assert.equal(state.tokens[0].tokenHash.length, 64);
  assert.equal(state.tokens[0].expiresAt - state.now, 24 * 60 * 60 * 1000);
  assert.equal(result.portalState, 'PENDING_ACTIVATION');
  assert.deepEqual(result.invitation.delivered, true);
  assert.equal(delivery.calls.length, 1);
  assert.equal(state.audits[0].action, 'PERSONNEL_PORTAL_ACCESS_GRANTED');

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /rawToken|tokenHash|password/i);
});

test('ordinary personnel creation remains independent from User creation', async () => {
  const { state } = createHarness();
  assert.equal(state.personnel.userId, null);
  assert.equal(state.users.length, 0);
});

test('invite rejects an email already used by an ERP account', async () => {
  const existing = { id: 'erp-user', email: 'Jane@Example.Test', role: 'MANAGER' };
  const { service, state } = createHarness({ users: [existing] });
  await assert.rejects(service.invite(manager, 'personnel-1', {}, state.now), error => error.status === 409);
  assert.equal(state.users.length, 1);
  assert.equal(state.tokens.length, 0);
});

test('resend enforces cooldown then invalidates the previous unused token', async () => {
  const { service, state } = createHarness();
  await service.invite(manager, 'personnel-1', {}, state.now);
  await assert.rejects(
    service.resend(manager, 'personnel-1', {}, new Date(state.now.getTime() + 60_000)),
    error => error.status === 429 && error.retryAfterSeconds > 0
  );

  const resendTime = new Date(state.now.getTime() + PORTAL_RESEND_COOLDOWN_MS + 1);
  state.now = resendTime;
  const result = await service.resend(manager, 'personnel-1', {}, resendTime);
  assert.equal(state.tokens.length, 2);
  assert.equal(state.tokens[0].usedAt.getTime(), resendTime.getTime());
  assert.equal(state.tokens[1].usedAt, null);
  assert.equal(result.invitation.delivered, true);
  assert.equal(state.audits.at(-1).action, 'PERSONNEL_PORTAL_INVITATION_RESENT');
});

test('failed delivery is reported accurately and can be retried without the delivery cooldown', async () => {
  const { service, state } = createHarness({
    deliveryResult: { delivered: false, deliveryStatus: 'FAILED', errorCode: 'PROVIDER_REJECTED' }
  });
  const invite = await service.invite(manager, 'personnel-1', {}, state.now);
  assert.equal(invite.invitation.delivered, false);
  assert.equal(invite.invitation.deliveryStatus, 'FAILED');
  assert.equal(state.tokens[0].deliveryStatus, 'FAILED');

  state.now = new Date(state.now.getTime() + 1_000);
  const resend = await service.resend(manager, 'personnel-1', {}, state.now);
  assert.equal(resend.invitation.delivered, false);
  assert.equal(state.tokens.length, 2);
  assert.ok(state.tokens[0].usedAt instanceof Date);
});

test('disable immediately blocks an existing personnel JWT and invalidates tokens', async () => {
  const { service, state, prisma } = createHarness();
  await service.invite(manager, 'personnel-1', {}, state.now);
  const user = state.users[0];
  user.passwordChangedAt = new Date('2026-11-17T10:05:00.000Z');
  user.isApproved = true;
  user.canManagerLogin = true;
  state.tokens.push({
    id: 'reset-1', userId: user.id, type: 'PERSONNEL_PASSWORD_RESET', usedAt: null, createdAt: state.now
  });
  const originalPasswordChangedAt = user.passwordChangedAt;
  const token = generatePersonnelToken(user.id, { passwordChangedAt: originalPasswordChangedAt });

  const disabledAt = new Date('2026-11-17T11:00:00.000Z');
  await service.disable(manager, 'personnel-1', {}, disabledAt);
  assert.equal(user.isApproved, false);
  assert.equal(user.canManagerLogin, false);
  assert.equal(user.passwordChangedAt, disabledAt);
  assert.ok(state.tokens.every(entry => entry.usedAt instanceof Date));

  const req = { headers: { cookie: `personnel_token=${encodeURIComponent(token)}` }, query: {}, cookies: {} };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let nextCalled = false;
  await createProtectPersonnel(prisma)(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);

  await service.enable(manager, 'personnel-1', {}, new Date('2026-11-17T11:01:00.000Z'));
  res.statusCode = 200;
  await createProtectPersonnel(prisma)(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('re-enabling an activated worker retains the password and enables login', async () => {
  const activatedUser = {
    id: 'user-1', email: 'jane@example.test', password: 'existing-hash', role: 'PERSONNEL',
    isApproved: false, canManagerLogin: false, passwordChangedAt: new Date('2026-11-01T10:00:00Z')
  };
  const { service, state } = createHarness({
    personnelOverrides: { userId: activatedUser.id }, users: [activatedUser]
  });
  const result = await service.enable(manager, 'personnel-1', {}, state.now);
  assert.equal(activatedUser.password, 'existing-hash');
  assert.equal(activatedUser.isApproved, true);
  assert.equal(activatedUser.canManagerLogin, true);
  assert.equal(result.portalState, 'ENABLED');
  assert.equal(result.invitation, null);
});

test('re-enabling a never-activated worker keeps login disabled and prepares a new invitation', async () => {
  const pendingUser = {
    id: 'user-1', email: 'jane@example.test', password: 'random-hash', role: 'PERSONNEL',
    isApproved: false, canManagerLogin: false, passwordChangedAt: null
  };
  const { service, state } = createHarness({
    personnelOverrides: { userId: pendingUser.id }, users: [pendingUser]
  });
  const result = await service.enable(manager, 'personnel-1', {}, state.now);
  assert.equal(pendingUser.isApproved, false);
  assert.equal(pendingUser.canManagerLogin, false);
  assert.equal(result.portalState, 'PENDING_ACTIVATION');
  assert.equal(result.invitation.delivered, true);
  assert.equal(state.tokens.length, 1);
});
