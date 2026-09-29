import { renderCheckoutHeader, renderPaymentMethods } from './containers.js';

export default async function decorate(block) {
  const header = document.createElement('div');
  const payments = document.createElement('div');

  block.innerHTML = '';
  block.appendChild(header);
  block.appendChild(payments);

  await renderCheckoutHeader(header, 'Checkout');
  await renderPaymentMethods(payments);
}
