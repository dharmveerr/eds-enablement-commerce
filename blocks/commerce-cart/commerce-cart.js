import { events } from '@dropins/tools/event-bus.js';
import { render as provider } from '@dropins/storefront-cart/render.js';
import * as Cart from '@dropins/storefront-cart/api.js';
import { h } from '@dropins/tools/preact.js';
import {
  InLineAlert,
  Icon,
  Button,
  provider as UI,
} from '@dropins/tools/components.js';

// Dropin Containers
import CartSummaryList from '@dropins/storefront-cart/containers/CartSummaryList.js';
import OrderSummary from '@dropins/storefront-cart/containers/OrderSummary.js';
import EstimateShipping from '@dropins/storefront-cart/containers/EstimateShipping.js';
import Coupons from '@dropins/storefront-cart/containers/Coupons.js';
import GiftCards from '@dropins/storefront-cart/containers/GiftCards.js';
import GiftOptions from '@dropins/storefront-cart/containers/GiftOptions.js';
import { render as wishlistRender } from '@dropins/storefront-wishlist/render.js';
import { WishlistToggle } from '@dropins/storefront-wishlist/containers/WishlistToggle.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';

// API
import { publishShoppingCartViewEvent } from '@dropins/storefront-cart/api.js';

// Modal and Mini PDP
import createMiniPDP from '../../scripts/components/commerce-mini-pdp/commerce-mini-pdp.js';
import createModal from '../modal/modal.js';

// Initializers
import '../../scripts/initializers/cart.js';
import '../../scripts/initializers/wishlist.js';
import '../../scripts/initializers/paypal.js';

import { readBlockConfig } from '../../scripts/aem.js';
import {
  fetchPlaceholders,
  rootLink,
  getProductLink,
  renderCartItemPromotions,
} from '../../scripts/commerce.js';
import { createMockPayPalOrderResponse, captureOrder, createOrder } from '../../scripts/paypal-api.js';
import { renderPayPalButtons } from '../../scripts/paypal-sdk.js';

