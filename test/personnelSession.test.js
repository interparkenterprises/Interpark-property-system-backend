import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { hashPassword } from '../src/utils/hashPassword.js';
import { PersonnelSessionService } from '../src/services/personnelSession.service.js';
import { PersonnelSelfServiceService } from '../src/services/personnelSelfService.service.js';
import { createProtectPersonnel } from '../src/middleware/authMiddleware.js';
import { requirePersonnelCsrf } from '../src/middleware/personnelCsrf.js';
import { logoutPersonnel } from '../src/controllers/personnelAuth.controller.js';
import {
  generateCsrfToken,
  hashCsrfToken,
  personnelCookieOptions,
  PERSONNEL_CSRF_COOKIE_NAME,
  PERSONNEL_COOKIE_NAME
} from '../src/utils/personnelSession.js';
import { generatePersonnelToken, PERSONNEL_JWT_AUDIENCE } from '../src/utils/generateToken.js';

process.env.JWT_SECRET = 'personnel-session-test-secret';

const activeUser = async overrides => ({
  id: 'user-1',
  name: 'Jane Wanjiku',
  email: 'jane@example.test',
  password: await hashPassword('WorkerLogin#2026'),
  role: 'PERSONNEL',
  isApproved: true,
  canManagerLogin: true,
  passwordChangedAt: new Date('2026-11-17T08:00:00Z'),
  servicePersonnel: {
    id: 'personnel-1', name: 'Jane Wanjiku', jobRole: 'Security officer',
    status: 'ACTIVE', portalAccessStatus: 'ACTIVE'
  },
  ...overrides
});

const sessionHarness = user => {
  const updates = [];
  const prisma = {
    user: {
      findFirst: async () => user,
      update: async input => { updates.push(input); return input.data; }
    }
  };
  return { service: new PersonnelSessionService(prisma), updates };
};

test('successful personnel login issues an eight-hour personnel-audience session', async () => {
  const user = await activeUser();
  const { service, updates } = sessionHarness(user);
  const result = await service.login(' JANE@example.test ', 'WorkerLogin#2026');
  const decoded = jwt.decode(result.token);
  assert.equal(decoded.aud, PERSONNEL_JWT_AUDIENCE);
  assert.equal(decoded.exp - decoded.iat, 8 * 60 * 60);
  assert.equal(decoded.pwd, user.passwordChangedAt.getTime());
  assert.equal(decoded.csrf, hashCsrfToken(result.csrfToken));
  assert.equal(result.user.role, 'PERSONNEL');
  assert.equal(Object.hasOwn(result.user, 'password'), false);
  assert.equal(updates.length, 1);
});

test('wrong credentials and non-personnel accounts return the same generic error', async () => {
  const user = await activeUser();
  await assert.rejects(
    sessionHarness(user).service.login(user.email, 'WrongPassword#2026'),
    error => error.status === 401 && error.message === 'Invalid email or password'
  );
  await assert.rejects(
    sessionHarness({ ...user, role: 'MANAGER' }).service.login(user.email, 'WorkerLogin#2026'),
    error => error.status === 401 && error.message === 'Invalid email or password'
  );
});

test('pending, disabled, inactive and unlinked personnel cannot login', async () => {
  const user = await activeUser();
  const variants = [
    { ...user, passwordChangedAt: null, isApproved: false, canManagerLogin: false },
    { ...user, isApproved: false, canManagerLogin: false },
    { ...user, servicePersonnel: { ...user.servicePersonnel, status: 'INACTIVE' } },
    { ...user, servicePersonnel: null }
  ];
  for (const variant of variants) {
    await assert.rejects(
      sessionHarness(variant).service.login(user.email, 'WorkerLogin#2026'),
      error => error.status === 401 && error.message === 'Invalid email or password'
    );
  }
});

test('personnel cookie attributes are safe for local and cross-origin production deployments', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  assert.deepEqual(personnelCookieOptions(), {
    httpOnly: true, secure: false, sameSite: 'lax', path: '/api', maxAge: 8 * 60 * 60 * 1000
  });
  process.env.NODE_ENV = 'production';
  assert.deepEqual(personnelCookieOptions(), {
    httpOnly: true, secure: true, sameSite: 'none', path: '/api', maxAge: 8 * 60 * 60 * 1000
  });
  if (previous === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
});

test('logout clears both personnel cookies without exposing a token', async () => {
  const cleared = [];
  const res = {
    clearCookie: (name, options) => { cleared.push({ name, options }); return res; },
    status: code => { res.statusCode = code; return res; },
    json: body => { res.body = body; return res; }
  };
  await logoutPersonnel({}, res);
  assert.deepEqual(cleared.map(entry => entry.name), [PERSONNEL_COOKIE_NAME, PERSONNEL_CSRF_COOKIE_NAME]);
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(JSON.stringify(res.body), /token|jwt/i);
});

