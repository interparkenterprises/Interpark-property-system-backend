import nodemailer from "nodemailer";
export function generateSecurePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export async function sendWelcomeEmail({ email, name, temporaryPassword, role, loginUrl, createdBy }) {
  // Implement your email sending logic here
  console.log(`=== WELCOME EMAIL ===`);
  console.log(`To: ${email}`);
  console.log(`Name: ${name}`);
  console.log(`Role: ${role}`);
  console.log(`Temporary Password: ${temporaryPassword}`);
  console.log(`Login URL: ${loginUrl}`);
  console.log(`Created by: ${createdBy}`);
  console.log(`====================`);
  
  // In production, use nodemailer or your email service
  // Example with nodemailer:

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: `Welcome to Property Management System - ${role} Access`,
    html: `
      <h2>Welcome ${name}!</h2>
      <p>You have been added as a ${role} by ${createdBy}.</p>
      <p><strong>Temporary Password:</strong> ${temporaryPassword}</p>
      <p>Please login and change your password immediately.</p>
      <a href="${loginUrl}">Login Here</a>
    `
  });
  
}