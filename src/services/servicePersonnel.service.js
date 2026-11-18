import { getPersonnelAssignmentTiming } from '../utils/personnelAssignmentTiming.js';

export const SERVICE_CATEGORIES = [
  'CLEANING',
  'SECURITY',
  'CARETAKING',
  'LANDSCAPING',
  'PLUMBING',
  'ELECTRICAL',
  'MAINTENANCE',
  'WASTE_MANAGEMENT',
  'OTHER'
];

export const PERSONNEL_TYPES = ['INTERNAL', 'EXTERNAL'];
export const PERSONNEL_STATUSES = ['ACTIVE', 'INACTIVE'];
export const ASSIGNMENT_STATUSES = ['ACTIVE', 'INACTIVE'];
export const SHIFT_TYPES = ['DAY', 'NIGHT', 'CUSTOM'];
export const WEEK_DAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY'
];

const PERSONNEL_INCLUDE = {
  employee: {
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
      jobTitle: true,
      status: true
    }
  },
  serviceProvider: {
    select: {
      id: true,
      name: true,
      contact: true,
      propertyId: true
    }
  },
  assignments: {
    include: {
      property: { select: { id: true, name: true, address: true } },
      schedules: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] }
    },
    orderBy: { startDate: 'desc' }
  }
};

export class ServicePersonnelError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ServicePersonnelError';
    this.status = status;
  }
}
const requireEnum = (value, allowed, label) => {
  if (!allowed.includes(value)) {
    throw new ServicePersonnelError(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value;
};

const requireText = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ServicePersonnelError(`${label} is required`);
  }
  return value.trim();
};

const optionalText = value => {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim();
};

const parseDate = (value, label, fallback = null) => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ServicePersonnelError(`${label} must be a valid date`);
  }
  return date;
};

const validateDateRange = (start, end, startLabel = 'startDate', endLabel = 'endDate') => {
  if (end && end < start) {
    throw new ServicePersonnelError(`${endLabel} cannot be before ${startLabel}`);
  }
};

const normalizeSchedule = (schedule, now = new Date()) => {
  const shiftType = requireEnum(schedule.shiftType || 'DAY', SHIFT_TYPES, 'shiftType');
  const dayOfWeek = requireEnum(schedule.dayOfWeek, WEEK_DAYS, 'dayOfWeek');
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  let startTime = optionalText(schedule.startTime);
  let endTime = optionalText(schedule.endTime);

  if (shiftType === 'DAY') {
    startTime ||= '06:00';
    endTime ||= '18:00';
  } else if (shiftType === 'NIGHT') {
    startTime ||= '18:00';
    endTime ||= '06:00';
  }

  if (!startTime || !endTime || !timePattern.test(startTime) || !timePattern.test(endTime)) {
    throw new ServicePersonnelError('Schedule times must use 24-hour HH:mm format');
  }

  const effectiveFrom = parseDate(schedule.effectiveFrom, 'effectiveFrom', now);
  const effectiveTo = parseDate(schedule.effectiveTo, 'effectiveTo');
  validateDateRange(effectiveFrom, effectiveTo, 'effectiveFrom', 'effectiveTo');

  return {
    dayOfWeek,
    shiftType,
    startTime,
    endTime,
    effectiveFrom,
    effectiveTo,
    isActive: schedule.isActive !== false,
    notes: optionalText(schedule.notes)
  };
};

export class ServicePersonnelService {
  constructor(prismaClient, permissions) {
    if (!prismaClient) {
      throw new TypeError('A Prisma client is required');
    }
    if (!permissions) {
      throw new TypeError('A permission service is required');
    }
    this.prisma = prismaClient;
    this.permissions = permissions;
  }

  async assertPropertyPermission(user, propertyId, operation = 'view') {
    if (!propertyId) throw new ServicePersonnelError('propertyId is required');
    const propertyPermission = operation === 'view' ? 'canView' : 'canEdit';
    const [hasPropertyAccess, hasFeaturePermission] = await Promise.all([
      this.permissions.checkPropertyAccess(user.id, propertyId, propertyPermission),
      this.permissions.checkPermission(user.id, 'serviceProvider', operation, propertyId)
    ]);

    if (!hasPropertyAccess || !hasFeaturePermission) {
      throw new ServicePersonnelError(
        `You do not have permission to ${operation} service personnel for this property`,
        403
      );
    }
  }

