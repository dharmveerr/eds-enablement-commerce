import {
  createOrder,
  authorizeOrder,
  captureOrder,
  createMockPayPalOrderResponse,
  createMockPayPalCaptureResponse,
} from './paypal-api.js';

const originalFetch = global.fetch;
const originalCrypto = global.crypto;
const originalGlobalThis = global.globalThis;

describe('paypal-api', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    global.globalThis = global;
    globalThis.crypto = {
      randomUUID: jest.fn(() => 'uuid-1234'),
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.crypto = originalCrypto;
    global.globalThis = originalGlobalThis;
    jest.restoreAllMocks();
  });

  it('creates an order and normalizes the PayPal response', async () => {
    fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 'ORDER-1', status: 'CREATED' }),
    });

    const result = await createOrder({ amount: '10.00', intent: 'AUTHORIZE' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0].toString()).toContain('/v1/orders');
    expect(fetch.mock.calls[0][1].headers['X-Idempotency-Key']).toBe('uuid-1234');
    expect(result).toMatchObject({
      paypalOrderId: 'ORDER-1',
      status: 'CREATED',
      result: 'CREATED',
      retryable: false,
      orderNumber: null,
      error: null,
    });
  });

  it('authorizes an order and preserves the authorize result contract', async () => {
    fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 'ORDER-2', status: 'AUTHORIZED', result: 'AUTHORIZED' }),
    });

    const result = await authorizeOrder({ paypalOrderId: 'ORDER-2' });

    expect(result).toMatchObject({
      paypalOrderId: 'ORDER-2',
      status: 'AUTHORIZED',
      result: 'AUTHORIZED',
      retryable: false,
    });
  });

  it('captures an order and returns retryable failure contract on transient errors', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: 'Try later' }),
    });

    const result = await captureOrder({ paypalOrderId: 'ORDER-1' });

    expect(result).toMatchObject({
      paypalOrderId: 'ORDER-1',
      status: 'FAILED',
      result: 'FAILED',
      retryable: true,
      orderNumber: null,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Try later',
      },
    });
  });

  it('creates mock order and capture responses for local dev', () => {
    expect(createMockPayPalOrderResponse({ id: 'ORDER-2' })).toMatchObject({
      id: 'ORDER-2',
      status: 'CREATED',
    });
    expect(createMockPayPalCaptureResponse({ id: 'CAPTURE-1' })).toMatchObject({
      id: 'CAPTURE-1',
      status: 'COMPLETED',
    });
  });
});
