// utils/emailService.js
import { Resend } from 'resend';

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

export function generateSecurePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export async function sendWelcomeEmail({ email, name, temporaryPassword, role, loginUrl, createdBy }) {
  console.log(`📧 Preparing welcome email for: ${email}`);
  
  // Check if API key is configured
  if (!process.env.RESEND_API_KEY) {
    console.error('❌ RESEND_API_KEY not found in environment variables');
    console.log('📝 Fallback to console log only');
    console.log(`=== WELCOME EMAIL ===`);
    console.log(`To: ${email}`);
    console.log(`Name: ${name}`);
    console.log(`Role: ${role}`);
    console.log(`Temporary Password: ${temporaryPassword}`);
    console.log(`Login URL: ${loginUrl}`);
    console.log(`Created by: ${createdBy}`);
    console.log(`====================`);
    return { success: false, error: 'Missing API key' };
  }
  
  // Format the FROM email properly
  let fromEmail = process.env.EMAIL_FROM;
  
  // If EMAIL_FROM is just a domain (no @), add noreply@ prefix
  if (fromEmail && !fromEmail.includes('@')) {
    fromEmail = `noreply@${fromEmail}`;
  }
  
  // If still no valid format, use Resend's test email
  if (!fromEmail || !fromEmail.includes('@')) {
    fromEmail = 'onboarding@resend.dev';
    console.log('📧 Using Resend test email as fallback');
  }
  
  // Add display name if not present
  if (!fromEmail.includes('<') && !fromEmail.startsWith('"')) {
    fromEmail = `"Interpark Property System" <${fromEmail}>`;
  }
  
  try {
    console.log(`📧 Sending via Resend from: ${fromEmail}`);
    
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: `Welcome to Interpark Property System - ${role} Access`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f3f4f6;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background-color: white; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="text-align: center; margin-bottom: 30px;">
                  <h1 style="color: #4F46E5; margin: 0;">Welcome to Interpark Property System</h1>
                </div>
                
                <div style="margin-bottom: 30px;">
                  <p style="font-size: 16px; line-height: 1.5; color: #374151;">Hello <strong>${name}</strong>,</p>
                  <p style="font-size: 16px; line-height: 1.5; color: #374151;">You have been added as a <strong>${role}</strong> by ${createdBy}.</p>
                  
                  <div style="background-color: #F3F4F6; border-left: 4px solid #4F46E5; padding: 15px; margin: 20px 0; border-radius: 4px;">
                    <p style="margin: 0 0 8px 0; font-size: 14px; color: #6B7280;">Your temporary password:</p>
                    <p style="margin: 0; font-size: 24px; font-weight: bold; color: #4F46E5; letter-spacing: 1px;">${temporaryPassword}</p>
                  </div>
                  
                  <p style="font-size: 16px; line-height: 1.5; color: #374151;">Please use this password to log in. You will be required to change it after your first login.</p>
                </div>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${loginUrl}" style="background-color: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Login to Your Account</a>
                </div>
                
                <div style="border-top: 1px solid #E5E7EB; padding-top: 20px; margin-top: 20px;">
                  <p style="font-size: 12px; color: #9CA3AF; text-align: center;">This is an automated message, please do not reply.</p>
                  <p style="font-size: 12px; color: #9CA3AF; text-align: center;">If you didn't request this, please ignore this email.</p>
                </div>
              </div>
            </div>
          </body>
        </html>
      `,
      text: `
Welcome to Interpark Property System!

Hello ${name},

You have been added as a ${role} by ${createdBy}.

Your temporary password: ${temporaryPassword}

Please use this password to log in. You will be required to change it after your first login.

Login URL: ${loginUrl}

This is an automated message, please do not reply.
If you didn't request this, please ignore this email.
      `
    });
    
    if (error) {
      console.error('❌ Resend error:', error);
      // Fallback to console log
      console.log(`=== WELCOME EMAIL (FALLBACK) ===`);
      console.log(`To: ${email}`);
      console.log(`Name: ${name}`);
      console.log(`Role: ${role}`);
      console.log(`Temporary Password: ${temporaryPassword}`);
      console.log(`Login URL: ${loginUrl}`);
      console.log(`Created by: ${createdBy}`);
      console.log(`================================`);
      return { success: false, error: error.message };
    }
    
    console.log(`✅ Welcome email sent successfully to ${email} (ID: ${data?.id})`);
    return { success: true, id: data?.id };
    
  } catch (error) {
    console.error('❌ Failed to send welcome email:', error.message);
    // Fallback to console log
    console.log(`=== WELCOME EMAIL (ERROR FALLBACK) ===`);
    console.log(`To: ${email}`);
    console.log(`Name: ${name}`);
    console.log(`Role: ${role}`);
    console.log(`Temporary Password: ${temporaryPassword}`);
    console.log(`Login URL: ${loginUrl}`);
    console.log(`Created by: ${createdBy}`);
    console.log(`======================================`);
    return { success: false, error: error.message };
  }
}



export async function sendInvitationEmail({
  email,
  name,
  role,
  inviteLink,
  expiresAt,
  invitedBy,
}) {
  console.log(`📧 Preparing invitation email for: ${email} (${role})`);

  const roleLabel = {
    LANDLORD: 'Landlord',
    TENANT: 'Tenant',
    SERVICE_PROVIDER: 'Service Provider',
  }[role] || role;

  const expiryText = expiresAt
    ? new Date(expiresAt).toUTCString()
    : 'in 72 hours';

  // ── Fallback path (no API key / send failure) ──────────────
  const logToConsole = (reason) => {
    console.log(`=== INVITATION EMAIL (${reason}) ===`);
    console.log(`To: ${email}`);
    console.log(`Name: ${name}`);
    console.log(`Role: ${roleLabel}`);
    console.log(`Invited by: ${invitedBy || 'System'}`);
    console.log(`Expires: ${expiryText}`);
    console.log(`Link: ${inviteLink}`);
    console.log(`====================================`);
  };

  if (!process.env.RESEND_API_KEY) {
    console.error('❌ RESEND_API_KEY not found in environment variables');
    logToConsole('NO API KEY');
    return { success: false, error: 'Missing API key' };
  }

  // Same FROM normalization as sendWelcomeEmail.
  let fromEmail = process.env.EMAIL_FROM;
  if (fromEmail && !fromEmail.includes('@')) {
    fromEmail = `noreply@${fromEmail}`;
  }
  if (!fromEmail || !fromEmail.includes('@')) {
    fromEmail = 'onboarding@resend.dev';
    console.log('📧 Using Resend test email as fallback');
  }
  if (!fromEmail.includes('<') && !fromEmail.startsWith('"')) {
    fromEmail = `"Interpark Property System" <${fromEmail}>`;
  }

  try {
    console.log(`📧 Sending invitation via Resend from: ${fromEmail}`);

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: `You're invited to Interpark Property System as a ${roleLabel}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f3f4f6;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background-color: white; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="text-align: center; margin-bottom: 30px;">
                  <h1 style="color: #4F46E5; margin: 0;">You're Invited</h1>
                </div>

                <div style="margin-bottom: 30px;">
                  <p style="font-size: 16px; line-height: 1.5; color: #374151;">Hello <strong>${name}</strong>,</p>
                  <p style="font-size: 16px; line-height: 1.5; color: #374151;">
                    ${invitedBy ? `<strong>${invitedBy}</strong> has invited you` : 'You have been invited'}
                    to join Interpark Property System as a <strong>${roleLabel}</strong>.
                  </p>
                  <p style="font-size: 16px; line-height: 1.5; color: #374151;">
                    Click the button below to set your password and activate your account.
                  </p>

                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${inviteLink}" style="background-color: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Accept Invitation</a>
                  </div>

                  <div style="background-color: #F3F4F6; border-left: 4px solid #F59E0B; padding: 15px; margin: 20px 0; border-radius: 4px;">
                    <p style="margin: 0; font-size: 14px; color: #6B7280;">
                      This invitation link expires on <strong>${expiryText}</strong>.
                      If it expires, ask your administrator to resend it.
                    </p>
                  </div>

                  <p style="font-size: 14px; line-height: 1.5; color: #6B7280;">
                    If the button doesn't work, copy and paste this link into your browser:
                  </p>
                  <p style="font-size: 13px; word-break: break-all; color: #4F46E5;">
                    ${inviteLink}
                  </p>
                </div>

                <div style="border-top: 1px solid #E5E7EB; padding-top: 20px; margin-top: 20px;">
                  <p style="font-size: 12px; color: #9CA3AF; text-align: center;">This is an automated message, please do not reply.</p>
                  <p style="font-size: 12px; color: #9CA3AF; text-align: center;">If you weren't expecting this invitation, you can safely ignore this email.</p>
                </div>
              </div>
            </div>
          </body>
        </html>
      `,
      text: `
You're invited to Interpark Property System!

Hello ${name},

${invitedBy ? `${invitedBy} has invited you` : 'You have been invited'} to join Interpark Property System as a ${roleLabel}.

Accept your invitation and set your password here:
${inviteLink}

This link expires on ${expiryText}. If it expires, ask your administrator to resend it.

If you weren't expecting this invitation, you can safely ignore this email.
      `,
    });

    if (error) {
      console.error('❌ Resend error:', error);
      logToConsole('RESEND ERROR');
      return { success: false, error: error.message };
    }

    console.log(` Invitation email sent to ${email} (ID: ${data?.id})`);
    return { success: true, id: data?.id };
  } catch (error) {
    console.error('❌ Failed to send invitation email:', error.message);
    logToConsole('EXCEPTION');
    return { success: false, error: error.message };
  }
}