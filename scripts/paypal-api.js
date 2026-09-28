import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';

const DEFAULT_API_PATH = '/api/paypal';
const DEFAULT_RETRIES = 2;

function createIdempotencyKey() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }

  return `paypal_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getApiBaseUrl() {
  return getConfigValue('paypal-api-endpoint') || DEFAULT_API_PATH;
}

function isRetryableStatus(status) {
  return [502, 503, 504].includes(status);
}

function isRetryableError(error) {
  const message = String(error?.message || '');
  return message.includes('ETIMEDOUT') || message.includes('ECONNRESET') || message.includes('Failed to fetch');
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestJson(path, { method = 'POST', body, headers = {}, retryable = true } = {}) {
  const url = new URL(path, getApiBaseUrl());
  const requestHeaders = {
    'Content-Type': 'application/json',
    'X-Idempotency-Key': createIdempotencyKey(),
    ...headers,
  };

  for (let attempt = 0; attempt <= DEFAULT_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
      });

      const text = await response.text();
      let parsed = {};
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch (parseError) {
          parsed = { rawText: text };
        }
      }

      if (!response.ok) {
        const error = new Error(parsed?.message || `PayPal API request failed with ${response.status}`);
        error.status = response.status;
        error.code = parsed?.code || `HTTP_${response.status}`;
        error.details = parsed?.details;
        error.retryable = retryable && isRetryableStatus(response.status);
        error.response = parsed;
        throw error;
      }

      return parsed;
    } catch (error) {
      const shouldRetry = retryable && attempt < DEFAULT_RETRIES && (isRetryableError(error) || error.retryable);
      if (!shouldRetry) {
        return {
          paypalOrderId: body?.paypalOrderId || null,
          status: 'FAILED',
          result: 'FAILED',
          retryable: Boolean(error.retryable || isRetryableError(error)),
          orderNumber: null,
          error: {
            code: error.code || 'PAYPAL_API_ERROR',
            message: error.message || 'PayPal request failed',
          },
        };
      }

      await delay(2 ** (attempt + 1) * 150);
    }
  }

  return {
    paypalOrderId: body?.paypalOrderId || null,
    status: 'FAILED',
    result: 'FAILED',
    retryable: true,
    orderNumber: null,
    error: {
      code: 'PAYPAL_API_ERROR',
      message: 'PayPal request failed',
    },
  };
}

function normalizeOrderResponse(response, fallbackStatus) {
  const status = response?.status || fallbackStatus || 'FAILED';
  const result = response?.result || status;
  return {
    paypalOrderId: response?.id || response?.paypalOrderId || null,
    status,
    result,
    retryable: Boolean(response?.retryable),
    orderNumber: response?.orderNumber || null,
    error: response?.error || null,
    raw: response,
  };
}

export async function createOrder(payload) {
  const response = await requestJson('/v1/orders', { body: payload });
  return normalizeOrderResponse(response, 'CREATED');
}

export async function authorizeOrder(payload) {
  const response = await requestJson('/v1/orders/authorize', { body: payload });
  return normalizeOrderResponse(response, 'AUTHORIZED');
}

export async function captureOrder(payload) {
  const response = await requestJson('/v1/orders/capture', { body: payload });
  return normalizeOrderResponse(response, 'CAPTURED');
}

export function createMockPayPalOrderResponse(overrides = {}) {
  return {
    id: overrides.id || 'PAYPAL-MOCK-ORDER-ID',
    status: overrides.status || 'CREATED',
    purchase_units: overrides.purchase_units || [],
    links: overrides.links || [],
    ...overrides,
  };
}

export function createMockPayPalCaptureResponse(overrides = {}) {
  return {
    id: overrides.id || 'PAYPAL-MOCK-CAPTURE-ID',
    status: overrides.status || 'COMPLETED',
    purchase_units: overrides.purchase_units || [],
    ...overrides,
  };
}

export { createIdempotencyKey, getApiBaseUrl, requestJson };
