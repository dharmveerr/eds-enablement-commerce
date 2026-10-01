/**
 * Shared PayPal express wallet buttons (PayPal, Apple Pay) for cart and checkout.
 *
 * The buttons only obtain a buyer-approved PayPal order. Capture, Commerce
 * synchronization and order placement always happen on the checkout page through
 * the PayPal payment method, so there is a single place where money moves.
 */
import { events } from '@dropins/tools/event-bus.js';
import { createPayPalOrder, createRequestId, isPayPalConfigured } from './paypal-api.js';
import {
  createExpressSession,
  getEligibleExpressMethods,
  isExpressEnabled,
} from './paypal-sdk.js';

/** sessionStorage key carrying an approved PayPal order between pages. */
export const PAYPAL_EXPRESS_APPROVAL_KEY = 'paypal-express-approval';

const METHOD_LABELS = {
  paypal: 'PayPal',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
};

const DEFAULT_LABELS = {
  canceled: 'Payment canceled. You can try again.',
  failed: 'We could not start the payment. Please try again.',
  redirecting: 'Payment approved. Taking you to checkout…',
};

/**
 * Stores an approved express order for the checkout page to pick up.
 * @param {object} approval {paypalOrderId, method, source}
 */
export function storeExpressApproval(approval) {
  try {
    sessionStorage.setItem(PAYPAL_EXPRESS_APPROVAL_KEY, JSON.stringify(approval));
  } catch (error) {
    console.error('Unable to persist the PayPal express approval', error);
  }
}

/**
 * Reads and clears a stored express approval.
 * @returns {object|null} the approval, or null when there is none
 */
export function consumeExpressApproval() {
  try {
    const raw = sessionStorage.getItem(PAYPAL_EXPRESS_APPROVAL_KEY);
    sessionStorage.removeItem(PAYPAL_EXPRESS_APPROVAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('Unable to read the PayPal express approval', error);
    return null;
  }
}

/**
 * Resolves the active cart id from the cart drop-in cache.
 * @returns {string|undefined} cart id
 */
function getCartId() {
  const cart = events.lastPayload('cart/data') ?? events.lastPayload('cart/initialized');
  return cart?.id;
}

/**
 * Renders the eligible express wallet buttons into a merchant-owned container.
 * The container is removed when PayPal is not configured, the surface is off, or
 * no wallet is eligible, so callers can mount it unconditionally.
 *
 * @param {HTMLElement} container mount point
 * @param {object} options options
 * @param {'cart'|'checkout'} options.source surface requesting the buttons
 * @param {object} [options.labels] resolved placeholder labels
 * @param {(approval: object) => Promise<void>} options.onApprove buyer-approval handler
 * @returns {Promise<void>} resolves when rendering settles
 */
export default async function renderExpressButtons(container, { source, labels, onApprove }) {
  const labelFor = (key) => labels?.[key] ?? DEFAULT_LABELS[key];

  if (!isPayPalConfigured() || !isExpressEnabled(source)) {
    container.remove();
    return;
  }

  container.classList.add('paypal-express');
  container.setAttribute('aria-busy', 'true');

  let methods = [];

  try {
    methods = await getEligibleExpressMethods();
  } catch (error) {
    // Eligibility or SDK failures must never break the page.
    console.error('Unable to resolve PayPal express eligibility', error);
  } finally {
    container.removeAttribute('aria-busy');
  }

  if (!methods.length) {
    container.remove();
    return;
  }

  const $status = document.createElement('p');
  $status.className = 'paypal-express__status';
  $status.setAttribute('role', 'status');
  $status.setAttribute('aria-live', 'polite');

  const buttons = [];
  let inFlight = false;
  const checkoutAttemptId = createRequestId();

  const setDisabled = (disabled) => {
    buttons.forEach((button) => { button.disabled = disabled; });
  };

  const handleClick = async (method) => {
    if (inFlight) return;
    inFlight = true;
    $status.textContent = '';
    setDisabled(true);

    try {
      const cartId = getCartId();

      const session = await createExpressSession(method, {
        onApprove: async (data) => {
          const approval = {
            paypalOrderId: data?.orderId ?? data?.orderID,
            method,
            source,
          };

          events.emit('paypal/express/approved', approval);
          await onApprove(approval);
        },
        onCancel: () => {
          $status.textContent = labelFor('canceled');
          events.emit('paypal/express/canceled', { method, source });
        },
        onError: (error) => {
          console.error('PayPal express session failed', error);
          $status.textContent = labelFor('failed');
          events.emit('paypal/express/failed', { method, source });
        },
      });

      // The order promise is passed unresolved so the wallet opens inside the
      // user gesture; awaiting it first would trip Safari's popup blocker.
      await session.start(
        { presentationMode: 'auto' },
        createPayPalOrder({ cartId, checkoutAttemptId }).then((order) => order.paypalOrderId),
      );
    } catch (error) {
      console.error('Unable to start the PayPal express payment', error);
      $status.textContent = labelFor('failed');
    } finally {
      inFlight = false;
      setDisabled(false);
    }
  };

  methods.forEach((method) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `paypal-express__button paypal-express__button--${method}`;
    button.dataset.method = method;
    button.setAttribute('aria-label', `Check out with ${METHOD_LABELS[method]}`);
    button.textContent = METHOD_LABELS[method];
    button.addEventListener('click', () => handleClick(method));

    buttons.push(button);
    container.appendChild(button);
  });

  container.appendChild($status);
  events.emit('paypal/express/rendered', { source, methods });
}
