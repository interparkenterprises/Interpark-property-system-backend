import { hashAccountToken } from '../utils/accountToken.js';
import { hashPassword } from '../utils/hashPassword.js';

export class PersonnelActivationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PersonnelActivationError';
    this.status = status;
  }
}

export const validatePersonnelPassword = password => {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new PersonnelActivationError('Password must be between 8 and 128 characters');
  }
  if (/\s/.test(password)
    || !/[a-z]/.test(password)
    || !/[A-Z]/.test(password)
    || !/\d/.test(password)
    || !/[^A-Za-z0-9]/.test(password)) {
    throw new PersonnelActivationError(
      'Password must contain uppercase, lowercase, number and special characters, without spaces'
    );
  }
  return password;
};

export class PersonnelActivationService {
  constructor(prismaClient) {
    if (!prismaClient) throw new TypeError('A Prisma client is required');
    this.prisma = prismaClient;
  }

  async activate(rawToken, password, metadata = {}, now = new Date()) {
    if (typeof rawToken !== 'string' || rawToken.length < 32) {
      throw new PersonnelActivationError('The activation link is invalid or expired');
    }
    validatePersonnelPassword(password);
    const tokenHash = hashAccountToken(rawToken);
    const passwordHash = await hashPassword(password);

    return this.prisma.$transaction(async client => {
      const token = await client.accountToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: {
              servicePersonnel: true
            }
          }
        }
      });

      if (!token
        || token.type !== 'PERSONNEL_ACTIVATION'
        || token.usedAt
        || token.expiresAt <= now
        || token.deliveryStatus !== 'ACCEPTED') {
        throw new PersonnelActivationError('The activation link is invalid or expired');
      }

      const user = token.user;
      const personnel = user?.servicePersonnel;
      if (!user || user.role !== 'PERSONNEL' || !personnel) {
        throw new PersonnelActivationError('The activation account is no longer available', 409);
      }
      if (personnel.status !== 'ACTIVE') {
        throw new PersonnelActivationError('The personnel record is inactive', 403);
      }
      if (personnel.portalAccessStatus !== 'PENDING_ACTIVATION') {
        throw new PersonnelActivationError('Personnel portal access is disabled', 403);
      }
      if (user.passwordChangedAt || user.isApproved || user.canManagerLogin) {
        throw new PersonnelActivationError('This personnel account has already been activated', 409);
      }

      const claimed = await client.accountToken.updateMany({
        where: {
          id: token.id,
          type: 'PERSONNEL_ACTIVATION',
          usedAt: null,
          expiresAt: { gt: now },
          deliveryStatus: 'ACCEPTED'
        },
        data: { usedAt: now }
      });
      if (claimed.count !== 1) {
        throw new PersonnelActivationError('The activation link has already been used', 409);
      }

      await client.user.update({
        where: { id: user.id },
        data: {
          password: passwordHash,
          isApproved: true,
          canManagerLogin: true,
          passwordChangedAt: now
        }
      });
      await client.servicePersonnel.update({
        where: { id: personnel.id },
        data: { portalAccessStatus: 'ACTIVE' }
      });
      await client.accountToken.updateMany({
        where: {
          userId: user.id,
          type: 'PERSONNEL_ACTIVATION',
          id: { not: token.id },
          usedAt: null
        },
        data: { usedAt: now }
      });
      await client.rBACAuditLog.create({
        data: {
          action: 'PERSONNEL_PORTAL_ACCOUNT_ACTIVATED',
          performedBy: user.id,
          targetUser: user.id,
          changes: { personnelId: personnel.id, portalState: 'ACTIVE' },
          ipAddress: metadata.ipAddress || null,
          userAgent: metadata.userAgent || null
        }
      });

      return {
        activated: true,
        personnelId: personnel.id,
        activatedAt: now
      };
    });
  }
}
