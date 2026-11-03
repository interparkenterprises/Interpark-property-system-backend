import { runPrepaidToPaidTransition } from '../services/prepaidTransitionService.js';

export const runPrepaidTransition = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Only an ADMIN can trigger the prepaid transition job' });
    }
    const { dryRun = false, limit = 200, tenantId = null, generatePdf = false } = req.body || {};
    const summary = await runPrepaidToPaidTransition({
      dryRun: Boolean(dryRun),
      limit: Math.max(1, Math.min(1000, Number(limit) || 200)),
      tenantId: tenantId || null,
      generatePdf: Boolean(generatePdf)
    });
    return res.status(200).json({
      success: true, data: summary,
      message: dryRun ? 'Dry run complete — nothing was changed'
        : `Transition complete: ${summary.transitioned} report(s) moved to PAID, ${summary.invoicesCreated} invoice(s) generated`
    });
  } catch (error) {
    console.error('Error running prepaid transition:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const previewPrepaidTransition = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Only an ADMIN can preview the prepaid transition job' });
    }
    const summary = await runPrepaidToPaidTransition({ dryRun: true });
    return res.status(200).json({ success: true, data: summary, message: 'Preview only — nothing was changed' });
  } catch (error) {
    console.error('Error previewing prepaid transition:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export default { runPrepaidTransition, previewPrepaidTransition };
