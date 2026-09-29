/* eslint-disable max-len */
/* eslint-disable import/no-unresolved */
/* eslint-disable no-unused-vars */
/* eslint-disable no-shadow */
/* eslint-disable no-use-before-define */
/* eslint-disable prefer-const */

// Checkout Dropin
import * as checkoutApi from '@dropins/storefront-checkout/api.js';
import BillToShippingAddress from '@dropins/storefront-checkout/containers/BillToShippingAddress.js';
import EstimateShipping from '@dropins/storefront-checkout/containers/EstimateShipping.js';
import LoginForm from '@dropins/storefront-checkout/containers/LoginForm.js';
import MergedCartBanner from '@dropins/storefront-checkout/containers/MergedCartBanner.js';
import OutOfStock from '@dropins/storefront-checkout/containers/OutOfStock.js';
import PaymentMethods from '@dropins/storefront-checkout/containers/PaymentMethods.js';
import PlaceOrder from '@dropins/storefront-checkout/containers/PlaceOrder.js';
import ServerError from '@dropins/storefront-checkout/containers/ServerError.js';
import ShippingMethods from '@dropins/storefront-checkout/containers/ShippingMethods.js';
import TermsAndConditions from '@dropins/storefront-checkout/containers/TermsAndConditions.js';
import { render as CheckoutProvider } from '@dropins/storefront-checkout/render.js';

// Auth Dropin
import * as authApi from '@dropins/storefront-auth/api.js';
import AuthCombine from '@dropins/storefront-auth/containers/AuthCombine.js';
import { render as AuthProvider } from '@dropins/storefront-auth/render.js';

// Account Dropin
import Addresses from '@dropins/storefront-account/containers/Addresses.js';
import AddressForm from '@dropins/storefront-account/containers/AddressForm.js';
import { render as AccountProvider } from '@dropins/storefront-account/render.js';

// Cart Dropin
import * as cartApi from '@dropins/storefront-cart/api.js';
import CartSummaryList from '@dropins/storefront-cart/containers/CartSummaryList.js';
import Coupons from '@dropins/storefront-cart/containers/Coupons.js';
import GiftCards from '@dropins/storefront-cart/containers/GiftCards.js';
import GiftOptions from '@dropins/storefront-cart/containers/GiftOptions.js';
import OrderSummary from '@dropins/storefront-cart/containers/OrderSummary.js';
import { render as CartProvider } from '@dropins/storefront-cart/render.js';

// Payment Services Dropin
import { PaymentMethodCode } from '@dropins/storefront-payment-services/api.js';
import CreditCard from '@dropins/storefront-payment-services/containers/CreditCard.js';
import { render as PaymentServices } from '@dropins/storefront-payment-services/render.js';

// Tools
import {
  Header,
  provider as UI,
} from '@dropins/tools/components.js';
import { events } from '@dropins/tools/event-bus.js';
import { debounce } from '@dropins/tools/lib.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';

// Checkout Dropin Libs
import {
  estimateShippingCost,
  setAddressOnCart,
  getCartAddress,
  transformCartAddressToFormValues,
} from '@dropins/storefront-checkout/lib/utils.js';

import { showModal, swatchImageSlot } from './utils.js';

// External dependencies
import {
  authPrivacyPolicyConsentSlot,
  fetchPlaceholders,
  rootLink,
  renderCartItemPromotions,
} from '../../scripts/commerce.js';
import {
  createPayPalCardFields,
  ensurePayPalNamespace,
  renderPayPalButtons,
} from '../../scripts/paypal-sdk.js';

// Constants
import {
  ADDRESS_INPUT_DEBOUNCE_TIME,
  BILLING_ADDRESS_DATA_KEY,
  BILLING_FORM_NAME,
  CHECKOUT_ERROR_CLASS,
  CHECKOUT_HEADER_CLASS,
  DEBOUNCE_TIME,
  LOGIN_FORM_NAME,
  SHIPPING_ADDRESS_DATA_KEY,
  SHIPPING_FORM_NAME,
} from './constants.js';

