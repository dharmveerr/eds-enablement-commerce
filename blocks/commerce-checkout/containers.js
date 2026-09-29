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
export const renderCheckoutHeader = async (container, title) => renderContainer(CONTAINERS.CHECKOUT_HEADER, async () => UI.render(Header, { className: CHECKOUT_HEADER_CLASS, divider: true, level: 1, size: