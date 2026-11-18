import { Resend } from 'resend';

const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const configuredSender = () => {
  const email = process.env.PERSONNEL_EMAIL_FROM || process.env.EMAIL_FROM || 'onboarding@resend.dev';
  return email.includes('<') ? email : `"Interpark Property System" <${email}>`;
};

export class ResendPersonnelInvitationDelivery {
  constructor({ clientFactory } = {}) {
    this.clientFactory = clientFactory || (apiKey => new Resend(apiKey));
    this.client = null;
  }

  getClient() {
    if (!process.env.RESEND_API_KEY) return null;
    this.client ||= this.clientFactory(process.env.RESEND_API_KEY);
    return this.client;
  }

  activationUrl(rawToken) {
    const frontendUrl = process.env.FRONTEND_URL?.replace(/\/+$/, '');
    if (!frontendUrl) return null;
    return `${frontendUrl}/personnel/activate#token=${encodeURIComponent(rawToken)}`;
  }

  passwordResetUrl(rawToken) {
    const frontendUrl = process.env.FRONTEND_URL?.replace(/\/+$/, '');
    if (!frontendUrl) return null;
    return `${frontendUrl}/personnel/reset-password#token=${encodeURIComponent(rawToken)}`;
  }

  async sendMessage(message) {
    const client = this.getClient();
    if (!client) return { delivered: false, deliveryStatus: 'FAILED', errorCode: 'EMAIL_NOT_CONFIGURED' };
    try {
      const { data, error } = await client.emails.send(message);
      if (error || !data?.id) {
        return { delivered: false, deliveryStatus: 'FAILED', errorCode: 'PROVIDER_REJECTED' };
      }
      return { delivered: true, deliveryStatus: 'ACCEPTED', providerMessageId: data.id };
    } catch {
      return { delivered: false, deliveryStatus: 'FAILED', errorCode: 'PROVIDER_ERROR' };
    }
  }

  async deliverActivationInvitation({ recipient, rawToken, expiresAt }) {
    const activationUrl = this.activationUrl(rawToken);
    if (!this.getClient()) return { delivered: false, deliveryStatus: 'FAILED', errorCode: 'EMAIL_NOT_CONFIGURED' };
    if (!activationUrl) {
      return { delivered: false, deliveryStatus: 'FAILED', errorCode: 'FRONTEND_URL_NOT_CONFIGURED' };
    }

    const safeName = escapeHtml(recipient.name);
    const expiryText = expiresAt.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
    return this.sendMessage({
        from: configuredSender(),
        to: recipient.email,
        subject: 'Activate your Interpark personnel portal account',
        html: `<!doctype html>
<html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:24px;color:#1f2937">
<div style="max-width:600px;margin:auto;background:#fff;border-radius:10px;padding:32px">
<h1 style="color:#172554;font-size:24px">Interpark Personnel Portal</h1>
<p>Hello ${safeName},</p>
<p>Your property manager has invited you to access your Interpark work assignments and schedules.</p>
<p style="margin:28px 0"><a href="${escapeHtml(activationUrl)}" style="background:#f59e0b;color:#111827;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Create my password</a></p>
<p>This single-use link expires at ${escapeHtml(expiryText)}.</p>
<p>If you were not expecting this invitation, you can ignore this email.</p>
</div></body></html>`,
        text: `Hello ${recipient.name},\n\nYour property manager invited you to the Interpark Personnel Portal. Create your password using this single-use link:\n${activationUrl}\n\nThe link expires at ${expiryText}.\n\nIf you were not expecting this invitation, ignore this email.`
    });
  }

  async deliverPasswordReset({ recipient, rawToken, expiresAt }) {
    const resetUrl = this.passwordResetUrl(rawToken);
    if (!this.getClient()) return { delivered: false, deliveryStatus: 'FAILED', errorCode: 'EMAIL_NOT_CONFIGURED' };
    if (!resetUrl) return { delivered: false, deliveryStatus: 'FAILED', errorCode: 'FRONTEND_URL_NOT_CONFIGURED' };

    const safeName = escapeHtml(recipient.name);
    const expiryText = expiresAt.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
    return this.sendMessage({
      from: configuredSender(),
      to: recipient.email,
      subject: 'Reset your Interpark personnel portal password',
      html: `<!doctype html>
<html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:24px;color:#1f2937">
<div style="max-width:600px;margin:auto;background:#fff;border-radius:10px;padding:32px">
<h1 style="color:#172554;font-size:24px">Reset your personnel portal password</h1>
<p>Hello ${safeName},</p>
<p>A password reset was requested for your Interpark Personnel Portal account.</p>
<p style="margin:28px 0"><a href="${escapeHtml(resetUrl)}" style="background:#f59e0b;color:#111827;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Choose a new password</a></p>
<p>This single-use link expires at ${escapeHtml(expiryText)}.</p>
<p>If you did not request this reset, ignore this email. Your current password remains unchanged.</p>
</div></body></html>`,
      text: `Hello ${recipient.name},\n\nA password reset was requested for your Interpark Personnel Portal account. Choose a new password using this single-use link:\n${resetUrl}\n\nThe link expires at ${expiryText}.\n\nIf you did not request this reset, ignore this email.`
    });
  }
}