export const CONTAINERS = Object.freeze({
  MERGED_CART_BANNER: 'mergedCartBanner',
  CHECKOUT_HEADER: 'checkoutHeader',
  SERVER_ERROR: 'serverError',
  OUT_OF_STOCK: 'outOfStock',
  LOGIN_FORM: 'loginForm',
  SHIPPING_ADDRESS_FORM_SKELETON: 'shippingAddressFormSkeleton',
  BILL_TO_SHIPPING_ADDRESS: 'billToShippingAddress',
  SHIPPING_METHODS: 'shippingMethods',
  PAYMENT_METHODS: 'paymentMethods',
  BILLING_ADDRESS_FORM_SKELETON: 'billingAddressFormSkeleton',
  ORDER_SUMMARY: 'orderSummary',
  CART_SUMMARY_LIST: 'cartSummaryList',
  TERMS_AND_CONDITIONS: 'termsAndConditions',
  PLACE_ORDER_BUTTON: 'placeOrderButton',
  GIFT_OPTIONS: 'giftOptions',
  CUSTOMER_SHIPPING_ADDRESSES: 'customerShippingAddresses',
  CUSTOMER_BILLING_ADDRESSES: 'customerBillingAddresses',
  SHIPPING_ADDRESS_FORM: 'shippingAddressForm',
  BILLING_ADDRESS_FORM: 'billingAddressForm',
  ESTIMATE_SHIPPING: 'estimateShipping',
  CART_COUPONS: 'cartCoupons',
  GIFT_CARDS: 'giftCards',
  CART_GIFT_OPTIONS: 'cartGiftOptions',
  PAYPAL_METHODS: 'paypalMethods',
});

const registry = new Map();
export const hasContainer = (id) => registry.has(id);
const renderContainer = async (id, renderFn) => {
  if (registry.has(id)) {
    return registry.get(id);
  }
  try {
    const container = await renderFn();
    registry.set(id, container);
    return container;
  } catch (error) {
    console.error(`Error rendering container ${id}:`, error);
    throw error;
  }
};
export const unmountContainer = (id) => {
  if (!registry.has(id)) return;
  const containerApi = registry.get(id);
  containerApi.remove();
  registry.delete(id);
};

export const renderMergedCartBanner = async (container) => renderContainer(CONTAINERS.MERGED_CART_BANNER, async () => CheckoutProvider.render(MergedCartBanner)(container));
export const renderCheckoutHeader = async (container, title) => renderContainer(CONTAINERS.CHECKOUT_HEADER, async () => UI.render(Header, { className: CHECKOUT_HEADER_CLASS, divider: true, level: 1, size: 'large', title })(container));
export const renderServerError = async (container, contentElement) => renderContainer(CONTAINERS.SERVER_ERROR, async () => CheckoutProvider.render(ServerError, {
  autoScroll: true,
  onRetry: (error) => {
    if (error.code === 'PERMISSION_DENIED') {
      document.location.reload();
      return;
    }
    contentElement.classList.remove(CHECKOUT_ERROR_CLASS);
  },
  onServerError: () => {
    contentElement.classList.add(CHECKOUT_ERROR_CLASS);
  },
})(container));
export const renderOutOfStock = async (container) => renderContainer(CONTAINERS.OUT_OF_STOCK, async () => CheckoutProvider.render(OutOfStock, { routeCart: () => rootLink('/cart'), onCartProductsUpdate: (items) => { cartApi.updateProductsFromCart(items).catch(console.error); } })(container));
export const renderLoginForm = async (container) => renderContainer(CONTAINERS.LOGIN_FORM, async () => CheckoutProvider.render(LoginForm, { name: LOGIN_FORM_NAME, onSignInClick: async (initialEmailValue) => { const signInForm = document.createElement('div'); AuthProvider.render(AuthCombine, { signInFormConfig: { renderSignUpLink: true, initialEmailValue }, signUpFormConfig: { slots: { ...authPrivacyPolicyConsentSlot } }, resetPasswordFormConfig: {} })(signInForm); await showModal(signInForm); }, onSignOutClick: () => { authApi.revokeCustomerToken(); } })(container));
export const renderShippingAddressFormSkeleton = async (container) => renderContainer(CONTAINERS.SHIPPING_ADDRESS_FORM_SKELETON, async () => AccountProvider.render(AddressForm, { fieldIdPrefix: 'shipping', isOpen: true, showFormLoader: true })(container));
export const renderBillingAddressFormSkeleton = async (container) => renderContainer(CONTAINERS.BILLING_ADDRESS_FORM_SKELETON, async () => AccountProvider.render(AddressForm, { fieldIdPrefix: 'billing', isOpen: true, showFormLoader: true })(container));