export default async function decorate(block) {
  const {
    'hide-heading': hideHeading = 'false',
    'max-items': maxItems,
    'hide-attributes': hideAttributes = '',
    'enable-item-quantity-update': enableUpdateItemQuantity = 'false',
    'enable-item-remove': enableRemoveItem = 'true',
    'enable-estimate-shipping': enableEstimateShipping = 'false',
    'start-shopping-url': startShoppingURL = '',
    'checkout-url': checkoutURL = '',
    'enable-updating-product': enableUpdatingProduct = 'false',
    'undo-remove-item': undo = 'false',
  } = readBlockConfig(block);

  const placeholders = await fetchPlaceholders();
  const _cart = Cart.getCartDataFromCache();
  let currentModal = null;
  let currentNotification = null;

  const fragment = document.createRange().createContextualFragment(`
    <div class="cart__notification"></div>
    <div class="cart__wrapper">
      <div class="cart__left-column">
        <div class="cart__list"></div>
      </div>
      <div class="cart__right-column">
        <div class="cart__order-summary"></div>
        <div class="cart__express-checkout"></div>
        <div class="cart__gift-options"></div>
      </div>
    </div>

    <div class="cart__empty-cart"></div>
  `);

  const $wrapper = fragment.querySelector('.cart__wrapper');
  const $notification = fragment.querySelector('.cart__notification');
  const $list = fragment.querySelector('.cart__list');
  const $summary = fragment.querySelector('.cart__order-summary');
  const $emptyCart = fragment.querySelector('.cart__empty-cart');
  const $giftOptions = fragment.querySelector('.cart__gift-options');
  const $expressCheckout = fragment.querySelector('.cart__express-checkout');

  block.innerHTML = '';
  block.appendChild(fragment);

  const routeToWishlist = rootLink('/wishlist');

  function toggleEmptyCart(_state) {
    $wrapper.removeAttribute('hidden');
    $emptyCart.setAttribute('hidden', '');
  }

  async function handleEditButtonClick(cartItem) {
    try {
      const miniPDPContent = await createMiniPDP(
        cartItem,
        async (_updateData) => {
          const productName = cartItem.name || cartItem.product?.name || placeholders?.Global?.CartUpdatedProductName;
          const message = placeholders?.Global?.CartUpdatedProductMessage?.replace('{product}', productName);

          currentNotification?.remove();
          currentNotification = await UI.render(InLineAlert, {
            heading: message,
            type: 'success',
            variant: 'primary',
            icon: h(Icon, { source: 'CheckWithCircle' }),
            'aria-live': 'assertive',
            role: 'alert',
            onDismiss: () => {
              currentNotification?.remove();
            },
          })($notification);

          setTimeout(() => {
            currentNotification?.remove();
          }, 5000);
        },
        () => {
          if (currentModal) {
            currentModal.removeModal();
            currentModal = null;
          }
        },
      );

      currentModal = await createModal([miniPDPContent]);
      if (currentModal.block) {
        currentModal.block.setAttribute('id', 'mini-pdp-modal');
      }
      currentModal.showModal();
    } catch (error) {
      console.error('Error opening mini PDP modal:', error);
      currentNotification?.remove();
      currentNotification = await UI.render(InLineAlert, {
        heading: placeholders?.Global?.ProductLoadError,
        type: 'error',
        variant: 'primary',
        icon: h(Icon, { source: 'AlertWithCircle' }),
        'aria-live': 'assertive',
        role: 'alert',
        onDismiss: () => {
          currentNotification?.remove();
        },
      })($notification);
    }
  }

  const renderExpressCheckout = async () => {
    if (!$expressCheckout) return;
    $expressCheckout.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = placeholders?.Cart?.ExpressCheckout?.heading || 'Express checkout';
    $expressCheckout.appendChild(heading);

    const buttonWrap = document.createElement('div');
    buttonWrap.className = 'cart__paypal-buttons';
    $expressCheckout.appendChild(buttonWrap);

    const alert = document.createElement('div');
    alert.className = 'cart__paypal-alert';
    $expressCheckout.appendChild(alert);

    try {
      await renderPayPalButtons(buttonWrap, {
        style: { layout: 'vertical', shape: 'rect' },
        createOrder: async () => {
          const response = await createOrder({ source: 'cart' });
          return response.paypalOrderId || createMockPayPalOrderResponse().id;
        },
        onApprove: async (data) => {
          await captureOrder({ paypalOrderId: data.orderID, source: 'cart' });
        },
        onError: (error) => {
          alert.textContent = error?.message || placeholders?.Cart?.ExpressCheckout?.error || 'PayPal checkout is temporarily unavailable. Please try again.';
        },
      });
    } catch (error) {
      alert.textContent = placeholders?.Cart?.ExpressCheckout?.error || 'PayPal checkout is temporarily unavailable. Please try again.';
      console.error('Unable to render cart PayPal checkout', error);
    }
  };

  const createProductLink = (product) => getProductLink(product.url.urlKey, product.topLevelSku);
  await Promise.all([
    provider.render(CartSummaryList, {
      hideHeading: hideHeading === 'true',
      routeProduct: createProductLink,
      routeEmptyCartCTA: startShoppingURL ? () => rootLink(startShoppingURL) : undefined,
      maxItems: parseInt(maxItems, 10) || undefined,
      attributesToHide: hideAttributes.split(',').map((attr) => attr.trim().toLowerCase()),
      enableUpdateItemQuantity: enableUpdateItemQuantity === 'true',
      enableRemoveItem: enableRemoveItem === 'true',
      undo: undo === 'true',
      slots: {
        Thumbnail: (ctx) => {
          const { item, defaultImageProps } = ctx;
          const anchorWrapper = document.createElement('a');
          anchorWrapper.href = createProductLink(item);
          tryRenderAemAssetsImage(ctx, { alias: item.sku, imageProps: defaultImageProps, wrapper: anchorWrapper, params: { width: defaultImageProps.width, height: defaultImageProps.height } });
        },
        Footer: (ctx) => {
          renderCartItemPromotions(ctx);
          if (ctx.item?.itemType === 'ConfigurableCartItem' && enableUpdatingProduct === 'true') {
            const editLink = document.createElement('div');
            editLink.className = 'cart-item-edit-link';
            UI.render(Button, {
              children: placeholders?.Global?.CartEditButton,
              'aria-label': `${placeholders?.Global?.CartEditButton} ${ctx.item.name}`,
              variant: 'tertiary',
              size: 'medium',
              icon: h(Icon, { source: 'Edit' }),
              onClick: () => handleEditButtonClick(ctx.item),
            })(editLink);
            ctx.appendChild(editLink);
          }
          const $wishlistToggle = document.createElement('div');
          $wishlistToggle.classList.add('cart__action--wishlist-toggle');
          wishlistRender.render(WishlistToggle, {
            product: ctx.item,
            size: 'medium',
            labelToWishlist: placeholders?.Global?.CartMoveToWishlist,
            labelWishlisted: placeholders?.Global?.CartRemoveFromWishlist,
            removeProdFromCart: Cart.updateProductsFromCart,
          })($wishlistToggle);
          ctx.appendChild($wishlistToggle);
          const giftOptions = document.createElement('div');
          provider.render(GiftOptions, {
            item: ctx.item,
            view: 'product',
            dataSource: 'cart',
            handleItemsLoading: ctx.handleItemsLoading,
            handleItemsError: ctx.handleItemsError,
            onItemUpdate: ctx.onItemUpdate,
            slots: { SwatchImage: { } },
          })(giftOptions);
          ctx.appendChild(giftOptions);
        },
      },
    })($list),
    provider.render(OrderSummary, {
      routeCheckout: checkoutURL ? () => rootLink(checkoutURL) : undefined,
      slots: {
        EstimateShipping: async (ctx) => {
          if (enableEstimateShipping === 'true') {
            const wrapper = document.createElement('div');
            await provider.render(EstimateShipping, {})(wrapper);
            ctx.replaceWith(wrapper);
          }
        },
        Coupons: (ctx) => {
          const coupons = document.createElement('div');
          provider.render(Coupons)(coupons);
          ctx.appendChild(coupons);
        },
        GiftCards: (ctx) => {
          const giftCards = document.createElement('div');
          provider.render(GiftCards)(giftCards);
          ctx.appendChild(giftCards);
        },
      },
    })($summary),
    provider.render(GiftOptions, { view: 'order', dataSource: 'cart', slots: { SwatchImage: { } } })($giftOptions),
    renderExpressCheckout(),
  ]);

  events.on('cart/initialized', toggleEmptyCart);
  await publishShoppingCartViewEvent();
}
