/**
 * PayPal Expanded Checkout (Card Fields) payment method for the checkout block.
 *
 * Responsibility split (paypal_eds_accs_planning_context.md §20/§21):
 *  - EDS owns the containers, UI state machine and orchestration.
 *  - PayPal owns the hosted card inputs; no PAN/CVV ever touches this code.
 *  - App Builder owns the client token, order creation, capture and ACCS sync.
 */
import { events } from '@dropins/tools/event-bus.js';
import { fetchPlaceholders } from '../../scripts/commerce.js';
import {
  PAYPAL_STATUS,
  PayPalApiError,
  capturePayPalOrder,
  createPayPalOrder,
  createRequestId,
  reconcilePayPalOrder,
} from '../../scripts/paypal-api.js';
import {
  createCardFieldsSession,
  getPayPalSdkInstance,
  isAdvancedCardsEligible,
  mountCardField,
} from '../../scripts/paypal-sdk.js';
import { consumeExpressApproval } from '../../scripts/paypal-express.js';

/** Checkout-facing payment states. */
export const PAYPAL_UI_STATE = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  LOADING: 'LOADING',
  INELIGIBLE: 'INELIGIBLE',
  READY: 'READY',
  CREATING_ORDER: 'CREATING_ORDER',
  SUBMITTING_CARD: 'SUBMITTING_CARD',
  AUTHENTICATING: 'AUTHENTICATING',
  CAPTURING: 'CAPTURING',
  CAPTURE_PENDING: 'CAPTURE_PENDING',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
  FAILED: 'FAILED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
});

const FIELD_TYPES = ['name', 'number', 'expiry', 'cvv'];

const DEFAULT_LABELS = {
  loading: 'Loading secure card fields…',
  ineligible: 'Card payments are not available for this order.',
  unavailable: 'PayPal card payments are temporarily unavailable. Please choose another payment method.',
  name: 'Name on card',
  number: 'Card number',
  expiry: 'Expiration date',
  cvv: 'Security code',
  processing: 'Processing your payment…',
  authenticating: 'Confirming your card with your bank…',
  expressApproved: 'Payment approved with PayPal. Review your details and place the order.',
  canceled: 'Card authentication was canceled. You can try again.',
  declined: 'Your card was declined. Please try a different payment method.',
  pending: 'Your payment is being processed. Do not retry; we will confirm your order shortly.',
  reconcile: 'We could not confirm your payment. Please do not retry — contact support with your cart reference.',
  failed: 'We could not process your card payment. Please try again.',
};

/** Live controller for the mounted card fields, or null when not rendered. */
let controller = null;

const labelFor = (placeholders, key) => placeholders?.Checkout?.PayPal?.[key]
  ?? DEFAULT_LABELS[key];

/**
 * Builds the PayPal billing address from the ACCS cart billing address.
 * Only merchant-owned address data is forwarded; never card data.
 * @returns {object|undefined} PayPal billingAddress payload
 */
function getBillingAddress() {
  const checkoutData = events.lastPayload('checkout/updated')
    ?? events.lastPayload('checkout/initialized');
  const address = checkoutData?.billingAddress;

  if (!address) return undefined;

  return {
    addressLine1: address.street?.[0],
    addressLine2: address.street?.[1],
    adminArea1: address.region?.code,
    adminArea2: address.city,
    postalCode: address.postCode,
    countryCode: address.country?.code,
  };
}

/**
 * Renders the status/error message region.
 * @param {string} message message to announce, or empty to clear
 * @param {'error'|'info'} [tone] visual tone
 */
function setMessage(message, tone = 'error') {
  if (!controller?.elements.message) return;

  const $message = controller.elements.message;
  $message.textContent = message ?? '';
  $message.dataset.tone = tone;
  $message.hidden = !message;
}

/**
 * Updates the UI state and reflects it on the container for styling/tests.
 * @param {string} state one of PAYPAL_UI_STATE
 */
function setState(state) {
  if (!controller) return;

  controller.state = state;
  controller.elements.root.dataset.paypalState = state;

  const busy = [
    PAYPAL_UI_STATE.CREATING_ORDER,
    PAYPAL_UI_STATE.SUBMITTING_CARD,
    PAYPAL_UI_STATE.AUTHENTICATING,
    PAYPAL_UI_STATE.CAPTURING,
  ].includes(state);

  controller.elements.root.setAttribute('aria-busy', String(busy));
}

/**
 * Builds the merchant-owned DOM that hosts the PayPal card fields.
 * @param {object} placeholders resolved checkout placeholders
 * @returns {{root: HTMLElement, grid: HTMLElement, status: HTMLElement,
 *   fields: Record<string, HTMLElement>, message: HTMLElement}} elements
 */