test('CSRF middleware requires matching cookie, header and signed session hash', () => {
  const csrfToken = generateCsrfToken();
  const validReq = {
    headers: { cookie: `${PERSONNEL_CSRF_COOKIE_NAME}=${csrfToken}` },
    get: name => name === 'x-csrf-token' ? csrfToken : undefined,
    cookies: {},
    personnelSession: { csrf: hashCsrfToken(csrfToken) }
  };
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let nextCalled = false;
  requirePersonnelCsrf(validReq, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const invalidReq = { ...validReq, get: () => 'attacker-token' };
  requirePersonnelCsrf(invalidReq, res, () => {});
  assert.equal(res.statusCode, 403);
});

test('password changes and account disablement revoke existing personnel sessions', async () => {
  const csrfToken = generateCsrfToken();
  const passwordChangedAt = new Date('2026-11-17T08:00:00Z');
  const token = generatePersonnelToken('user-1', {
    csrfHash: hashCsrfToken(csrfToken), passwordChangedAt
  });
  const req = { headers: { cookie: `personnel_token=${encodeURIComponent(token)}` }, cookies: {}, query: {} };
  const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

  for (const user of [
    await activeUser({ passwordChangedAt: new Date('2026-11-17T09:00:00Z') }),
    await activeUser({ canManagerLogin: false })
  ]) {
    const res = response();
    let nextCalled = false;
    await createProtectPersonnel({ user: { findUnique: async () => user } })(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.ok([401, 403].includes(res.statusCode));
  }
});

test('expired personnel sessions are rejected by middleware', async () => {
  const expired = jwt.sign(
    { userId: 'user-1', role: 'PERSONNEL' },
    process.env.JWT_SECRET,
    { audience: PERSONNEL_JWT_AUDIENCE, expiresIn: -1 }
  );
  const req = { headers: { cookie: `personnel_token=${encodeURIComponent(expired)}` }, cookies: {}, query: {} };
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let nextCalled = false;
  await createProtectPersonnel({ user: { findUnique: async () => activeUser() } })(
    req, res, () => { nextCalled = true; }
  );
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('self-service query is identity-bound, supports multiple properties and allowlists fields', async () => {
  let query;
  const now = new Date('2026-11-17T10:00:00Z');
  const profile = {
    id: 'personnel-1', name: 'Jane', email: 'jane@example.test', phoneNumber: '0700000000',
    jobRole: 'Guard', personnelType: 'EXTERNAL', status: 'ACTIVE',
    assignments: [
      {
        id: 'a1', status: 'ACTIVE', startDate: new Date('2026-11-16T00:00:00Z'), endDate: null,
        property: { id: 'p1', name: 'Westlands Court', address: 'Nairobi' },
        schedules: [
          { id: 's1', effectiveFrom: new Date('2026-11-16T00:00:00Z') },
          { id: 's2', effectiveFrom: new Date('2026-11-20T00:00:00Z') }
        ]
      },
      {
        id: 'a2', status: 'ACTIVE', startDate: new Date('2026-11-19T00:00:00Z'), endDate: null,
        property: { id: 'p2', name: 'Kilimani House', address: 'Nairobi' },
        schedules: [{ id: 's3', effectiveFrom: new Date('2026-11-19T00:00:00Z') }]
      },
      {
        id: 'a3', status: 'INACTIVE', startDate: new Date('2026-11-01T00:00:00Z'),
        endDate: new Date('2026-11-10T00:00:00Z'),
        property: { id: 'p3', name: 'Ended Property', address: 'Nairobi' }, schedules: []
      }
    ]
  };
  const service = new PersonnelSelfServiceService({
    servicePersonnel: { findUnique: async input => { query = input; return profile; } }
  });
  const result = await service.getMe('authenticated-user-id', now);
  assert.deepEqual(query.where, { userId: 'authenticated-user-id' });
  assert.equal(query.select.assignments.where.startDate, undefined);
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].assignmentTiming, 'CURRENT');
  assert.deepEqual(result.assignments[0].schedules.map(item => item.id), ['s1']);
  assert.equal(result.upcomingAssignments.length, 1);
  assert.equal(result.upcomingAssignments[0].assignmentTiming, 'UPCOMING');
  assert.deepEqual(result.upcomingAssignments[0].schedules.map(item => item.id), ['s3']);
  assert.equal([...result.assignments, ...result.upcomingAssignments].some(item => item.id === 'a3'), false);
  const serializedSelect = JSON.stringify(query.select).toLowerCase();
  for (const forbidden of ['tenant', 'landlord', 'salary', 'payment', 'invoice', 'commission', 'income']) {
    assert.doesNotMatch(serializedSelect, new RegExp(forbidden));
  }
  assert.deepEqual(Object.keys(query.select).sort(), [
    'assignments', 'email', 'id', 'jobRole', 'name', 'personnelType', 'phoneNumber', 'status'
  ].sort());
});
