import test from 'node:test';
import assert from 'node:assert/strict';
import { ServicePersonnelError, ServicePersonnelService } from '../src/services/servicePersonnel.service.js';

const manager = { id: 'manager-1', role: 'MANAGER' };

const createPermissions = ({ denied = [] } = {}) => ({
  checkPropertyAccess: async (_userId, propertyId) => !denied.includes(propertyId),
  checkPermission: async (_userId, _resource, _operation, propertyId) => !denied.includes(propertyId)
});

test('personnel can retain assignment history across multiple properties', async () => {
  const created = [];
  const prisma = {
    servicePersonnel: {
      findUnique: async () => ({ id: 'personnel-1', assignments: [{ propertyId: 'property-1' }] })
    },
    propertyServiceAssignment: {
      findFirst: async () => null,
      create: async ({ data }) => {
        created.push(data);
        return { id: `assignment-${created.length}`, ...data };
      }
    }
  };
  const service = new ServicePersonnelService(prisma, createPermissions());

  await service.createAssignment(manager, 'personnel-1', {
    propertyId: 'property-1',
    serviceCategory: 'SECURITY',
    jobRole: 'Day guard',
    startDate: '2026-01-01',
    status: 'INACTIVE',
    endDate: '2026-06-30'
  });
  await service.createAssignment(manager, 'personnel-1', {
    propertyId: 'property-2',
    serviceCategory: 'CARETAKING',
    jobRole: 'Resident caretaker',
    startDate: '2026-07-01'
  });

  assert.equal(created.length, 2);
  assert.deepEqual(created.map(item => item.propertyId), ['property-1', 'property-2']);
  assert.equal(created[0].status, 'INACTIVE');
  assert.equal(created[1].status, 'ACTIVE');
});

test('day and night schedules receive safe default times', async () => {
  const saved = [];
  const prisma = {
    propertyServiceAssignment: {
      findUnique: async () => ({ id: 'assignment-1', propertyId: 'property-1', status: 'ACTIVE' })
    },
    personnelSchedule: {
      findFirst: async () => null,
      create: async ({ data }) => {
        saved.push(data);
        return { id: `schedule-${saved.length}`, ...data };
      }
    }
  };
  const service = new ServicePersonnelService(prisma, createPermissions());

  await service.createSchedule(manager, 'assignment-1', { dayOfWeek: 'MONDAY', shiftType: 'DAY' });
  await service.createSchedule(manager, 'assignment-1', { dayOfWeek: 'TUESDAY', shiftType: 'NIGHT' });

  assert.deepEqual(
    saved.map(({ shiftType, startTime, endTime }) => ({ shiftType, startTime, endTime })),
    [
      { shiftType: 'DAY', startTime: '06:00', endTime: '18:00' },
      { shiftType: 'NIGHT', startTime: '18:00', endTime: '06:00' }
    ]
  );
});

test('custom schedules require valid 24-hour times', async () => {
  const prisma = {
    propertyServiceAssignment: {
      findUnique: async () => ({ id: 'assignment-1', propertyId: 'property-1', status: 'ACTIVE' })
    },
    personnelSchedule: { findFirst: async () => null }
  };
  const service = new ServicePersonnelService(prisma, createPermissions());

  await assert.rejects(
    service.createSchedule(manager, 'assignment-1', {
      dayOfWeek: 'FRIDAY', shiftType: 'CUSTOM', startTime: '8am', endTime: '5pm'
    }),
    error => error instanceof ServicePersonnelError && /HH:mm/.test(error.message)
  );
});

test('property access and feature permission are both required', async () => {
  const service = new ServicePersonnelService({}, createPermissions({ denied: ['property-2'] }));

  await assert.rejects(
    service.assertPropertyPermission(manager, 'property-2', 'edit'),
    error => error instanceof ServicePersonnelError && error.status === 403
  );
});

test('inactive assignments automatically receive an end date', async () => {
  const updated = [];
  const prisma = {
    propertyServiceAssignment: {
      findUnique: async () => ({
        id: 'assignment-1', propertyId: 'property-1', startDate: new Date('2026-01-01'), endDate: null, status: 'ACTIVE'
      }),
      update: async ({ data }) => {
        updated.push(data);
        return data;
      }
    }
  };
  const service = new ServicePersonnelService(prisma, createPermissions());

  await service.updateAssignment(manager, 'assignment-1', { status: 'INACTIVE' });

  assert.equal(updated[0].status, 'INACTIVE');
  assert.ok(updated[0].endDate instanceof Date);
});

test('property editors cannot update a shared personnel profile created by another manager', async () => {
  const prisma = {
    servicePersonnel: {
      findUnique: async () => ({
        id: 'personnel-1',
        createdById: 'manager-2',
        assignments: [{ propertyId: 'property-1' }]
      }),
      update: async () => {
        throw new Error('update must not be reached');
      }
    }
  };
  const service = new ServicePersonnelService(prisma, createPermissions());

  await assert.rejects(
    () => service.updatePersonnel(manager, 'personnel-1', { status: 'INACTIVE' }),
    error => error instanceof ServicePersonnelError && error.status === 403
  );
});

test('property personnel queries scope both personnel selection and returned assignments', async () => {
  let receivedQuery;
  const prisma = {
    servicePersonnel: {
      findMany: async query => {
        receivedQuery = query;
        return [{
          id: 'personnel-1',
          assignments: [
            { id: 'current', status: 'ACTIVE', startDate: new Date('2026-11-01'), endDate: null },
            { id: 'upcoming', status: 'ACTIVE', startDate: new Date('2099-11-19'), endDate: null },
            { id: 'ended', status: 'INACTIVE', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31') }
          ]
        }];
      }
    }
  };
  const service = new ServicePersonnelService(prisma, createPermissions());

  const result = await service.getPropertyPersonnel(manager, 'property-1');

  assert.equal(receivedQuery.where.assignments.some.propertyId, 'property-1');
  assert.equal(receivedQuery.include.assignments.where.propertyId, 'property-1');
  assert.deepEqual(result[0].assignments.map(item => item.assignmentTiming), ['CURRENT', 'UPCOMING', 'ENDED']);
});

test('external personnel retain their provider relationship and require provider-property access', async () => {
  const checkedProperties = [];
  let createdData;
  const permissions = {
    checkPropertyAccess: async (_userId, propertyId) => {
      checkedProperties.push(propertyId);
      return true;
    },
    checkPermission: async () => true
  };
  const prisma = {
    serviceProvider: {
      findUnique: async () => ({ id: 'provider-1', propertyId: 'provider-property-1' })
    },
    servicePersonnel: {
      create: async ({ data }) => {
        createdData = data;
        return { id: 'personnel-1', ...data };
      }
    }
  };
  const service = new ServicePersonnelService(prisma, permissions);

  await service.createPersonnel(manager, {
    personnelType: 'EXTERNAL',
    serviceProviderId: 'provider-1',
    name: 'External Guard',
    jobRole: 'Guard',
    assignment: {
      propertyId: 'assignment-property-1',
      serviceCategory: 'SECURITY',
      jobRole: 'Guard'
    }
  });

  assert.equal(createdData.serviceProviderId, 'provider-1');
  assert.equal(createdData.employeeId, null);
  assert.deepEqual(checkedProperties.sort(), ['assignment-property-1', 'provider-property-1']);
});
