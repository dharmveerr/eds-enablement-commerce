import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';

let sdkPromise;

const DEFAULT_COMPONENTS = 'buttons,card-fields';
const DEFAULT_INTENT = 'capture';
const DEFAULT_CURRENCY = 'USD';

const sdkState = {
  script: null,
  loadedAt: null,
};

function getWindow() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window;
}

function getDocument() {
  if (typeof document === 'undefined') {
    return null;
  }
  return document;
}

function getConfig(name, fallback) {
  const value = getConfigValue(name);
  return value || fallback;
}

function buildSdkUrl() {
  const clientId = getConfig('paypal-client-id', '');
  const components = getConfig('paypal-sdk-components', DEFAULT_COMPONENTS);
  const intent = getConfig('paypal-intent', DEFAULT_INTENT);
  const currency = getConfig('paypal-currency', DEFAULT_CURRENCY);

  if (!clientId) {
    throw new Error('PayPal client id is not configured.');
  }

  const params = new URLSearchParams({
    'client-id': clientId,
    components,
    intent,
    currency,
    'disable-funding': 'card',
  });

  return `https://www.paypal.com/sdk/js?${params.toString()}`;
}

function loadScript(src) {
  const doc = getDocument();
  if (!doc) {
    return Promise.reject(new Error('PayPal SDK requires a browser environment.'));
  }

  const existing = doc.querySelector(`script[src="${src}"]`);
  if (existing && existing.dataset.loaded === 'true') {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    const script = existing || doc.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';

    script.onload = () => {
      script.dataset.loaded = 'true';
      sdkState.script = script;
      sdkState.loadedAt = Date.now();
      resolve(script);
    };

    script.onerror = () => {
      reject(new Error('Failed to load PayPal JS SDK.'));
    };

    if (!existing) {
      doc.head.appendChild(script);
    }
  });
}

export async function loadPayPalSdk() {
  if (!sdkPromise) {
    sdkPromise = loadScript(buildSdkUrl());
  }
  return sdkPromise;
}

export async function ensurePayPalNamespace() {
  await loadPayPalSdk();
  const win = getWindow();
  if (!win || !win.paypal) {
    throw new Error('PayPal SDK did not expose the paypal namespace.');
  }
  return win.paypal;
}

export async function renderPayPalButtons(container, options = {}) {
  const paypal = await ensurePayPalNamespace();
  if (typeof paypal.Buttons !== 'function') {
    throw new Error('PayPal Buttons are not available.');
  }
  const buttons = paypal.Buttons(options);
  if (!buttons || typeof buttons.render !== 'function') {
    throw new Error('PayPal Buttons failed to initialize.');
  }
  await buttons.render(container);
  return buttons;
}

export async function createPayPalCardFields(options = {}) {
  const paypal = await ensurePayPalNamespace();
  if (typeof paypal.CardFields !== 'function') {
    throw new Error('PayPal Card Fields are not available.');
  }
  return paypal.CardFields(options);
}

export function getSdkState() {
  return { ...sdkState };
}
