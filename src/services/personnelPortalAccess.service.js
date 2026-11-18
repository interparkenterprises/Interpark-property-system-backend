import { randomBytes } from 'node:crypto';
import { generateAccountToken } from '../utils/accountToken.js';
import { hashPassword } from '../utils/hashPassword.js';
import { ServicePersonnelError } from './servicePersonnel.service.js';
import { ResendPersonnelInvitationDelivery } from './personnelInvitationEmail.service.js';

export const PORTAL_RESEND_COOLDOWN_MS = 5 * 60 * 1000;

export const PORTAL_AUDIT_ACTIONS = Object.freeze({
  GRANT: 'PERSONNEL_PORTAL_ACCESS_GRANTED',
  RESEND: 'PERSONNEL_PORTAL_INVITATION_RESENT',
  DISABLE: 'PERSONNEL_PORTAL_ACCESS_DISABLED',
  ENABLE: 'PERSONNEL_PORTAL_ACCESS_ENABLED'
});

const normalizeEmail = value => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ServicePersonnelError('A personnel email address is required before portal access can be granted');
  }
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ServicePersonnelError('The personnel email address is invalid');
  }
  return email;
};

const portalState = personnel => {
  if (!personnel.user) return 'NOT_GRANTED';
  if (personnel.portalAccessStatus === 'PENDING_ACTIVATION') return 'PENDING_ACTIVATION';
  if (personnel.portalAccessStatus === 'ACTIVE') return 'ENABLED';
  return 'DISABLED';
};

const invitationView = (expiresAt, delivery = {}) => ({
  prepared: true,
  delivered: delivery.delivered === true,
  deliveryStatus: delivery.deliveryStatus || 'NOT_CONFIGURED',
  expiresAt,
  deliveryAttemptedAt: delivery.deliveryAttemptedAt || null,
  deliveredAt: delivery.deliveredAt || null
});

const accessView = (personnel, invitation = null) => ({
  personnelId: personnel.id,
  email: personnel.user?.email || personnel.email || null,
  portalState: portalState(personnel),
  hasAccount: Boolean(personnel.user),
  activatedAt: personnel.user?.passwordChangedAt || null,
  loginEnabled: Boolean(personnel.user?.isApproved && personnel.user?.canManagerLogin),
  invitation
});

export class PersonnelPortalAccessService {
  constructor(prismaClient, invitationDelivery = new ResendPersonnelInvitationDelivery()) {
    if (!prismaClient) throw new TypeError('A Prisma client is required');
    this.prisma = prismaClient;
    this.invitationDelivery = invitationDelivery;
  }

