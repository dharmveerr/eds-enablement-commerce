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
import { createPayPalCardFields, renderPayPalButtons } from '../../scripts/paypal-sdk.js';

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

/**
 * Container IDs for registry management
 * @enum {string}
 */
export const CONTAINERS = Object.freeze({
  // Static containers (rendered in Promise.all)
  MERGED_CART_BANNER: 'mergedCartBanner',
  CHECKOUT_HEADER: 'checkoutHeader',
  SERVER_ERROR: 'serverError',
  OUT_OF_STOCK: 'outOfStock',
  LOGIN_FORM: 'loginForm',
  SHIPPING_ADDRESS_FORM_SKELETON: 'shippingAddressFormSkeleton',
  BILL_TO_SHIPPING_ADDRESS: 'billToShippingAddress',
  SHIPPING_METHODS: '