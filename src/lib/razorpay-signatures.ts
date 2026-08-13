import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function verifyRazorpayCheckoutSignature(input: { orderId: string; paymentId: string; signature: string }, secret: string) {
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(`${input.orderId}|${input.paymentId}`).digest('hex');
  return safeEqualHex(expected, input.signature);
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string, secret: string) {
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}
