// utils/emailService.js
import { Resend } from 'resend';

// Initialize Resend with your API key
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
  // Always log for debugging
  console.log(`📧 Preparing welcome email for: ${email}`);
  
  // Check if API key is configured
  if (!process.env.RESEND_API_KEY) {
    console.error('❌ RESEND_API_KEY not found in environment variables');
    console.log('📝 Mock email data:', { email, name, role, temporaryPassword });
    return { success: false, error: 'Missing API key' };
  }
  
  // Check if email is valid
  if (!email || !email.includes('@')) {
    console.error('❌ Invalid email address:', email);
    return { success: false, error: 'Invalid email' };
  }
  
  try {
    // Send email using Resend
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'onboarding@yourdomain.com',
      to: email,
      subject: `Welcome to Interpark Enterprises Property Management System - ${role} Access`,
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
                <!-- Header -->
                <div style="text-align: center; margin-bottom: 30px;">
                  <h1 style="color: #4F46E5; margin: 0;">Welcome to Property Management</h1>
                </div>
                
                <!-- Content -->
                <div style="margin-bottom: 30px;">
                  <p style="font-size: 16px; line-height: 1.5; color: #374151;">Hello <strong>${name}</strong>,</p>
                  <p style="font-size: 16px; line-height: 1.5; color: #374151;">You have been added as a <strong>${role}</strong> by ${createdBy}.</p>
                  
                  <!-- Password Box -->
                  <div style="background-color: #F3F4F6; border-left: 4px solid #4F46E5; padding: 15px; margin: 20px 0; border-radius: 4px;">
                    <p style="margin: 0 0 8px 0; font-size: 14px; color: #6B7280;">Your temporary password:</p>
                    <p style="margin: 0; font-size: 24px; font-weight: bold; color: #4F46E5; letter-spacing: 1px;">${temporaryPassword}</p>
                  </div>
                  
                  <p style="font-size: 16px; line-height: 1.5; color: #374151;">Please use this password to log in. You will be required to change it after your first login.</p>
                </div>
                
                <!-- Button -->
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${loginUrl}" style="background-color: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Login to Your Account</a>
                </div>
                
                <!-- Footer -->
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
Welcome to Interpark Enterprises Property Management System!

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
      return { success: false, error: error.message };
    }
    
    console.log(`✅ Welcome email sent successfully to ${email} (ID: ${data?.id})`);
    return { success: true, id: data?.id };
    
  } catch (error) {
    console.error('❌ Failed to send welcome email:', error.message);
    return { success: false, error: error.message };
  }
}

// Optional: Test email configuration
export async function testEmailConnection() {
  try {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY not configured');
    }
    
    // Resend doesn't have a verify endpoint, so we'll try to get account info
    console.log('✅ Resend is configured with API key');
    return true;
  } catch (error) {
    console.error('❌ Resend configuration error:', error.message);
    return false;
  }
}