  async assertPersonnelPermission(user, personnelId, operation = 'view') {
    const personnel = await this.prisma.servicePersonnel.findUnique({
      where: { id: personnelId },
      include: { assignments: { select: { propertyId: true } } }
    });
    if (!personnel) throw new ServicePersonnelError('Service personnel record not found', 404);

    if (user.role === 'ADMIN') return personnel;
    for (const assignment of personnel.assignments) {
      try {
        await this.assertPropertyPermission(user, assignment.propertyId, operation);
        return personnel;
      } catch (error) {
        if (!(error instanceof ServicePersonnelError) || error.status !== 403) throw error;
      }
    }
    throw new ServicePersonnelError('You do not have access to this service personnel record', 403);
  }

  normalizeAssignment(input, now = new Date()) {
    const startDate = parseDate(input.startDate, 'startDate', now);
    const endDate = parseDate(input.endDate, 'endDate');
    validateDateRange(startDate, endDate);
    const status = requireEnum(input.status || 'ACTIVE', ASSIGNMENT_STATUSES, 'assignment status');

    return {
      propertyId: requireText(input.propertyId, 'propertyId'),
      serviceCategory: requireEnum(input.serviceCategory, SERVICE_CATEGORIES, 'serviceCategory'),
      jobRole: requireText(input.jobRole, 'assignment jobRole'),
      startDate,
      endDate: status === 'INACTIVE' && !endDate ? now : endDate,
      status,
      notes: optionalText(input.notes)
    };
  }

