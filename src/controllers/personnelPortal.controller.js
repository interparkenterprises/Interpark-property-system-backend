import prisma from '../lib/prisma.js';
import { PersonnelSelfServiceService } from '../services/personnelSelfService.service.js';

const selfService = new PersonnelSelfServiceService(prisma);

export const getPersonnelMe = async (req, res) => {
  try {
    const profile = await selfService.getMe(req.user.id);
    if (!profile) return res.status(404).json({ success: false, message: 'Personnel profile not found' });
    return res.status(200).json({ success: true, data: profile });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to load personnel profile' });
  }
};
