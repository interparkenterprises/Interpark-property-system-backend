import { generateAccountToken, hashAccountToken } from '../utils/accountToken.js';
import { hashPassword } from '../utils/hashPassword.js';
import { validatePersonnelPassword } from './personnelActivation.service.js';
import { ResendPersonnelInvitationDelivery } from './personnelInvitationEmail.service.js';
import { isEligiblePersonnelAccount, normalizePersonnelEmail } from './personnelSession.service.js';

export const PERSONNEL_PASSWORD_RESET_RESPONSE =
  'If an eligible personnel account exists, password reset instructions have been sent.';

export class PersonnelPasswordResetError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PersonnelPasswordResetError';
    this.status = status;
  }
}

const userSelection = {
  id: true,
  name: true,
  email: true,
  role: true,
  isApproved: true,
  canManagerLogin: true,
  passwordChangedAt: true,
  servicePersonnel: {
    select: {
      id: true,
      status: true,
      portalAccessStatus: true
    }
  }
};

export class PersonnelPasswordResetService {
  constructor(prismaClient, delivery = new ResendPersonnelInvitationDelivery()) {
    if (!prismaClient) throw new TypeError('A Prisma client is required');
    this.prisma = prismaClient;
    this.delivery = delivery;
  }

  async request(emailInput, now = new Date()) {
    const email = normalizePersonnelEmail(emailInput);
    if (!email) return { message: PERSONNEL_PASSWORD_RESET_RESPONSE };

    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: userSelection
    });
    if (!isEligiblePersonnelAccount(user)) {
      return { message: PERSONNEL_PASSWORD_RESET_RESPONSE };
    }

    const generated = generateAccountToken('PERSONNEL_PASSWORD_RESET', now);
    const prepared = await this.prisma.$transaction(async client => {
      const currentUser = await client.user.findUnique({
        where: { id: user.id },
        select: userSelection
      });
      if (!isEligiblePersonnelAccount(currentUser)) return null;

      await client.accountToken.updateMany({
        where: {
          userId: currentUser.id,
          type: 'PERSONNEL_PASSWORD_RESET',
          usedAt: null
        },
        data: { usedAt: now }
      });
      const token = await client.accountToken.create({
        data: {
          userId: currentUser.id,
          type: 'PERSONNEL_PASSWORD_RESET',
          tokenHash: generated.tokenHash,
          expiresAt: generated.expiresAt,
          deliveryStatus: 'PREPARED'
        },
        select: { id: true }
      });
      return { tokenId: token.id, user: currentUser };
    });

    if (!prepared) return { message: PERSONNEL_PASSWORD_RESET_RESPONSE };

    const delivery = await this.delivery.deliverPasswordReset({
      recipient: { name: prepared.user.name, email: prepared.user.email },
      rawToken: generated.rawToken,
      expiresAt: generated.expiresAt
    });
    const accepted = delivery.delivered === true && delivery.deliveryStatus === 'ACCEPTED';
    await this.prisma.accountToken.update({
      where: { id: prepared.tokenId },
      data: {
        deliveryStatus: accepted ? 'ACCEPTED' : 'FAILED',
        deliveryAttemptedAt: new Date(),
        deliveredAt: accepted ? new Date() : null,
        providerMessageId: accepted ? delivery.providerMessageId || null : null,
        deliveryErrorCode: accepted ? null : delivery.errorCode || 'DELIVERY_FAILED'
      }
    });

    return { message: PERSONNEL_PASSWORD_RESET_RESPONSE };
  }

  async reset(rawToken, password, metadata = {}, now = new Date()) {
    if (typeof rawToken !== 'string' || rawToken.length < 32) {
      throw new PersonnelPasswordResetError('The password reset link is invalid or expired');
    }
    validatePersonnelPassword(password);
    const tokenHash = hashAccountToken(rawToken);
    const passwordHash = await hashPassword(password);

    return this.prisma.$transaction(async client => {
      const token = await client.accountToken.findUnique({
        where: { tokenHash },
        include: { user: { include: { servicePersonnel: true } } }
      });
      if (!token
        || token.type !== 'PERSONNEL_PASSWORD_RESET'
        || token.usedAt
        || token.expiresAt <= now
        || token.deliveryStatus !== 'ACCEPTED') {
        throw new PersonnelPasswordResetError('The password reset link is invalid or expired');
      }
      if (!isEligiblePersonnelAccount(token.user)) {
        throw new PersonnelPasswordResetError('The personnel account is not available', 403);
      }

      const claimed = await client.accountToken.updateMany({
        where: {
          id: token.id,
          type: 'PERSONNEL_PASSWORD_RESET',
          usedAt: null,
          expiresAt: { gt: now },
          deliveryStatus: 'ACCEPTED'
        },
        data: { usedAt: now }
      });
      if (claimed.count !== 1) {
        throw new PersonnelPasswordResetError('The password reset link has already been used', 409);
      }

      await client.user.update({
        where: { id: token.user.id },
        data: { password: passwordHash, passwordChangedAt: now }
      });
      await client.accountToken.updateMany({
        where: {
          userId: token.user.id,
          type: 'PERSONNEL_PASSWORD_RESET',
          id: { not: token.id },
          usedAt: null
        },
        data: { usedAt: now }
      });
      await client.rBACAuditLog.create({
        data: {
          action: 'PERSONNEL_PORTAL_PASSWORD_RESET',
          performedBy: token.user.id,
          targetUser: token.user.id,
          changes: { personnelId: token.user.servicePersonnel.id },
          ipAddress: metadata.ipAddress || null,
          userAgent: metadata.userAgent || null
        }
      });

      return { reset: true, resetAt: now };
    });
  }
}