function buildFieldsMarkup(placeholders) {
  const root = document.createElement('div');
  root.className = 'checkout__paypal-card-fields';

  const status = document.createElement('p');
  status.className = 'checkout__paypal-status';
  status.textContent = labelFor(placeholders, 'loading');
  root.appendChild(status);

  const grid = document.createElement('div');
  grid.className = 'checkout__paypal-grid';
  grid.hidden = true;
  root.appendChild(grid);

  const fields = {};

  FIELD_TYPES.forEach((type) => {
    const wrapper = document.createElement('div');
    wrapper.className = `checkout__paypal-field checkout__paypal-field--${type}`;

    const label = document.createElement('span');
    label.className = 'checkout__paypal-label';
    label.id = `paypal-card-${type}-label`;
    label.textContent = labelFor(placeholders, type);

    const mount = document.createElement('div');
    mount.className = 'checkout__paypal-mount';
    mount.id = `paypal-card-${type}-field`;
    mount.setAttribute('role', 'group');
    mount.setAttribute('aria-labelledby', label.id);

    wrapper.append(label, mount);
    grid.appendChild(wrapper);
    fields[type] = mount;
  });

  const message = document.createElement('p');
  message.className = 'checkout__paypal-message';
  message.setAttribute('role', 'alert');
  message.setAttribute('aria-live', 'polite');
  message.hidden = true;
  root.appendChild(message);

  return {
    root, grid, status, fields, message,
  };
}

/**
 * Renders PayPal Card Fields into a checkout payment-method slot.
 * Resolves once the fields are mounted or a terminal state is displayed.
 * @param {object} ctx PaymentMethods slot render context
 * @returns {Promise<void>} resolves when rendering settles
 */
export async function renderPayPalCardFields(ctx) {
  const placeholders = await fetchPlaceholders('placeholders/checkout.json');
  const elements = buildFieldsMarkup(placeholders);

  ctx.replaceHTML(elements.root);

  controller = {
    elements,
    placeholders,
    state: PAYPAL_UI_STATE.LOADING,
    session: null,
    eligible: false,
    setAdditionalData: ctx.setAdditionalData,
    checkoutAttemptId: createRequestId(),
    paypalOrderId: null,
    approvedExternally: false,
    inFlight: null,
  };

  setState(PAYPAL_UI_STATE.LOADING);

  try {
    const sdkInstance = await getPayPalSdkInstance();

    if (!await isAdvancedCardsEligible()) {
      controller.eligible = false;
      elements.status.textContent = labelFor(placeholders, 'ineligible');
      setState(PAYPAL_UI_STATE.INELIGIBLE);
      adoptExpressApproval(consumeExpressApproval() ?? {});
      return;
    }

    const session = createCardFieldsSession(sdkInstance, {
      onError: (error) => {
        console.error('PayPal card fields error', error);
        setMessage(labelFor(placeholders, 'failed'));
      },
    });

    await Promise.all(FIELD_TYPES.map((type) => mountCardField(session, {
      type,
      container: elements.fields[type],
    })));

    controller.session = session;
    controller.eligible = true;
    elements.status.hidden = true;
    elements.grid.hidden = false;
    setState(PAYPAL_UI_STATE.READY);

    // An express wallet approval from the cart page takes precedence over the
    // card form for this attempt.
    adoptExpressApproval(consumeExpressApproval() ?? {});
  } catch (error) {
    console.error('Unable to initialize PayPal card fields', error);
    controller.eligible = false;
    elements.status.textContent = labelFor(placeholders, 'unavailable');
    setState(PAYPAL_UI_STATE.FAILED);
  }
}

/**
 * Maps a capture result onto the checkout UI state.
 * @param {object} result capture-order response
 * @returns {boolean} true when the Commerce order may be placed
 */
function handleCaptureResult(result) {
  const { placeholders } = controller;

  switch (result.status) {
    case PAYPAL_STATUS.COMPLETED:
      setState(PAYPAL_UI_STATE.COMPLETED);
      setMessage('');
      controller.setAdditionalData?.({
        paypal_order_id: result.paypalOrderId,
        paypal_capture_id: result.captureId,
      });
      return true;

    case PAYPAL_STATUS.PENDING:
      setState(PAYPAL_UI_STATE.CAPTURE_PENDING);
      setMessage(labelFor(placeholders, 'pending'), 'info');
      return false;

    case PAYPAL_STATUS.DENIED:
      setState(PAYPAL_UI_STATE.FAILED);
      setMessage(labelFor(placeholders, 'declined'));
      // A declined capture ends this attempt; the next try needs a new PayPal order.
      controller.paypalOrderId = null;
      controller.approvedExternally = false;
      controller.checkoutAttemptId = createRequestId();
      return false;

    default:
      setState(PAYPAL_UI_STATE.RECONCILIATION_REQUIRED);
      setMessage(labelFor(placeholders, 'reconcile'));
      return false;
  }
}

