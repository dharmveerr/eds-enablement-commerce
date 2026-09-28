import { initializers } from '@dropins/tools/initializer.js';
import { getConfigValue, getHeaders } from '@dropins/tools/lib/aem/configs.js';
import { initializeDropin } from './index.js';
import { loadPayPalSdk } from '../paypal-sdk.js';

await initializeDropin(async () => {
  const headers = getHeaders('paypal');
  await loadPayPalSdk();

  return initializers.mountImmediately(async () => ({
    paypal: {
      clientId: getConfigValue('paypal-client-id'),
      components: getConfigValue('paypal-sdk-components') || 'buttons,card-fields',
      currency: getConfigValue('paypal-currency') || 'USD',
      intent: getConfigValue('paypal-intent') || 'capture',
      storeViewCode: headers.Store,
    },
  }), {});
})();
