/**
 * PayPal JavaScript SDK v6 loader and thin wrapper.
 *
 * Only the browser-safe client token issued by App Builder is used here.
 * The PayPal client secret and any privileged credential must never reach this file.
 *
 * All assumptions about the PayPal v6 API surface are isolated in this module so the
 * checkout code can stay stable if PayPal adjusts naming.
 */
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import { events } from '@dropins/tools/event-bus.js';
import { getBrowserSafeClientToken } from './paypal-api.js';

export const PAYPAL_SDK_URLS = Object.freeze({
  sandbox: 'https://www.sandbox.paypal.com/web-sdk/v6/core',
  production: 'https://www.paypal.com/web-sdk/v6/core',
});

const DEFAULT_ENVIRONMENT = 'sandbox';
const DEFAULT_PAGE_TYPE = 'checkout';
const DEFAULT_COMPONENTS = ['card-fields', 'paypal-payments', 'applepay-payments'];

/** Factory name on the SDK instance for each supported express wallet. */
const EXPRESS_SESSION_FACTORIES = Object.freeze({
  paypal: 'createPayPalOneTimePaymentSession',
  apple_pay: 'createApplePayOneTimePaymentSession',
  google_pay: 'createGooglePayOneTimePaymentSession',
});

let sdkScriptPromise;
let sdkInstancePromise;
let authenticatedInstancePromise;
let eligibilityPromise;

/**
 * Resolves the configured PayPal environment. Never inferred from browser input.
 * @returns {'sandbox'|'production'}
 */
export function getPayPalEnvironment() {
  const configured = String(getConfigValue('paypal-environment') || DEFAULT_ENVIRONMENT)
    .trim()
    .toLowerCase();

  return configured === 'production' ? 'production' : DEFAULT_ENVIRONMENT;
}

/**
 * Loads the PayPal v6 core SDK script once per page.
 * @returns {Promise<object>} the global paypal namespace
 */
export function loadPayPalSdk() {
  if (sdkScriptPromise) return sdkScriptPromise;

  const src = PAYPAL_SDK_URLS[getPayPalEnvironment()];

  sdkScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);

    if (existing?.dataset.loaded === 'true') {
      resolve(window.paypal);
      return;
    }

    const script = existing ?? document.createElement('script');
    script.async = true;

    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      if (!window.paypal) {
        reject(new Error('PayPal SDK loaded but did not expose the paypal namespace.'));
        return;
      }
      resolve(window.paypal);
    });

    script.addEventListener('error', () => {
      // Allow a later attempt to retry the network request.
      sdkScriptPromise = undefined;
      reject(new Error('Failed to load the PayPal JavaScript SDK.'));
    });

    if (!existing) {
      script.src = src;
      document.head.appendChild(script);
    }
  });

  return sdkScriptPromise;
}

/**
 * Creates (and caches) a PayPal SDK instance from a browser-safe client token.
 * The token is short lived, so the instance is cached for the current page view only.
 * @param {object} options options
 * @param {string} options.clientToken browser-safe client token from App Builder
 * @param {string[]} [options.components] PayPal SDK components to load
 * @param {string} [options.pageType] PayPal page type hint
 * @returns {Promise<object>} the PayPal SDK instance
 */
export function createPayPalSdkInstance({
  clientToken,
  components = DEFAULT_COMPONENTS,
  pageType = DEFAULT_PAGE_TYPE,
}) {
  if (!clientToken) {
    return Promise.reject(new Error('A browser-safe PayPal client token is required.'));
  }

  if (sdkInstancePromise) return sdkInstancePromise;

  sdkInstancePromise = loadPayPalSdk()
    .then((paypal) => paypal.createInstance({ clientToken, components, pageType }))
    .catch((error) => {
      sdkInstancePromise = undefined;
      throw error;
    });

  return sdkInstancePromise;
}

/**
 * Drops the cached SDK instance so a fresh client token can be used.
 */
export function resetPayPalSdkInstance() {
  sdkInstancePromise = undefined;
  authenticatedInstancePromise = undefined;
  eligibilityPromise = undefined;
}

/**
 * Resolves the currency of the active cart. Used for eligibility only — the
 * authoritative amount is always derived server side by App Builder.
 * @returns {string|undefined} ISO-4217 currency code
 */
export function getActiveCurrency() {
  const cart = events.lastPayload('cart/data') ?? events.lastPayload('cart/initialized');

  return cart?.total?.includingTax?.currency
    ?? cart?.total?.excludingTax?.currency
    ?? getConfigValue('analytics.base-currency-code')
    ?? undefined;
}

/**
 * Requests a per-session browser-safe client token and builds the SDK instance.
 * Cached for the page view so every surface shares one instance.
 * @returns {Promise<object>} the PayPal SDK instance
 */
