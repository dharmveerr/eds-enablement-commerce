/**
 * Browser client for the Adobe App Builder PayPal actions.
 *
 * App Builder is the only server-side integration boundary: it holds the PayPal
 * credentials, derives the authoritative amount/currency from ACCS, and performs the
 * privileged Orders v2 calls. This module never sees card data, secrets, or totals.
 *
 * Expected action contracts (see paypal_eds_accs_planning_context.md §10, §35):
 *   GET  {base}/browser-safe-client-token -> { clientToken, expiresIn? }
 *   POST {base}/create-order              -> { paypalOrderId, status }
 *   POST {base}/capture-order             -> { paypalOrderId, status, orderNumber? }
 *   POST {base}/get-order                 -> { paypalOrderId, status, orderNumber? }
 */
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** PayPal payment states surfaced to the checkout state machine. */
export const PAYPAL_STATUS = Object.freeze({
  CREATED: 'CREATED',
  APPROVED: 'APPROVED',
  PAYER_ACTION_REQUIRED: 'PAYER_ACTION_REQUIRED',
  COMPLETED: 'COMPLETED',
  PENDING: 'PENDING',
  DENIED: 'DENIED',
  CANCELED: 'CANCELED',
  FAILED: 'FAILED',
});

/**
 * Error raised when an App Builder PayPal action fails.
 */
export class PayPalApiError extends Error {
  constructor(message, {
    code = 'PAYPAL_API_ERROR', status, retryable = false, correlationId, details,
  } = {}) {
    super(message);
    this.name = 'PayPalApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.correlationId = correlationId;
    this.details = details;
  }
}

/**
 * Generates a random identifier used for idempotency and correlation.
 * @returns {string} a unique identifier
 */
export function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Resolves the configured App Builder base URL for the PayPal actions.
 * @returns {string} base URL without a trailing slash
 */
export function getPayPalEndpoint() {
  const endpoint = getConfigValue('paypal-app-builder-endpoint');

  if (!endpoint) {
    throw new PayPalApiError(
      'PayPal App Builder endpoint is not configured.',
      { code: 'PAYPAL_NOT_CONFIGURED' },
    );
  }

  return String(endpoint).replace(/\/+$/, '');
}

/**
 * Resolves the Commerce payment method code used for the PayPal OOPE method.
 * @returns {string} payment method code
 */
export function getPayPalPaymentMethodCode() {
  return getConfigValue('paypal-payment-method-code') || 'paypal_oope';
}

/**
 * True when the storefront has enough configuration to offer PayPal.
 * @returns {boolean} whether the PayPal integration is configured
 */
export function isPayPalConfigured() {
  return Boolean(getConfigValue('paypal-app-builder-endpoint'));
}

const isNetworkError = (error) => error instanceof TypeError || error?.name === 'AbortError';

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Performs a single request against an App Builder action.
 * @param {string} action action path, e.g. 'create-order'
 * @param {object} options request options
 * @returns {Promise<object>} parsed JSON response
 */
