import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  personnelForgotPasswordRateLimit,
  personnelResetPasswordRateLimit
} from '../src/middleware/personnelAuthRateLimits.js';

const verifyLimiter = async limiter => {
  const app = express();
  app.post('/', limiter, (_req, res) => res.status(200).json({ success: true }));
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    for (let count = 0; count < 5; count += 1) {
      assert.equal((await fetch(url, { method: 'POST' })).status, 200);
    }
    assert.equal((await fetch(url, { method: 'POST' })).status, 429);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
};

test('forgot-password endpoint limiter rejects requests after five attempts', async () => {
  await verifyLimiter(personnelForgotPasswordRateLimit);
});

test('reset-password endpoint limiter rejects requests after five attempts', async () => {
  await verifyLimiter(personnelResetPasswordRateLimit);
});
