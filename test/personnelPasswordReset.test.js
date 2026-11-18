import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePassword } from '../src/utils/hashPassword.js';
import { PersonnelPasswordResetService, PERSONNEL_PASSWORD_RESET_RESPONSE } from '../src/services/personnelPasswordReset.service.js';

const now = new Date('2026-11-17T09:00:00.000Z');

const createHarness = ({ userOverrides = {}, deliveryResult } = {}) => {
  const user = {
    id: 'user-1', name: 'Test Worker', email: 'worker@example.test', role: 'PERSONNEL',
    isApproved: true, canManagerLogin: true, passwordChangedAt: new Date('2026-11-16T09:00:00Z'),
    servicePersonnel: { id: 'personnel-1', status: 'ACTIVE', portalAccessStatus: 'ACTIVE' },
    ...userOverrides
  };
  const state = { user, tokens: [], audits: [], delivered: [] };
  const accountToken = {
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const token of state.tokens) {
        const idMatches = typeof where.id === 'object' ? token.id !== where.id.not : !where.id || token.id === where.id;
        const matches = idMatches && (!where.userId || token.userId === where.userId)
          && (!where.type || token.type === where.type)
          && (where.usedAt !== null || token.usedAt === null)
          && (!where.deliveryStatus || token.deliveryStatus === where.deliveryStatus)
          && (!where.expiresAt?.gt || token.expiresAt > where.expiresAt.gt);
        if (matches) { Object.assign(token, data); count += 1; }
      }
      return { count };
    },
    create: async ({ data }) => {
      const token = { id: `token-${state.tokens.length + 1}`, usedAt: null, ...data };
      state.tokens.push(token);
      return { id: token.id };
    },
    update: async ({ where, data }) => {
      const token = state.tokens.find(item => item.id === where.id);
      Object.assign(token, data);
      return token;
    },
    findUnique: async ({ where }) => {
      const token = state.tokens.find(item => item.tokenHash === where.tokenHash);
      return token ? { ...token, user: state.user } : null;
    }
  };
  const prisma = {
    user: {
      findFirst: async ({ where }) => state.user.email.toLowerCase() === where.email.equals ? state.user : null,
      findUnique: async ({ where }) => where.id === state.user.id ? state.user : null,
      update: async ({ data }) => { Object.assign(state.user, data); return state.user; }
    },
    accountToken,
    rBACAuditLog: { create: async ({ data }) => { state.audits.push(data); return data; } }
  };
  prisma.$transaction = async callback => callback(prisma);
  const delivery = {
    deliverPasswordReset: async payload => {
      state.delivered.push(payload);
      return deliveryResult || { delivered: true, deliveryStatus: 'ACCEPTED', providerMessageId: 'message-1' };
    }
  };
  return { state, service: new PersonnelPasswordResetService(prisma, delivery) };
};

test('forgot password normalizes email, stores only a hash and returns a generic response', async () => {
  const { state, service } = createHarness();
  assert.deepEqual(await service.request('  WORKER@EXAMPLE.TEST  ', now), { message: PERSONNEL_PASSWORD_RESET_RESPONSE });
  assert.equal(state.tokens.length, 1);
  assert.equal(state.tokens[0].type, 'PERSONNEL_PASSWORD_RESET');
  assert.equal(state.tokens[0].expiresAt.getTime() - now.getTime(), 30 * 60 * 1000);
  assert.equal(Object.hasOwn(state.tokens[0], 'rawToken'), false);
  assert.equal(state.tokens[0].deliveryStatus, 'ACCEPTED');
});

test('unknown, ERP, disabled and inactive accounts get the same generic response without a token', async () => {
  const cases = [
    ['missing@example.test', {}],
    ['worker@example.test', { role: 'MANAGER' }],
    ['worker@example.test', { canManagerLogin: false }],
    ['worker@example.test', { servicePersonnel: { id: 'p', status: 'INACTIVE', portalAccessStatus: 'ACTIVE' } }]
  ];
  for (const [email, overrides] of cases) {
    const { state, service } = createHarness({ userOverrides: overrides });
    assert.deepEqual(await service.request(email, now), { message: PERSONNEL_PASSWORD_RESET_RESPONSE });
    assert.equal(state.tokens.length, 0);
    assert.equal(state.delivered.length, 0);
  }
});

test('email failure is recorded without changing the public response', async () => {
  const { state, service } = createHarness({ deliveryResult: {
    delivered: false, deliveryStatus: 'FAILED', errorCode: 'PROVIDER_ERROR'
  } });
  assert.deepEqual(await service.request('worker@example.test', now), { message: PERSONNEL_PASSWORD_RESET_RESPONSE });
  assert.equal(state.tokens[0].deliveryStatus, 'FAILED');
  assert.equal(state.tokens[0].deliveryErrorCode, 'PROVIDER_ERROR');
});

test('valid reset consumes tokens, changes password and creates a safe audit event', async () => {
  const { state, service } = createHarness();
  await service.request('worker@example.test', now);
  const rawToken = state.delivered[0].rawToken;
  state.tokens.push({ id: 'peer', userId: state.user.id, type: 'PERSONNEL_PASSWORD_RESET', tokenHash: 'peer',
    expiresAt: new Date(now.getTime() + 60_000), usedAt: null, deliveryStatus: 'ACCEPTED' });
  const resetAt = new Date(now.getTime() + 1000);
  const result = await service.reset(rawToken, 'NewPersonnel#Pass2026', {}, resetAt);
  assert.equal(result.reset, true);
  assert.equal(await comparePassword('NewPersonnel#Pass2026', state.user.password), true);
  assert.equal(state.user.passwordChangedAt, resetAt);
  assert.ok(state.tokens.every(token => token.usedAt));
  assert.equal(state.audits[0].action, 'PERSONNEL_PORTAL_PASSWORD_RESET');
  assert.equal(JSON.stringify(state.audits).includes(rawToken), false);
  assert.equal(JSON.stringify(state.audits).includes('NewPersonnel#Pass2026'), false);
});

test('reset rejects weak, expired, reused, wrong-purpose, failed-delivery and disabled states', async () => {
  const weak = createHarness();
  await weak.service.request('worker@example.test', now);
  await assert.rejects(() => weak.service.reset(weak.state.delivered[0].rawToken, 'weak', {}, now));
  const mutations = [
    token => { token.expiresAt = new Date(now.getTime() - 1); },
    token => { token.usedAt = now; },
    token => { token.type = 'PERSONNEL_ACTIVATION'; },
    token => { token.deliveryStatus = 'FAILED'; },
    (_token, state) => { state.user.canManagerLogin = false; }
  ];
  for (const mutate of mutations) {
    const { state, service } = createHarness();
    await service.request('worker@example.test', now);
    mutate(state.tokens[0], state);
    await assert.rejects(() => service.reset(state.delivered[0].rawToken, 'NewPersonnel#Pass2026', {}, now));
  }
});
