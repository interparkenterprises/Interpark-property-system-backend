import test from 'node:test';
import assert from 'node:assert/strict';
import { ResendPersonnelInvitationDelivery } from '../src/services/personnelInvitationEmail.service.js';

const withEmailEnvironment = async callback => {
  const previous = { key: process.env.RESEND_API_KEY, frontend: process.env.FRONTEND_URL };
  process.env.RESEND_API_KEY = 're_test_only';
  process.env.FRONTEND_URL = 'https://portal.example.test/';
  try {
    await callback();
  } finally {
    if (previous.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.key;
    if (previous.frontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previous.frontend;
  }
};

test('Resend acceptance produces a fragment activation link and confirmed delivery', async () => {
  await withEmailEnvironment(async () => {
    let message;
    const delivery = new ResendPersonnelInvitationDelivery({
      clientFactory: () => ({ emails: { send: async input => {
        message = input;
        return { data: { id: 'resend-message-1' }, error: null };
      } } })
    });
    const result = await delivery.deliverActivationInvitation({
      recipient: { email: 'worker@example.test', name: 'Jane Wanjiku' },
      rawToken: 'secret-token',
      expiresAt: new Date('2026-11-18T10:00:00Z')
    });
    assert.equal(result.delivered, true);
    assert.equal(result.providerMessageId, 'resend-message-1');
    assert.match(message.html, /\/personnel\/activate#token=secret-token/);
    assert.doesNotMatch(message.html, /password[^<]*:/i);
  });
});

test('provider rejection is never reported as delivered', async () => {
  await withEmailEnvironment(async () => {
    const delivery = new ResendPersonnelInvitationDelivery({
      clientFactory: () => ({ emails: { send: async () => ({ data: null, error: { message: 'rejected' } }) } })
    });
    const result = await delivery.deliverActivationInvitation({
      recipient: { email: 'worker@example.test', name: 'Worker' },
      rawToken: 'secret-token',
      expiresAt: new Date()
    });
    assert.equal(result.delivered, false);
    assert.equal(result.deliveryStatus, 'FAILED');
  });
});

test('missing credentials do not initialize Resend or throw during startup', async () => {
  const previous = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  let initialized = false;
  const delivery = new ResendPersonnelInvitationDelivery({
    clientFactory: () => { initialized = true; throw new Error('must not initialize'); }
  });
  const result = await delivery.deliverActivationInvitation({
    recipient: { email: 'worker@example.test', name: 'Worker' }, rawToken: 'token', expiresAt: new Date()
  });
  assert.equal(initialized, false);
  assert.equal(result.delivered, false);
  assert.equal(result.errorCode, 'EMAIL_NOT_CONFIGURED');
  if (previous !== undefined) process.env.RESEND_API_KEY = previous;
});

test('password reset email uses a fragment token and contains no password', async () => {
  await withEmailEnvironment(async () => {
    let message;
    const delivery = new ResendPersonnelInvitationDelivery({
      clientFactory: () => ({ emails: { send: async input => {
        message = input;
        return { data: { id: 'reset-message-1' }, error: null };
      } } })
    });
    const result = await delivery.deliverPasswordReset({
      recipient: { name: 'Reset Worker', email: 'worker@example.test' },
      rawToken: 'private-reset-token', expiresAt: new Date('2026-11-17T10:00:00Z')
    });
    assert.equal(result.delivered, true);
    assert.match(message.text, /\/personnel\/reset-password#token=private-reset-token/);
    assert.doesNotMatch(message.text, /temporary password/i);
  });
});
