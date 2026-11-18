export const PERSONNEL_ASSIGNMENT_TIMINGS = Object.freeze({
  CURRENT: 'CURRENT',
  UPCOMING: 'UPCOMING',
  ENDED: 'ENDED'
});

export const getPersonnelAssignmentTiming = (assignment, now = new Date()) => {
  const startDate = new Date(assignment.startDate);
  const endDate = assignment.endDate ? new Date(assignment.endDate) : null;

  if (assignment.status !== 'ACTIVE' || (endDate && endDate < now)) {
    return PERSONNEL_ASSIGNMENT_TIMINGS.ENDED;
  }
  if (startDate > now) return PERSONNEL_ASSIGNMENT_TIMINGS.UPCOMING;
  return PERSONNEL_ASSIGNMENT_TIMINGS.CURRENT;
};