  async requireOwnerOrAdmin(actor, personnelId, client = this.prisma) {
    const personnel = await client.servicePersonnel.findUnique({
      where: { id: personnelId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            isApproved: true,
            canManagerLogin: true,
            passwordChangedAt: true
          }
        }
      }
    });
    if (!personnel) throw new ServicePersonnelError('Service personnel record not found', 404);
    if (actor.role !== 'ADMIN' && personnel.createdById !== actor.id) {
      throw new ServicePersonnelError(
        'Only the personnel profile creator or an administrator can manage portal access',
        403
      );
    }
    return personnel;
  }

  async audit(client, action, actor, personnel, targetUserId, metadata, changes) {
    await client.rBACAuditLog.create({
      data: {
        action,
        performedBy: actor.id,
        targetUser: targetUserId,
        changes: { personnelId: personnel.id, ...changes },
        ipAddress: metadata?.ipAddress || null,
        userAgent: metadata?.userAgent || null
      }
    });
  }

  async getAccess(actor, personnelId) {
    const personnel = await this.requireOwnerOrAdmin(actor, personnelId);
    if (!personnel.user) return accessView(personnel);
    const latest = await this.prisma.accountToken.findFirst({
      where: { userId: personnel.user.id, type: 'PERSONNEL_ACTIVATION' },
      orderBy: { createdAt: 'desc' },
      select: {
        expiresAt: true,
        deliveryStatus: true,
        deliveryAttemptedAt: true,
        deliveredAt: true
      }
    });
    return accessView(personnel, latest ? invitationView(latest.expiresAt, {
      delivered: latest.deliveryStatus === 'ACCEPTED',
      deliveryStatus: latest.deliveryStatus,
      deliveryAttemptedAt: latest.deliveryAttemptedAt,
      deliveredAt: latest.deliveredAt
    }) : null);
  }

  async createActivationToken(client, userId, now) {
    await client.accountToken.updateMany({
      where: { userId, type: 'PERSONNEL_ACTIVATION', usedAt: null },
      data: { usedAt: now }
    });
    const generated = generateAccountToken('PERSONNEL_ACTIVATION', now);
    const stored = await client.accountToken.create({
      data: {
        userId,
        type: 'PERSONNEL_ACTIVATION',
        tokenHash: generated.tokenHash,
        expiresAt: generated.expiresAt
      }
    });
    return { ...generated, id: stored.id };
  }

  async deliver(personnel, generated) {
    let delivery;
    try {
      delivery = await this.invitationDelivery.deliverActivationInvitation({
        recipient: { email: personnel.user.email, name: personnel.name },
        rawToken: generated.rawToken,
        expiresAt: generated.expiresAt
      });
    } catch {
      delivery = { delivered: false, deliveryStatus: 'FAILED', errorCode: 'DELIVERY_ADAPTER_ERROR' };
    }
    const accepted = delivery.delivered === true && delivery.deliveryStatus === 'ACCEPTED';
    await this.prisma.accountToken.update({
      where: { id: generated.id },
      data: {
        deliveryStatus: accepted ? 'ACCEPTED' : 'FAILED',
        deliveryAttemptedAt: new Date(),
        deliveredAt: accepted ? new Date() : null,
        providerMessageId: accepted ? delivery.providerMessageId : null,
        deliveryErrorCode: accepted ? null : (delivery.errorCode || 'DELIVERY_FAILED')
      }
    });
    return accepted
      ? { ...delivery, delivered: true, deliveryStatus: 'ACCEPTED' }
      : { ...delivery, delivered: false, deliveryStatus: 'FAILED' };
  }

  async invite(actor, personnelId, metadata = {}, now = new Date()) {
    const initialPassword = randomBytes(64).toString('base64url');
    const unusablePasswordHash = await hashPassword(initialPassword);
    const result = await this.prisma.$transaction(async client => {
      const personnel = await this.requireOwnerOrAdmin(actor, personnelId, client);
      if (personnel.user) {
        throw new ServicePersonnelError(
          personnel.user.passwordChangedAt
            ? 'This personnel account has already been activated'
            : 'A pending personnel account already exists; use resend instead',
          409
        );
      }
      const email = normalizeEmail(personnel.email);
      const duplicate = await client.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } }
      });
      if (duplicate) throw new ServicePersonnelError('This email address already belongs to an existing user', 409);

      let user;
      try {
        user = await client.user.create({
          data: {
            name: personnel.name,
            email,
            password: unusablePasswordHash,
            role: 'PERSONNEL',
            isApproved: false,
            canManagerLogin: false,
            isManagedUser: true,
            createdByManagerId: actor.id
          }
        });
      } catch (error) {
        if (error?.code === 'P2002') {
          throw new ServicePersonnelError('This email address already belongs to an existing user', 409);
        }
        throw error;
      }

      const linkedPersonnel = await client.servicePersonnel.update({
        where: { id: personnel.id },
        data: { userId: user.id, portalAccessStatus: 'PENDING_ACTIVATION' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              isApproved: true,
              canManagerLogin: true,
              passwordChangedAt: true
            }
          }
        }
      });
      const generated = await this.createActivationToken(client, user.id, now);
      await this.audit(client, PORTAL_AUDIT_ACTIONS.GRANT, actor, personnel, user.id, metadata, {
        portalState: 'PENDING_ACTIVATION',
        invitationDelivered: false
      });
      return { personnel: linkedPersonnel, generated };
    });

    const delivery = await this.deliver(result.personnel, result.generated);
    return accessView(result.personnel, invitationView(result.generated.expiresAt, delivery));
  }

  async assertResendCooldown(client, userId, now) {
    const latest = await client.accountToken.findFirst({
      where: {
        userId,
        type: 'PERSONNEL_ACTIVATION',
        deliveryStatus: { not: 'FAILED' }
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    });
    if (!latest) return;
    const retryAfterMs = PORTAL_RESEND_COOLDOWN_MS - (now.getTime() - latest.createdAt.getTime());
    if (retryAfterMs > 0) {
      const error = new ServicePersonnelError('Please wait before resending the activation invitation', 429);
      error.retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
      throw error;
    }
  }

  async resend(actor, personnelId, metadata = {}, now = new Date()) {
    const result = await this.prisma.$transaction(async client => {
      const personnel = await this.requireOwnerOrAdmin(actor, personnelId, client);
      if (!personnel.user) throw new ServicePersonnelError('Portal access has not been granted', 409);
      if (personnel.portalAccessStatus !== 'PENDING_ACTIVATION') {
        throw new ServicePersonnelError('Portal access must be enabled before sending an activation invitation', 409);
      }
      if (personnel.user.passwordChangedAt) {
        throw new ServicePersonnelError('Activated personnel accounts do not require activation invitations', 409);
      }
      await this.assertResendCooldown(client, personnel.user.id, now);
      const generated = await this.createActivationToken(client, personnel.user.id, now);
      await this.audit(client, PORTAL_AUDIT_ACTIONS.RESEND, actor, personnel, personnel.user.id, metadata, {
        portalState: 'PENDING_ACTIVATION',
        invitationDelivered: false
      });
      return { personnel, generated };
    });
    const delivery = await this.deliver(result.personnel, result.generated);
    return accessView(result.personnel, invitationView(result.generated.expiresAt, delivery));
  }

  async disable(actor, personnelId, metadata = {}, now = new Date()) {
    return this.prisma.$transaction(async client => {
      const personnel = await this.requireOwnerOrAdmin(actor, personnelId, client);
      if (!personnel.user) throw new ServicePersonnelError('Portal access has not been granted', 409);
      const user = await client.user.update({
        where: { id: personnel.user.id },
        data: {
          isApproved: false,
          canManagerLogin: false,
          ...(personnel.user.passwordChangedAt ? { passwordChangedAt: now } : {})
        }
      });
      const updatedPersonnel = await client.servicePersonnel.update({
        where: { id: personnel.id },
        data: { portalAccessStatus: 'DISABLED' },
        include: { user: true }
      });
      await client.accountToken.updateMany({
        where: {
          userId: user.id,
          type: { in: ['PERSONNEL_ACTIVATION', 'PERSONNEL_PASSWORD_RESET'] },
          usedAt: null
        },
        data: { usedAt: now }
      });
      await this.audit(client, PORTAL_AUDIT_ACTIONS.DISABLE, actor, personnel, user.id, metadata, {
        portalState: 'DISABLED'
      });
      return accessView({ ...updatedPersonnel, user: { ...personnel.user, ...user } });
    });
  }

  async enable(actor, personnelId, metadata = {}, now = new Date()) {
    const result = await this.prisma.$transaction(async client => {
      const personnel = await this.requireOwnerOrAdmin(actor, personnelId, client);
      if (!personnel.user) throw new ServicePersonnelError('Portal access has not been granted', 409);

      if (personnel.user.passwordChangedAt) {
        const user = await client.user.update({
          where: { id: personnel.user.id },
          data: { isApproved: true, canManagerLogin: true }
        });
        const updatedPersonnel = await client.servicePersonnel.update({
          where: { id: personnel.id },
          data: { portalAccessStatus: 'ACTIVE' },
          include: { user: true }
        });
        await this.audit(client, PORTAL_AUDIT_ACTIONS.ENABLE, actor, personnel, user.id, metadata, {
          portalState: 'ENABLED',
          activationRequired: false
        });
        return { personnel: { ...updatedPersonnel, user: { ...personnel.user, ...user } }, generated: null };
      }

      const user = await client.user.update({
        where: { id: personnel.user.id },
        data: { isApproved: false, canManagerLogin: false }
      });
      const updatedPersonnel = await client.servicePersonnel.update({
        where: { id: personnel.id },
        data: { portalAccessStatus: 'PENDING_ACTIVATION' },
        include: { user: true }
      });
      const generated = await this.createActivationToken(client, user.id, now);
      await this.audit(client, PORTAL_AUDIT_ACTIONS.ENABLE, actor, personnel, user.id, metadata, {
        portalState: 'PENDING_ACTIVATION',
        activationRequired: true,
        invitationDelivered: false
      });
      return { personnel: { ...updatedPersonnel, user: { ...personnel.user, ...user } }, generated };
    });

    if (!result.generated) return accessView(result.personnel);
    const delivery = await this.deliver(result.personnel, result.generated);
    return accessView(result.personnel, invitationView(result.generated.expiresAt, delivery));
  }
}