/**
 * Runs the full PayPal payment attempt.
 * @param {string} cartId ACCS cart identifier
 * @returns {Promise<boolean>} true when the Commerce order may be placed
 */
async function runPayment(cartId) {
  const { placeholders } = controller;

  setMessage(labelFor(placeholders, 'processing'), 'info');
  setState(PAYPAL_UI_STATE.CREATING_ORDER);

  // Reuse the order from an interrupted attempt instead of creating a duplicate.
  if (!controller.paypalOrderId) {
    const { paypalOrderId } = await createPayPalOrder({
      cartId,
      checkoutAttemptId: controller.checkoutAttemptId,
    });
    controller.paypalOrderId = paypalOrderId;
  }

  const { paypalOrderId } = controller;

  // An express wallet already collected and approved the payment, so the hosted
  // card fields must not be submitted for it.
  if (!controller.approvedExternally) {
    setState(PAYPAL_UI_STATE.SUBMITTING_CARD);
    // submit() also drives any 3DS challenge, so announce authentication up front.
    setMessage(labelFor(placeholders, 'authenticating'), 'info');

    try {
      // Raw card data never leaves the PayPal-hosted fields.
      await controller.session.submit(paypalOrderId, { billingAddress: getBillingAddress() });
    } catch (error) {
      if (error?.code === 'PAYER_ACTION_CANCELED' || error?.name === 'CancelError') {
        setState(PAYPAL_UI_STATE.CANCELED);
        setMessage(labelFor(placeholders, 'canceled'));
        return false;
      }

      setState(PAYPAL_UI_STATE.FAILED);
      setMessage(error?.message || labelFor(placeholders, 'failed'));
      return false;
    }
  }

  setState(PAYPAL_UI_STATE.CAPTURING);
  setMessage(labelFor(placeholders, 'processing'), 'info');

  const captureAttemptId = createRequestId();

  try {
    const result = await capturePayPalOrder({ cartId, paypalOrderId, captureAttemptId });
    return handleCaptureResult(result);
  } catch (error) {
    // An error is not proof the capture failed — ask App Builder for the real state
    // before showing a retryable failure.
    try {
      const reconciled = await reconcilePayPalOrder({ cartId, paypalOrderId });
      return handleCaptureResult(reconciled);
    } catch (reconcileError) {
      console.error('Unable to reconcile PayPal payment', reconcileError);
      setState(PAYPAL_UI_STATE.RECONCILIATION_REQUIRED);
      setMessage(
        error instanceof PayPalApiError && !error.retryable
          ? labelFor(placeholders, 'failed')
          : labelFor(placeholders, 'reconcile'),
      );
      return false;
    }
  }
}

/**
 * Adopts a PayPal order already approved through an express wallet.
 * The next payment attempt captures that order instead of asking for a card.
 * @param {object} approval approval payload
 * @param {string} approval.paypalOrderId approved PayPal order id
 * @returns {boolean} true when the approval was adopted
 */
export function adoptExpressApproval({ paypalOrderId }) {
  if (!controller || !paypalOrderId) return false;

  controller.paypalOrderId = paypalOrderId;
  controller.approvedExternally = true;
  // The wallet already collected the payment instrument, so the card form must
  // not be offered for this attempt.
  controller.elements.grid.hidden = true;
  setState(PAYPAL_UI_STATE.READY);
  setMessage(labelFor(controller.placeholders, 'expressApproved'), 'info');

  return true;
}

/**
 * Submits the PayPal card payment for the current checkout.
 * Concurrent calls (double-click on Place Order) share a single attempt.
 * @param {object} params params
 * @param {string} params.cartId ACCS cart identifier
 * @returns {Promise<boolean>} true when the Commerce order may be placed
 */
export async function submitPayPalCardPayment({ cartId }) {
  const usable = controller
    && (controller.approvedExternally || (controller.eligible && controller.session));

  if (!usable) {
    throw new PayPalApiError('PayPal card fields are not ready.', {
      code: 'PAYPAL_NOT_READY',
    });
  }

  if (controller.inFlight) return controller.inFlight;

  controller.inFlight = runPayment(cartId).finally(() => {
    controller.inFlight = null;
  });

  return controller.inFlight;
}