async function requestOnce(action, {
  method, body, requestId, signal,
}) {
  const response = await fetch(`${getPayPalEndpoint()}/${action}`, {
    method,
    // App Builder actions are cross-origin; send the correlation/idempotency key
    // as a header and never rely on ambient cookies for authorization.
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'X-Request-Id': requestId,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    throw new PayPalApiError(payload.message || `PayPal request failed (${response.status})`, {
      code: payload.code || `HTTP_${response.status}`,
      status: response.status,
      retryable: RETRYABLE_STATUS.has(response.status),
      correlationId: payload.correlationId || response.headers.get('x-request-id'),
      details: payload.details,
    });
  }

  return payload;
}

/**
 * Calls an App Builder PayPal action with a stable idempotency key across retries.
 *
 * The same `requestId` is reused for every attempt of the same logical operation so
 * PayPal/App Builder can de-duplicate state-changing requests after a timeout.
 * @param {string} action action path
 * @param {object} [options] request options
 * @param {'GET'|'POST'} [options.method] HTTP method
 * @param {object} [options.body] JSON request body
 * @param {string} [options.requestId] stable idempotency key for this operation
 * @param {boolean} [options.retry] whether transient failures may be retried
 * @param {number} [options.timeout] per-attempt timeout in milliseconds
 * @returns {Promise<object>} parsed JSON response
 */
export async function callPayPalAction(action, {
  method = 'POST',
  body,
  requestId = createRequestId(),
  retry = true,
  timeout = DEFAULT_TIMEOUT_MS,
} = {}) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      // Attempts are sequential on purpose: each retry reuses the same idempotency key.
      // eslint-disable-next-line no-await-in-loop
      return await requestOnce(action, {
        method, body, requestId, signal: controller.signal,
      });
    } catch (error) {
      lastError = error instanceof PayPalApiError
        ? error
        : new PayPalApiError(error.message || 'PayPal request failed', {
          code: 'PAYPAL_NETWORK_ERROR',
          retryable: isNetworkError(error),
        });

      const canRetry = retry && lastError.retryable && attempt < MAX_ATTEMPTS;
      if (!canRetry) break;

      // eslint-disable-next-line no-await-in-loop
      await wait(2 ** attempt * 250);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

/**
 * Requests a per-session browser-safe client token for the PayPal v6 SDK.
 * @returns {Promise<string>} the browser-safe client token
 */
export async function getBrowserSafeClientToken() {
  const { clientToken } = await callPayPalAction('browser-safe-client-token', { method: 'GET' });

  if (!clientToken) {
    throw new PayPalApiError('App Builder did not return a browser-safe client token.', {
      code: 'PAYPAL_TOKEN_MISSING',
    });
  }

  return clientToken;
}

/**
 * Asks App Builder to create a PayPal order from the authoritative ACCS cart.
 * The browser sends identifiers only; amounts and currency are derived server side.
 * @param {object} params params
 * @param {string} params.cartId ACCS cart identifier
 * @param {string} params.checkoutAttemptId stable id for this checkout attempt
 * @returns {Promise<{paypalOrderId: string, status: string}>} created order
 */
export async function createPayPalOrder({ cartId, checkoutAttemptId }) {
  const result = await callPayPalAction('create-order', {
    body: { cartId, checkoutAttemptId },
    // Stable key: retrying the same checkout attempt must not create a second order.
    requestId: `paypal-create-${checkoutAttemptId}`,
  });

  if (!result.paypalOrderId) {
    throw new PayPalApiError('App Builder did not return a PayPal order id.', {
      code: 'PAYPAL_ORDER_ID_MISSING',
    });
  }

  return { paypalOrderId: result.paypalOrderId, status: result.status || PAYPAL_STATUS.CREATED };
}

/**
 * Asks App Builder to capture an approved PayPal order.
 * @param {object} params params
 * @param {string} params.cartId ACCS cart identifier
 * @param {string} params.paypalOrderId PayPal order id
 * @param {string} params.captureAttemptId stable id for this capture attempt
 * @returns {Promise<object>} capture result
 */
export async function capturePayPalOrder({ cartId, paypalOrderId, captureAttemptId }) {
  const result = await callPayPalAction('capture-order', {
    body: { cartId, paypalOrderId, captureAttemptId },
    requestId: `paypal-capture-${paypalOrderId}-${captureAttemptId}`,
  });

  return { ...result, paypalOrderId: result.paypalOrderId || paypalOrderId };
}

/**
 * Retrieves the authoritative PayPal/Commerce state for an order.
 * Used to recover from timeouts instead of blindly retrying a capture.
 * @param {object} params params
 * @param {string} params.cartId ACCS cart identifier
 * @param {string} params.paypalOrderId PayPal order id
 * @returns {Promise<object>} reconciled order state
 */
export async function reconcilePayPalOrder({ cartId, paypalOrderId }) {
  return callPayPalAction('get-order', {
    body: { cartId, paypalOrderId },
    requestId: `paypal-get-${paypalOrderId}`,
  });
}
