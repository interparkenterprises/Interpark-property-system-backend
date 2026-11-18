import { comparePassword } from '../utils/hashPassword.js';
import { generatePersonnelToken } from '../utils/generateToken.js';
import { generateCsrfToken, hashCsrfToken } from '../utils/personnelSession.js';

const DUMMY_PASSWORD_HASH = '$2b$10$A6xmPW7P3/b00NfNNnCl7O3UMwqcaPiks5yxAXWk78zR.BVTfrDfi';

export const normalizePersonnelEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

export const isEligiblePersonnelAccount = user => Boolean(
  user
  && user.role === 'PERSONNEL'
  && user.passwordChangedAt
  && user.isApproved
  && user.canManagerLogin
  && user.servicePersonnel
  && user.servicePersonnel.status === 'ACTIVE'
  && user.servicePersonnel.portalAccessStatus === 'ACTIVE'
);

export class PersonnelLoginError extends Error {
  constructor() {
    super('Invalid email or password');
    this.name = 'PersonnelLoginError';
    this.status = 401;
  }
}

export class PersonnelSessionService {
  constructor(prismaClient) {
    if (!prismaClient) throw new TypeError('A Prisma client is required');
    this.prisma = prismaClient;
  }

  async login(emailInput, password) {
    const email = normalizePersonnelEmail(emailInput);
    if (!email || typeof password !== 'string') throw new PersonnelLoginError();

    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true,
        name: true,
        email: true,
        password: true,
        role: true,
        isApproved: true,
        canManagerLogin: true,
        passwordChangedAt: true,
        servicePersonnel: {
          select: {
            id: true,
            name: true,
            jobRole: true,
            status: true,
            portalAccessStatus: true
          }
        }
      }
    });

    const passwordValid = await comparePassword(password, user?.password || DUMMY_PASSWORD_HASH);
    if (!user
      || !passwordValid
      || !isEligiblePersonnelAccount(user)) {
      throw new PersonnelLoginError();
    }

    const csrfToken = generateCsrfToken();
    const token = generatePersonnelToken(user.id, {
      csrfHash: hashCsrfToken(csrfToken),
      passwordChangedAt: user.passwordChangedAt
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    return {
      token,
      csrfToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        personnel: {
          id: user.servicePersonnel.id,
          name: user.servicePersonnel.name,
          jobRole: user.servicePersonnel.jobRole
        }
      }
    };
  }
}