export const renderPaymentMethods = async (container) => renderContainer(CONTAINERS.PAYMENT_METHODS, async () => {
  const wrapper = document.createElement('div');
  wrapper.className = 'checkout-payment-methods';

  const checkoutPlaceholders = await fetchPlaceholders('placeholders/checkout.json');
  const paypalSection = document.createElement('section');
  paypalSection.className = 'checkout-payment-methods__paypal';

  const paypalHeading = document.createElement('h3');
  paypalHeading.textContent = checkoutPlaceholders?.Checkout?.PayPal?.heading || 'PayPal';
  paypalSection.appendChild(paypalHeading);

  const expressLabel = document.createElement('div');
  expressLabel.className = 'checkout-payment-methods__label';
  expressLabel.textContent = checkoutPlaceholders?.Checkout?.PayPal?.expressLabel || 'Checkout with PayPal';
  paypalSection.appendChild(expressLabel);

  const buttonsMount = document.createElement('div');
  buttonsMount.className = 'checkout-payment-methods__paypal-buttons';
  paypalSection.appendChild(buttonsMount);

  const cardFieldsMount = document.createElement('div');
  cardFieldsMount.className = 'checkout-payment-methods__paypal-card-fields';
  paypalSection.appendChild(cardFieldsMount);

  wrapper.appendChild(paypalSection);

  const paypal = await ensurePayPalNamespace();
  const cardFields = await createPayPalCardFields({ createOrder: async () => 'paypal-order-placeholder' });

  if (paypal?.Buttons) {
    await renderPayPalButtons(buttonsMount, {
      style: { layout: 'vertical', shape: 'rect' },
      createOrder: async () => 'paypal-order-placeholder',
    });
  }

  if (cardFields?.createCardFieldsComponent) {
    const title = document.createElement('h4');
    title.textContent = checkoutPlaceholders?.Checkout?.PayPal?.ccLabel || 'Debit or Credit Card';
    cardFieldsMount.appendChild(title);

    const cardForm = document.createElement('div');
    cardFieldsMount.appendChild(cardForm);

    const nameField = cardFields.createCardFieldsComponent({ type: 'name', name: 'cardholder-name' });
    const numberField = cardFields.createCardFieldsComponent({ type: 'number' });
    const expiryField = cardFields.createCardFieldsComponent({ type: 'expiry' });
    const cvvField = cardFields.createCardFieldsComponent({ type: 'cvv' });

    [nameField, numberField, expiryField, cvvField].forEach((field) => {
      if (field?.render) {
        field.render(cardForm);
      }
    });
  } else {
    const fallback = document.createElement('p');
    fallback.textContent = checkoutPlaceholders?.Checkout?.PayPal?.eligibilityFallback || 'Card payments are temporarily unavailable.';
    cardFieldsMount.appendChild(fallback);
  }

  container.appendChild(wrapper);
  return { remove: () => wrapper.remove() };
});

