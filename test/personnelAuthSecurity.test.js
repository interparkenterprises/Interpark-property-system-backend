import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  createProtect,
  createProtectPersonnel
} from '../src/middleware/authMiddleware.js';
import generateToken, {
  ERP_JWT_AUDIENCE,
  PERSONNEL_JWT_AUDIENCE,
  generatePersonnelToken
} from '../src/utils/generateToken.js';
import {
  ACCOUNT_TOKEN_EXPIRY_MS,
  generateAccountToken,
  hashAccountToken
} from '../src/utils/accountToken.js';

process.env.JWT_SECRET = 'personnel-auth-test-secret';

const baseUser = {
  id: 'user-1',
  email: 'worker@example.test',
  name: 'Test Worker',
  role: 'PERSONNEL',
  isApproved: true,
  isManagedUser: true,
  canManagerLogin: true,
  passwordChangedAt: null,
  servicePersonnel: { id: 'personnel-1', status: 'ACTIVE', portalAccessStatus: 'ACTIVE' }
};

const request = token => ({
  headers: token ? { authorization: `Bearer ${token}` } : {},
  query: {},
  cookies: {}
});

const personnelRequest = token => ({
  headers: token ? { cookie: `personnel_token=${encodeURIComponent(token)}` } : {},
  query: {},
  cookies: {}
});

const response = () => {
  const result = { statusCode: 200, body: undefined };
  result.status = code => { result.statusCode = code; return result; };
  result.json = body => { result.body = body; return result; };
  return result;
};

const prismaReturning = user => ({
  user: { findUnique: async () => user }
});

const run = async (middleware, req) => {
  const res = response();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
};

test('ERP middleware rejects personnel-audience tokens before a database lookup', async () => {
  let queried = false;
  const middleware = createProtect({ user: { findUnique: async () => { queried = true; } } });
  const result = await run(middleware, request(generatePersonnelToken('user-1')));
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.nextCalled, false);
  assert.equal(queried, false);
});

test('ERP middleware also rejects PERSONNEL users presenting legacy audience-less tokens', async () => {
  const legacyToken = jwt.sign({ userId: 'user-1', role: 'PERSONNEL' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const result = await run(createProtect(prismaReturning(baseUser)), request(legacyToken));
  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test('existing audience-less ERP tokens remain valid', async () => {
  const erpUser = { ...baseUser, role: 'MANAGER', servicePersonnel: undefined };
  const legacyToken = jwt.sign({ userId: erpUser.id, role: erpUser.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const result = await run(createProtect(prismaReturning(erpUser)), request(legacyToken));
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.user.id, erpUser.id);
});

test('new ERP tokens retain the ERP audience and remain valid', async () => {
  const erpUser = { ...baseUser, role: 'ADMIN', servicePersonnel: undefined };
  const token = generateToken(erpUser.id, erpUser.role);
  assert.equal(jwt.decode(token).aud, ERP_JWT_AUDIENCE);
  const result = await run(createProtect(prismaReturning(erpUser)), request(token));
  assert.equal(result.nextCalled, true);
});

test('personnel middleware rejects ERP tokens because audiences are distinct', async () => {
  const result = await run(
    createProtectPersonnel(prismaReturning(baseUser)),
    personnelRequest(generateToken('user-1', 'PERSONNEL'))
  );
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.nextCalled, false);
});

test('active enabled personnel can authenticate with an eight-hour personnel token', async () => {
  const token = generatePersonnelToken('user-1');
  const decoded = jwt.decode(token);
  assert.equal(decoded.aud, PERSONNEL_JWT_AUDIENCE);
  assert.equal(decoded.exp - decoded.iat, 8 * 60 * 60);
  const result = await run(createProtectPersonnel(prismaReturning(baseUser)), personnelRequest(token));
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.servicePersonnel.id, 'personnel-1');
});

test('disabled personnel portal access is rejected', async () => {
  const disabled = { ...baseUser, canManagerLogin: false };
  const result = await run(
    createProtectPersonnel(prismaReturning(disabled)),
    personnelRequest(generatePersonnelToken('user-1'))
  );
  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test('inactive personnel records are rejected', async () => {
  const inactive = {
    ...baseUser,
    servicePersonnel: { id: 'personnel-1', status: 'INACTIVE', portalAccessStatus: 'ACTIVE' }
  };
  const result = await run(
    createProtectPersonnel(prismaReturning(inactive)),
    personnelRequest(generatePersonnelToken('user-1'))
  );
  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test('invalid credentials and missing personnel links are rejected', async () => {
  const invalidTokenResult = await run(
    createProtectPersonnel(prismaReturning(baseUser)),
    personnelRequest('not-a-valid-jwt')
  );
  assert.equal(invalidTokenResult.res.statusCode, 401);

  const unlinked = { ...baseUser, servicePersonnel: null };
  const unlinkedResult = await run(
    createProtectPersonnel(prismaReturning(unlinked)),
    personnelRequest(generatePersonnelToken('user-1'))
  );
  assert.equal(unlinkedResult.res.statusCode, 401);
});

test('account tokens are random, stored as hashes, and use approved expiries', () => {
  const now = new Date('2026-11-17T09:00:00.000Z');
  const activation = generateAccountToken('PERSONNEL_ACTIVATION', now);
  const reset = generateAccountToken('PERSONNEL_PASSWORD_RESET', now);

  assert.notEqual(activation.rawToken, reset.rawToken);
  assert.equal(activation.tokenHash, hashAccountToken(activation.rawToken));
  assert.notEqual(activation.rawToken, activation.tokenHash);
  assert.equal(activation.expiresAt.getTime() - now.getTime(), ACCOUNT_TOKEN_EXPIRY_MS.PERSONNEL_ACTIVATION);
  assert.equal(reset.expiresAt.getTime() - now.getTime(), ACCOUNT_TOKEN_EXPIRY_MS.PERSONNEL_PASSWORD_RESET);
});