  async getPropertyPersonnel(user, propertyId, filters = {}) {
    await this.assertPropertyPermission(user, propertyId, 'view');
    const assignmentWhere = {
      propertyId,
      ...(filters.status ? { status: requireEnum(filters.status, ASSIGNMENT_STATUSES, 'status') } : {}),
      ...(filters.serviceCategory
        ? { serviceCategory: requireEnum(filters.serviceCategory, SERVICE_CATEGORIES, 'serviceCategory') }
        : {})
    };

    const personnel = await this.prisma.servicePersonnel.findMany({
      where: {
        ...(filters.personnelType
          ? { personnelType: requireEnum(filters.personnelType, PERSONNEL_TYPES, 'personnelType') }
          : {}),
        assignments: { some: assignmentWhere }
      },
      include: {
        ...PERSONNEL_INCLUDE,
        assignments: {
          where: assignmentWhere,
          include: {
            property: { select: { id: true, name: true, address: true } },
            schedules: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] }
          },
          orderBy: { startDate: 'desc' }
        }
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }]
    });

    return personnel.map(person => ({
      ...person,
      assignments: person.assignments.map(assignment => ({
        ...assignment,
        assignmentTiming: getPersonnelAssignmentTiming(assignment)
      }))
    }));
  }

  async getOptions(user, propertyId) {
    await this.assertPropertyPermission(user, propertyId, 'view');
    const employeeWhere = user.role === 'ADMIN'
      ? { status: 'ACTIVE' }
      : user.role === 'MANAGER'
        ? { status: 'ACTIVE', createdById: user.id }
        : { id: '__no_internal_employee_access__' };

    const personnelWhere = user.role === 'ADMIN'
      ? { status: 'ACTIVE' }
      : { status: 'ACTIVE', createdById: user.id };

    const [employees, serviceProviders, existingPersonnel] = await Promise.all([
      this.prisma.employee.findMany({
        where: employeeWhere,
        select: { id: true, name: true, email: true, phoneNumber: true, jobTitle: true },
        orderBy: { name: 'asc' }
      }),
      this.prisma.serviceProvider.findMany({
        where: { propertyId },
        select: { id: true, name: true, contact: true, propertyId: true },
        orderBy: { name: 'asc' }
      }),
      this.prisma.servicePersonnel.findMany({
        where: {
          ...personnelWhere,
          assignments: { none: { propertyId, status: 'ACTIVE' } }
        },
        select: {
          id: true,
          name: true,
          jobRole: true,
          personnelType: true,
          serviceProvider: { select: { id: true, name: true } },
          employee: { select: { id: true, name: true, jobTitle: true } }
        },
        orderBy: { name: 'asc' }
      })
    ]);

    return { employees, serviceProviders, existingPersonnel, categories: SERVICE_CATEGORIES };
  }

  async getPersonnel(user, personnelId) {
    const access = await this.assertPersonnelPermission(user, personnelId, 'view');
    const accessibleAssignments = [];
    for (const assignment of access.assignments) {
      try {
        await this.assertPropertyPermission(user, assignment.propertyId, 'view');
        accessibleAssignments.push(assignment.propertyId);
      } catch (error) {
        if (!(error instanceof ServicePersonnelError) || error.status !== 403) throw error;
      }
    }

    return this.prisma.servicePersonnel.findUnique({
      where: { id: personnelId },
      include: {
        ...PERSONNEL_INCLUDE,
        assignments: {
          where: { propertyId: { in: accessibleAssignments } },
          include: {
            property: { select: { id: true, name: true, address: true } },
            schedules: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] }
          },
          orderBy: { startDate: 'desc' }
        }
      }
    });
  }

  async createPersonnel(user, input) {
    const personnelType = requireEnum(input.personnelType, PERSONNEL_TYPES, 'personnelType');
    const assignment = this.normalizeAssignment(input.assignment || {});
    await this.assertPropertyPermission(user, assignment.propertyId, 'create');

    let source;
    if (personnelType === 'INTERNAL') {
      if (!['ADMIN', 'MANAGER'].includes(user.role)) {
        throw new ServicePersonnelError('Only administrators and managers can assign internal employees', 403);
      }
      const employeeId = requireText(input.employeeId, 'employeeId');
      source = await this.prisma.employee.findUnique({ where: { id: employeeId } });
      if (!source) throw new ServicePersonnelError('Employee not found', 404);
      if (user.role === 'MANAGER' && source.createdById !== user.id) {
        throw new ServicePersonnelError('You can only assign employees you manage', 403);
      }
      const existing = await this.prisma.servicePersonnel.findUnique({ where: { employeeId } });
      if (existing) {
        throw new ServicePersonnelError('This employee already has a service personnel profile', 409);
      }
    } else {
      const serviceProviderId = requireText(input.serviceProviderId, 'serviceProviderId');
      source = await this.prisma.serviceProvider.findUnique({ where: { id: serviceProviderId } });
      if (!source) throw new ServicePersonnelError('Service provider not found', 404);
      await this.assertPropertyPermission(user, source.propertyId, 'view');
    }

    const schedules = Array.isArray(input.schedules)
      ? input.schedules.map(schedule => normalizeSchedule(schedule))
      : [];

    return this.prisma.servicePersonnel.create({
      data: {
        personnelType,
        employeeId: personnelType === 'INTERNAL' ? source.id : null,
        serviceProviderId: personnelType === 'EXTERNAL' ? source.id : null,
        name: personnelType === 'INTERNAL' ? source.name : requireText(input.name, 'name'),
        phoneNumber: personnelType === 'INTERNAL' ? source.phoneNumber : optionalText(input.phoneNumber),
        email: personnelType === 'INTERNAL' ? source.email : optionalText(input.email),
        jobRole: requireText(input.jobRole || assignment.jobRole, 'jobRole'),
        status: requireEnum(input.status || 'ACTIVE', PERSONNEL_STATUSES, 'personnel status'),
        createdById: user.id,
        assignments: {
          create: {
            ...assignment,
            createdById: user.id,
            schedules: schedules.length
              ? { create: schedules.map(schedule => ({ ...schedule, createdById: user.id })) }
              : undefined
          }
        }
      },
      include: PERSONNEL_INCLUDE
    });
  }

  async updatePersonnel(user, personnelId, input) {
    const personnel = await this.assertPersonnelPermission(user, personnelId, 'edit');
    if (user.role !== 'ADMIN' && personnel.createdById !== user.id) {
      throw new ServicePersonnelError(
        'Only the personnel profile creator or an administrator can update this shared profile',
        403
      );
    }
    const data = {};
    if (input.name !== undefined) data.name = requireText(input.name, 'name');
    if (input.phoneNumber !== undefined) data.phoneNumber = optionalText(input.phoneNumber);
    if (input.email !== undefined) data.email = optionalText(input.email);
    if (input.jobRole !== undefined) data.jobRole = requireText(input.jobRole, 'jobRole');
    if (input.status !== undefined) {
      data.status = requireEnum(input.status, PERSONNEL_STATUSES, 'personnel status');
    }
    if (!Object.keys(data).length) throw new ServicePersonnelError('No supported fields were provided');

    return this.prisma.servicePersonnel.update({
      where: { id: personnelId },
      data,
      include: PERSONNEL_INCLUDE
    });
  }

  async createAssignment(user, personnelId, input) {
    await this.assertPersonnelPermission(user, personnelId, 'view');
    const assignment = this.normalizeAssignment(input);
    await this.assertPropertyPermission(user, assignment.propertyId, 'create');

    const duplicate = await this.prisma.propertyServiceAssignment.findFirst({
      where: { personnelId, propertyId: assignment.propertyId, status: 'ACTIVE' }
    });
    if (duplicate && assignment.status === 'ACTIVE') {
      throw new ServicePersonnelError('This person already has an active assignment at the property', 409);
    }

    return this.prisma.propertyServiceAssignment.create({
      data: { ...assignment, personnelId, createdById: user.id },
      include: {
        property: { select: { id: true, name: true, address: true } },
        schedules: true,
        personnel: { select: { id: true, name: true, personnelType: true } }
      }
    });
  }

  async updateAssignment(user, assignmentId, input) {
    const existing = await this.prisma.propertyServiceAssignment.findUnique({ where: { id: assignmentId } });
    if (!existing) throw new ServicePersonnelError('Assignment not found', 404);
    await this.assertPropertyPermission(user, existing.propertyId, 'edit');

    const data = {};
    if (input.serviceCategory !== undefined) {
      data.serviceCategory = requireEnum(input.serviceCategory, SERVICE_CATEGORIES, 'serviceCategory');
    }
    if (input.jobRole !== undefined) data.jobRole = requireText(input.jobRole, 'jobRole');
    if (input.notes !== undefined) data.notes = optionalText(input.notes);
    if (input.startDate !== undefined) data.startDate = parseDate(input.startDate, 'startDate');
    if (input.endDate !== undefined) data.endDate = parseDate(input.endDate, 'endDate');
    if (input.status !== undefined) {
      data.status = requireEnum(input.status, ASSIGNMENT_STATUSES, 'assignment status');
      if (data.status === 'INACTIVE' && input.endDate === undefined && !existing.endDate) {
        data.endDate = new Date();
      }
    }
    const start = data.startDate || existing.startDate;
    const end = data.endDate === undefined ? existing.endDate : data.endDate;
    validateDateRange(start, end);

    return this.prisma.propertyServiceAssignment.update({
      where: { id: assignmentId },
      data,
      include: {
        property: { select: { id: true, name: true, address: true } },
        schedules: true,
        personnel: { select: { id: true, name: true, personnelType: true } }
      }
    });
  }

  async createSchedule(user, assignmentId, input) {
    const assignment = await this.prisma.propertyServiceAssignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new ServicePersonnelError('Assignment not found', 404);
    await this.assertPropertyPermission(user, assignment.propertyId, 'edit');
    if (assignment.status !== 'ACTIVE') {
      throw new ServicePersonnelError('Schedules can only be added to active assignments', 409);
    }

    const schedule = normalizeSchedule(input);
    const duplicate = await this.prisma.personnelSchedule.findFirst({
      where: {
        assignmentId,
        dayOfWeek: schedule.dayOfWeek,
        shiftType: schedule.shiftType,
        isActive: true
      }
    });
    if (duplicate) throw new ServicePersonnelError('An active schedule already exists for this day and shift', 409);

    return this.prisma.personnelSchedule.create({
      data: { ...schedule, assignmentId, createdById: user.id }
    });
  }

  async updateSchedule(user, scheduleId, input) {
    const existing = await this.prisma.personnelSchedule.findUnique({
      where: { id: scheduleId },
      include: { assignment: { select: { propertyId: true } } }
    });
    if (!existing) throw new ServicePersonnelError('Schedule not found', 404);
    await this.assertPropertyPermission(user, existing.assignment.propertyId, 'edit');

    const merged = normalizeSchedule({
      dayOfWeek: input.dayOfWeek ?? existing.dayOfWeek,
      shiftType: input.shiftType ?? existing.shiftType,
      startTime: input.startTime ?? existing.startTime,
      endTime: input.endTime ?? existing.endTime,
      effectiveFrom: input.effectiveFrom ?? existing.effectiveFrom,
      effectiveTo: input.effectiveTo === undefined ? existing.effectiveTo : input.effectiveTo,
      isActive: input.isActive ?? existing.isActive,
      notes: input.notes === undefined ? existing.notes : input.notes
    });

    return this.prisma.personnelSchedule.update({ where: { id: scheduleId }, data: merged });
  }
}
