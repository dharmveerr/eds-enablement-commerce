#!/usr/bin/env node

async function main() {
  const baseUrl = process.env.COMMERCE_BASE_URL || process.env.COMMERCE_URL;
  const adminToken = process.env.COMMERCE_ADMIN_TOKEN;

  if (!baseUrl) {
    throw new Error('Missing COMMERCE_BASE_URL or COMMERCE_URL.');
  }

  if (!adminToken) {
    throw new Error('Missing COMMERCE_ADMIN_TOKEN.');
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/V1/oope_payment_method`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code: 'paypal_oope',
      title: 'PayPal OOPE',
      active: true,
      payment_action: 'authorize',
      sort_order: 90,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to register PayPal OOPE payment method: ${response.status} ${text}`);
  }

  const body = await response.json().catch(() => ({}));
  process.stdout.write(`${JSON.stringify({ ok: true, response: body }, null, 2)}\n`);
}

main().catch((error) => {
  throw error;
});
