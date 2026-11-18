import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../src/lib/prisma.js';
import { hashPassword } from '../src/utils/hashPassword.js';
import { PersonnelSessionService } from '../src/services/personnelSession.service.js';
import { PersonnelSelfServiceService } from '../src/services/personnelSelfService.service.js';
import app from '../src/app.js';

const runIntegration = process.env.RUN_PERSONNEL_DB_INTEGRATION === '1';
process.env.JWT_SECRET ||= 'personnel-session-integration-test-secret';

test('PostgreSQL personnel login and self-service isolation across multiple properties', {
  skip: !runIntegration
}, async () => {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.equal(databaseUrl.hostname, '127.0.0.1');
  assert.equal(databaseUrl.pathname.slice(1), 'interpark_personnel_test');

  const managerId = randomUUID();
  const workerUserId = randomUUID();
  const otherUserId = randomUUID();
  const workerPersonnelId = randomUUID();
  const otherPersonnelId = randomUUID();
  const propertyIds = [randomUUID(), randomUUID(), randomUUID()];
  const assignmentIds = [randomUUID(), randomUUID(), randomUUID()];
  const createdUserIds = [workerUserId, otherUserId];
  const now = new Date();
  const passwordChangedAt = new Date(now.getTime() - 60_000);
  const password = 'PersonnelLogin#2026';
  let server;

  try {
    await prisma.user.create({
      data: {
        id: managerId, name: 'Session Integration Manager',
        email: `session-manager-${managerId}@example.test`, password: 'test-only',
        role: 'MANAGER', isApproved: true
      }
    });
    for (let index = 0; index < propertyIds.length; index += 1) {
      await prisma.property.create({
        data: {
          id: propertyIds[index], name: `Session Test Property ${index + 1}`,
          address: `Test Address ${index + 1}, Nairobi`, form: 'APARTMENT',
          usage: 'RESIDENTIAL', managerId
        }
      });
    }
    const passwordHash = await hashPassword(password);
    for (const [userId, label] of [[workerUserId, 'worker'], [otherUserId, 'other']]) {
      await prisma.user.create({
        data: {
          id: userId, name: `Session ${label}`, email: `session-${label}-${userId}@example.test`,
          password: passwordHash, role: 'PERSONNEL', isApproved: true,
          canManagerLogin: true, passwordChangedAt, isManagedUser: true,
          createdByManagerId: managerId
        }
      });
    }
    await prisma.servicePersonnel.create({
      data: {
        id: workerPersonnelId, personnelType: 'EXTERNAL', name: 'Session worker',
        email: `session-worker-${workerUserId}@example.test`, jobRole: 'Security officer',
        status: 'ACTIVE', portalAccessStatus: 'ACTIVE', userId: workerUserId,
        createdById: managerId
      }
    });
    await prisma.servicePersonnel.create({
      data: {
        id: otherPersonnelId, personnelType: 'EXTERNAL', name: 'Other worker',
        email: `session-other-${otherUserId}@example.test`, jobRole: 'Cleaner',
        status: 'ACTIVE', portalAccessStatus: 'ACTIVE', userId: otherUserId,
        createdById: managerId
      }
    });
    for (let index = 0; index < assignmentIds.length; index += 1) {
      const worker = index < 2;
      await prisma.propertyServiceAssignment.create({
        data: {
          id: assignmentIds[index], personnelId: worker ? workerPersonnelId : otherPersonnelId,
          propertyId: propertyIds[index], serviceCategory: worker ? 'SECURITY' : 'CLEANING',
          jobRole: worker ? 'Security officer' : 'Cleaner',
          startDate: new Date(now.getTime() - 86_400_000), status: 'ACTIVE',
          createdById: managerId,
          schedules: {
            create: {
              dayOfWeek: index === 0 ? 'MONDAY' : 'TUESDAY', shiftType: 'DAY',
              startTime: '06:00', endTime: '18:00', effectiveFrom: new Date(now.getTime() - 86_400_000),
              isActive: true, createdById: managerId
            }
          }
        }
      });
    }

    const session = await new PersonnelSessionService(prisma).login(
      `SESSION-WORKER-${workerUserId}@EXAMPLE.TEST`, password
    );
    assert.equal(session.user.id, workerUserId);
    assert.ok(session.token);

    const selfService = new PersonnelSelfServiceService(prisma);
    const profile = await selfService.getMe(workerUserId, now);
    assert.equal(profile.id, workerPersonnelId);
    assert.deepEqual(profile.assignments.map(item => item.property.id).sort(), propertyIds.slice(0, 2).sort());
    assert.ok(profile.assignments.every(item => item.schedules.length === 1));

    const otherProfile = await selfService.getMe(otherUserId, now);
    assert.equal(otherProfile.id, otherPersonnelId);
    assert.deepEqual(otherProfile.assignments.map(item => item.property.id), [propertyIds[2]]);

    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const loginResponse = await fetch(`${baseUrl}/api/personnel-auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: `session-worker-${workerUserId}@example.test`, password })
    });
    assert.equal(loginResponse.status, 200);
    assert.equal(loginResponse.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.equal(loginResponse.headers.get('access-control-allow-credentials'), 'true');
    const loginBody = await loginResponse.json();
    assert.equal(Object.hasOwn(loginBody.data, 'token'), false);
    assert.ok(loginBody.data.csrfToken);
    const setCookies = loginResponse.headers.getSetCookie();
    assert.ok(setCookies.some(cookie => /^personnel_token=/.test(cookie) && /HttpOnly/i.test(cookie)));
    const cookieHeader = setCookies.map(cookie => cookie.split(';')[0]).join('; ');

    const meResponse = await fetch(`${baseUrl}/api/personnel-portal/me`, {
      headers: { cookie: cookieHeader, origin: 'http://localhost:3000' }
    });
    assert.equal(meResponse.status, 200);
    const meBody = await meResponse.json();
    assert.equal(meBody.data.id, workerPersonnelId);
    assert.equal(meBody.data.assignments.length, 2);

    const sessionResponse = await fetch(`${baseUrl}/api/personnel-auth/session`, {
      headers: { cookie: cookieHeader, origin: 'http://localhost:3000' }
    });
    assert.equal(sessionResponse.status, 200);
    const sessionBody = await sessionResponse.json();
    assert.equal(sessionBody.data.csrfToken, loginBody.data.csrfToken);

    const rejectedLogout = await fetch(`${baseUrl}/api/personnel-auth/logout`, {
      method: 'POST', headers: { cookie: cookieHeader, origin: 'http://localhost:3000' }
    });
    assert.equal(rejectedLogout.status, 403);
    const logoutResponse = await fetch(`${baseUrl}/api/personnel-auth/logout`, {
      method: 'POST',
      headers: {
        cookie: cookieHeader,
        origin: 'http://localhost:3000',
        'x-csrf-token': loginBody.data.csrfToken
      }
    });
    assert.equal(logoutResponse.status, 200);
    const clearedCookies = logoutResponse.headers.getSetCookie();
    assert.ok(clearedCookies.some(cookie => /^personnel_token=/.test(cookie) && /Expires=/i.test(cookie)));
    assert.ok(clearedCookies.some(cookie => /^personnel_csrf=/.test(cookie) && /Expires=/i.test(cookie)));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.personnelSchedule.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
    await prisma.propertyServiceAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
    await prisma.servicePersonnel.deleteMany({ where: { id: { in: [workerPersonnelId, otherPersonnelId] } } });
    await prisma.property.deleteMany({ where: { id: { in: propertyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: managerId } });
  }
});