export function getPayPalSdkInstance() {
  if (!authenticatedInstancePromise) {
    authenticatedInstancePromise = getBrowserSafeClientToken()
      .then((clientToken) => createPayPalSdkInstance({ clientToken }))
      .catch((error) => {
        authenticatedInstancePromise = undefined;
        throw error;
      });
  }

  return authenticatedInstancePromise;
}

/**
 * Resolves (and caches) the PayPal eligibility result for this checkout context.
 * @returns {Promise<object>} the PayPal eligible-methods result
 */
function getEligibleMethods() {
  if (!eligibilityPromise) {
    const currencyCode = getActiveCurrency();

    eligibilityPromise = getPayPalSdkInstance()
      .then((sdk) => sdk.findEligibleMethods(currencyCode ? { currencyCode } : undefined))
      .catch((error) => {
        eligibilityPromise = undefined;
        throw error;
      });
  }

  return eligibilityPromise;
}

/**
 * Checks a single PayPal method id for eligibility.
 * Eligibility is a payment capability signal, not an application error.
 * @param {string} methodId PayPal method id, e.g. 'advanced_cards'
 * @returns {Promise<boolean>} true when the method can be offered
 */
export async function isMethodEligible(methodId) {
  const methods = await getEligibleMethods();

  try {
    return Boolean(methods?.isEligible?.(methodId));
  } catch {
    return false;
  }
}

/**
 * Checks whether advanced (Expanded Checkout) card payments are available.
 * @returns {Promise<boolean>} true when advanced cards can be rendered
 */
export function isAdvancedCardsEligible() {
  return isMethodEligible('advanced_cards');
}

/**
 * Express wallets the merchant enabled, in configured display order.
 * @returns {string[]} configured express method ids
 */
export function getConfiguredExpressMethods() {
  return String(getConfigValue('paypal-express-methods') || 'paypal')
    .split(',')
    .map((method) => method.trim())
    .filter((method) => method in EXPRESS_SESSION_FACTORIES);
}

/**
 * Intersects the merchant configuration with PayPal's eligibility result.
 * @returns {Promise<string[]>} express method ids that may be rendered
 */
export async function getEligibleExpressMethods() {
  const configured = getConfiguredExpressMethods();
  const eligibility = await Promise.all(configured.map((method) => isMethodEligible(method)));

  return configured.filter((_, index) => eligibility[index]);
}

/**
 * Whether express wallets are switched on for a given storefront surface.
 * @param {'cart'|'checkout'} surface storefront surface
 * @returns {boolean} true when express buttons should be rendered
 */
export function isExpressEnabled(surface) {
  return String(getConfigValue(`paypal-express-${surface}`)).trim() === 'true';
}

/**
 * Creates a one-time payment session for an express wallet.
 * @param {string} method one of 'paypal' | 'apple_pay' | 'google_pay'
 * @param {object} callbacks onApprove / onCancel / onError handlers
 * @returns {Promise<object>} the session, exposing start()
 */
export async function createExpressSession(method, callbacks) {
  const sdk = await getPayPalSdkInstance();
  const factory = EXPRESS_SESSION_FACTORIES[method];

  if (!factory || typeof sdk[factory] !== 'function') {
    throw new Error(`PayPal express method "${method}" is not available.`);
  }

  return sdk[factory](callbacks);
}

/**
 * Creates a one-time Card Fields payment session.
 * @param {object} sdkInstance PayPal SDK instance
 * @param {object} [callbacks] onApprove / onError / onCancel handlers
 * @returns {object} the card fields session
 */
export function createCardFieldsSession(sdkInstance, callbacks = {}) {
  if (typeof sdkInstance?.createCardFieldsOneTimePaymentSession !== 'function') {
    throw new Error('PayPal Card Fields are not available in this SDK instance.');
  }

  return sdkInstance.createCardFieldsOneTimePaymentSession(callbacks);
}

/**
 * Creates a single hosted card field and mounts it into a merchant-owned container.
 * PayPal owns the field internals; the storefront only supplies the container.
 * @param {object} session card fields session
 * @param {object} options options
 * @param {string} options.type one of 'name' | 'number' | 'expiry' | 'cvv'
 * @param {HTMLElement} options.container merchant-owned mount target
 * @param {object} [options.fieldOptions] PayPal-supported field options (style, placeholder…)
 * @returns {Promise<object>} the mounted field component
 */
export async function mountCardField(session, { type, container, fieldOptions = {} }) {
  const field = session.createCardFieldsComponent({ type, ...fieldOptions });

  // PayPal has used both `render` and `mount` for hosted field attachment; support both.
  const attach = field.render ?? field.mount;

  if (typeof attach !== 'function') {
    throw new Error(`PayPal card field "${type}" cannot be mounted.`);
  }

  await attach.call(field, container);

  return field;
}