export const renderPlaceOrder = async (container, { handleValidation, handlePlaceOrder }) => renderContainer(CONTAINERS.PLACE_ORDER_BUTTON, async () => CheckoutProvider.render(PlaceOrder, { handleValidation, handlePlaceOrder })(container));
export const renderShippingMethods = async (container) => renderContainer(CONTAINERS.SHIPPING_METHODS, async () => CheckoutProvider.render(ShippingMethods)(container));
export const renderBillToShippingAddress = async (container) => renderContainer(CONTAINERS.BILL_TO_SHIPPING_ADDRESS, async () => CheckoutProvider.render(BillToShippingAddress)(container));
export const renderOrderSummary = async (container) => renderContainer(CONTAINERS.ORDER_SUMMARY, async () => CheckoutProvider.render(OrderSummary)(container));
export const renderCartSummaryList = async (container) => renderContainer(CONTAINERS.CART_SUMMARY_LIST, async () => CartProvider.render(CartSummaryList)(container));
export const renderGiftOptions = async (container) => renderContainer(CONTAINERS.GIFT_OPTIONS, async () => CartProvider.render(GiftOptions)(container));
export const renderTermsAndConditions = async (container) => renderContainer(CONTAINERS.TERMS_AND_CONDITIONS, async () => CheckoutProvider.render(TermsAndConditions, { slots: { Agreements: (ctx) => { ctx.appendAgreement(() => ({ name: 'default', mode: 'manual', translationId: 'Checkout.TermsAndConditions.label' })); } } })(container));
export const renderCustomerShippingAddresses = async (container, formRef, data) => renderContainer(CONTAINERS.CUSTOMER_SHIPPING_ADDRESSES, async () => {
  const placeholders = await fetchPlaceholders('placeholders/checkout.json');
  const cartShippingAddress = getCartAddress(data, 'shipping');
  const shippingAddressId = cartShippingAddress ? cartShippingAddress?.id ?? 0 : undefined;
  const shippingAddressCache = sessionStorage.getItem(SHIPPING_ADDRESS_DATA_KEY);
  if (cartShippingAddress && shippingAddressCache) sessionStorage.removeItem(SHIPPING_ADDRESS_DATA_KEY);
  const storeConfig = checkoutApi.getStoreConfigCache();
  const inputsDefaultValueSet = cartShippingAddress && cartShippingAddress.id === undefined ? transformCartAddressToFormValues(cartShippingAddress) : { countryCode: storeConfig.defaultCountry };
  const hasCartShippingAddress = Boolean(data.shippingAddresses?.[0]);
  let isFirstRenderShipping = true;
  const setShippingAddressOnCart = setAddressOnCart({ type: 'shipping', debounceMs: DEBOUNCE_TIME });
  const estimateShippingCostOnCart = estimateShippingCost({ debounceMs: DEBOUNCE_TIME });
  const notifyShippingValues = debounce((values) => { events.emit('checkout/addresses/shipping', values); }, ADDRESS_INPUT_DEBOUNCE_TIME);
  return AccountProvider.render(Addresses, {
    addressFormTitle: placeholders?.Checkout?.Addresses?.shippingAddressTitle,
    defaultSelectAddressId: shippingAddressId,
    fieldIdPrefix: 'shipping',
    formName: SHIPPING_FORM_NAME,
    forwardFormRef: formRef,
    inputsDefaultValueSet,
    minifiedView: false,
    onAddressData: (values) => {
      const canSetShippingAddressOnCart = !isFirstRenderShipping || !hasCartShippingAddress;
      if (canSetShippingAddressOnCart) setShippingAddressOnCart(values);
      if (!hasCartShippingAddress) estimateShippingCostOnCart(values);
      if (isFirstRenderShipping) isFirstRenderShipping = false;
      notifyShippingValues(values);
    },
    selectable: true,
    selectShipping: true,
    showBillingCheckBox: false,
    showSaveCheckBox: true,
    showShippingCheckBox: false,
    title: placeholders?.Checkout?.Addresses?.shippingAddressTitle,
  })(container);
});
export const renderCustomerBillingAddresses = async (container, formRef, data) => renderContainer(CONTAINERS.CUSTOMER_BILLING_ADDRESSES, async () => {
  const placeholders = await fetchPlaceholders('placeholders/checkout.json');
  const cartBillingAddress = getCartAddress(data, 'billing');
  const billingAddressId = cartBillingAddress ? cartBillingAddress?.id ?? 0 : undefined;
  const billingAddressCache = sessionStorage.getItem(BILLING_ADDRESS_DATA_KEY);
  if (cartBillingAddress && billingAddressCache) sessionStorage.removeItem(BILLING_ADDRESS_DATA_KEY);
  const storeConfig = checkoutApi.getStoreConfigCache();
  const inputsDefaultValueSet = cartBillingAddress && cartBillingAddress.id === undefined ? transformCartAddressToFormValues(cartBillingAddress) : { countryCode: storeConfig.defaultCountry };
  return AccountProvider.render(Addresses, {
    addressFormTitle: placeholders?.Checkout?.Addresses?.billingAddressTitle,
    defaultSelectAddressId: billingAddressId,
    fieldIdPrefix: 'billing',
    formName: BILLING_FORM_NAME,
    forwardFormRef: formRef,
    inputsDefaultValueSet,
    minifiedView: false,
    selectable: true,
    selectBilling: true,
    showBillingCheckBox: false,
    showSaveCheckBox: true,
    showShippingCheckBox: false,
    title: placeholders?.Checkout?.Addresses?.billingAddressTitle,
  })(container);
});
