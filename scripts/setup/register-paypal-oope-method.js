#!/usr/bin/env node
/**
 * Registers the PayPal out-of-process payment method (OOPE) in Adobe Commerce as a
 * Cloud Service so it appears in the checkout payment method list.
 *
 * Run once per environment:
 *   COMMERCE_BASE_URL=... COMMERCE_ADMIN_TOKEN=... PAYPAL_APP_BUILDER_ENDPOINT=... \
 *     node scripts/setup/register-paypal-oope-method.js
 *
 * Operational script only; excluded from the published site via .hlxignore.
 */

const PAYMENT_METHOD_CODE = process.env.PAYPAL_PAYMENT_METHOD_CODE || 'paypal_oope';

async function main() {
  const baseUrl = process.env.COMMERCE_BASE_URL;
  const adminToken = process.env.COMMERCE_ADMIN_TOKEN;
  const backendIntegrationUrl = process.env.PAYPAL_APP_BUILDER_ENDPOINT;

  if (!baseUrl) throw new Error('Missing COMMERCE_BASE_URL.');
  if (!adminToken) throw new Error('Missing COMMERCE_ADMIN_TOKEN.');
  if (!backendIntegrationUrl) throw new Error('Missing PAYPAL_APP_BUILDER_ENDPOINT.');

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/V1/oope_payment_method`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      paymentMethod: {
        code: PAYMENT_METHOD_CODE,
        title: 'Credit or debit card (PayPal)',
        active: true,
        payment_source: 'card',
        backend_integration_url: backendIntegrationUrl,
        sort_order: 90,
      },
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Failed to register PayPal OOPE payment method: ${response.status} ${text}`);
  }

  process.stdout.write(`${text}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
