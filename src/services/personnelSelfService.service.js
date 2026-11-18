import {
  getPersonnelAssignmentTiming,
  PERSONNEL_ASSIGNMENT_TIMINGS
} from '../utils/personnelAssignmentTiming.js';

export class PersonnelSelfServiceService {
  constructor(prismaClient) {
    if (!prismaClient) throw new TypeError('A Prisma client is required');
    this.prisma = prismaClient;
  }

  async getMe(userId, now = new Date()) {
    const profile = await this.prisma.servicePersonnel.findUnique({
      where: { userId },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        jobRole: true,
        personnelType: true,
        status: true,
        assignments: {
          where: {
            status: 'ACTIVE',
            OR: [{ endDate: null }, { endDate: { gte: now } }]
          },
          orderBy: { startDate: 'asc' },
          select: {
            id: true,
            serviceCategory: true,
            jobRole: true,
            startDate: true,
            endDate: true,
            status: true,
            notes: true,
            property: {
              select: {
                id: true,
                name: true,
                address: true,
                form: true,
                usage: true
              }
            },
            schedules: {
              where: {
                isActive: true,
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }]
              },
              orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
              select: {
                id: true,
                dayOfWeek: true,
                shiftType: true,
                startTime: true,
                endTime: true,
                effectiveFrom: true,
                effectiveTo: true,
                notes: true
              }
            }
          }
        }
      }
    });

    if (!profile) return null;

    const visibleAssignments = profile.assignments.map(assignment => {
      const assignmentTiming = getPersonnelAssignmentTiming(assignment, now);
      const schedules = assignmentTiming === PERSONNEL_ASSIGNMENT_TIMINGS.CURRENT
        ? assignment.schedules.filter(schedule => schedule.effectiveFrom <= now)
        : assignment.schedules;
      return { ...assignment, assignmentTiming, schedules };
    });

    return {
      ...profile,
      assignments: visibleAssignments.filter(
        assignment => assignment.assignmentTiming === PERSONNEL_ASSIGNMENT_TIMINGS.CURRENT
      ),
      upcomingAssignments: visibleAssignments.filter(
        assignment => assignment.assignmentTiming === PERSONNEL_ASSIGNMENT_TIMINGS.UPCOMING
      )
    };
  }
}
