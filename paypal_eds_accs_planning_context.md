# PayPal Card Fields Planning Context for Adobe EDS + Adobe Commerce as a Cloud Service

## Purpose

This document is a self-contained planning context for an implementation/planning agent that has **no access to external third-party URLs**.

The agent must use the PayPal technical facts in this file as the source context for planning. Do not assume the agent can browse PayPal documentation, npm, GitHub, or other third-party sites.

Target architecture:

- Adobe Edge Delivery Services (EDS) storefront.
- Adobe Commerce as a Cloud Service (ACCS / SaaS) backend.
- Adobe App Builder / I/O Runtime for server-side custom payment orchestration.
- PayPal as payment processor.
- Buyer can pay with credit/debit card.
- Card number, expiry, and CVV must be rendered through **PayPal-hosted Card Fields** rather than normal merchant-owned HTML inputs.
- This is a **new** integration; do not design around legacy PayPal v5 Hosted Fields.

---

# 1. PayPal product terminology

Use these terms consistently in architecture and implementation plans:

- **PayPal Expanded Checkout / Advanced Checkout**: PayPal's experience for customized credit/debit card payments.
- **Card Fields**: the current PayPal-hosted card-input component.
- **JavaScript SDK v6**: the current PayPal browser SDK to use for new integrations.
- **Orders REST API / Orders v2**: server-side create/update/retrieve/authorize/capture APIs used by the payment flow.
- **3D Secure (3DS)**: customer authentication that can be required by the create-order configuration / regional rules.

Do **not** use the legacy product name/implementation pattern "HostedFields" for a new integration. PayPal's current documentation distinguishes the recommended `CardFields` component from the legacy `HostedFields` component.

---

# 2. Why Card Fields is the correct fit

The requirement is not simply "show a PayPal button". The checkout must allow the buyer to enter card details directly in the merchant checkout while keeping the sensitive card entry in PayPal-controlled hosted fields.

PayPal's current Card Fields model provides exactly this pattern:

1. The merchant page creates containers for card fields.
2. PayPal's JavaScript SDK renders the card fields into those containers.
3. The buyer enters card details into the PayPal-hosted fields.
4. The merchant application submits the Card Fields session against a PayPal order ID.
5. The PayPal service processes the card data and payment flow.

The merchant storefront should never build ordinary `<input>` elements for PAN/CVV and should not send raw card data to Adobe App Builder or ACCS.

The practical result is:

```text
EDS checkout DOM
  |
  +-- #card-number-container  <-- PayPal Card Fields
  +-- #card-expiry-container  <-- PayPal Card Fields
  +-- #card-cvv-container     <-- PayPal Card Fields
  |
  +-- merchant-owned billing/address inputs where needed
```

The merchant owns the **containers and surrounding layout**. PayPal owns the actual sensitive card-entry fields.

---

# 3. Current PayPal SDK choice

## Use JavaScript SDK v6 for new implementations

PayPal's current documentation states that new integrations should use **JavaScript SDK v6**.

Legacy v5 Card Fields/Hosted Fields documentation remains useful for existing systems, but it should not be the foundation for this new integration.

The relevant v6 conceptual flow is:

```text
Load PayPal JS SDK v6 core
        |
        v
Create SDK instance using browser-safe client token
        |
        v
Find eligible payment methods
        |
        v
Create Card Fields one-time payment session
        |
        v
Create / mount number, expiry, CVV fields
        |
        v
Create PayPal order on backend
        |
        v
Submit Card Fields session with orderId
        |
        v
Handle success / failure / cancellation / 3DS
        |
        v
Capture PayPal order on backend
```

---

# 4. PayPal SDK v6 loading and initialization

Production PayPal v6 core SDK endpoint:

```text
https://www.paypal.com/web-sdk/v6/core
```

Sandbox equivalent:

```text
https://www.sandbox.paypal.com/web-sdk/v6/core
```

The browser should load the SDK from PayPal rather than copying the SDK into the storefront bundle.

The v6 Card Fields flow uses a **browser-safe client token** to initialize the PayPal SDK instance.

The client secret must remain server-side.

Conceptually:

```javascript
const sdk = await window.paypal.createInstance({
  clientToken,
  components: ["card-fields"],
  pageType: "checkout"
});
```

Important planning constraint:

- Browser receives only the browser-safe token.
- PayPal client secret remains in App Builder/server-side configuration.
- Never expose the PayPal secret in EDS JavaScript, browser configuration, page source, or client logs.

---

# 5. Card Fields eligibility

The integration must check whether advanced card payments are eligible before rendering the card fields.

Conceptual v6 pattern:

```javascript
const methods = await sdk.findEligibleMethods();

if (methods.isEligible("advanced_cards")) {
  // create and render Card Fields
}
```

Planning requirements:

- The UI must not assume that Card Fields are always eligible.
- If they are not eligible, use the agreed fallback behavior for the project.
- Eligibility failure is a payment capability condition, not necessarily a checkout application error.

---

# 6. Creating the Card Fields session

The v6 API uses a one-time payment session for Card Fields.

Conceptual API:

```javascript
const cardSession = sdk.createCardFieldsOneTimePaymentSession();
```

The session is then used to create individual card field components.

Conceptual examples:

```javascript
const numberField = cardSession.createCardFieldsComponent({
  type: "number"
});

const expiryField = cardSession.createCardFieldsComponent({
  type: "expiry"
});

const cvvField = cardSession.createCardFieldsComponent({
  type: "cvv"
});
```

Mount them into merchant-owned containers:

```text
#card-number-container
#card-expiry-container
#card-cvv-container
```

The planning agent should keep the exact final method signatures aligned with the PayPal SDK v6 implementation API, but the architectural responsibility is fixed: **PayPal creates and owns the sensitive card-entry components; EDS only supplies containers and checkout orchestration.**

---

# 7. Card fields that should be planned for

The current Card Fields documentation explicitly covers:

- Card number
- CVV / security code
- Expiration date

PayPal also documents a cardholder-name field in the Card Fields integration examples.

Billing address can be collected using merchant-owned fields and supplied to the payment submission/order flow as appropriate.

A planning agent should therefore model the UI as:

```text
Sensitive / PayPal-hosted
--------------------------------
Card number
Expiration date
CVV / security code

Potentially PayPal Card Fields cardholder name, depending on selected implementation

Merchant-owned / application-owned
----------------------------------
Billing address
Postal code
Country
Other checkout data required by Commerce / tax / shipping
```

Do not treat billing address fields as PAN/CVV fields. The application may own those fields if the selected PayPal API flow requires it.

---

# 8. Styling and field layout

PayPal's Card Fields documentation supports customization of the field presentation.

Planning should allow for:

- Parent field styling.
- Font size and related field presentation.
- Cardholder-name styling where used.
- Invalid/validation state styling.
- Width/height and outer container styling.
- Integration-specific layout matching the EDS checkout design.

Important distinction:

```text
Merchant CSS
  -> styles the surrounding containers/layout

PayPal Card Fields configuration
  -> styles the PayPal field components within supported options
```

The implementation must not assume that arbitrary CSS can reach into a PayPal-owned iframe/document.

If the requirement is "exactly the same visual appearance as a normal EDS text input," verify it against PayPal's supported Card Fields styling configuration rather than assuming CSS can override the hosted field internals.

---

# 9. Card Fields submit flow

The current PayPal flow is centered around submitting the Card Fields session against a PayPal order ID.

Conceptual flow:

```javascript
const orderId = await merchantBackendCreatePayPalOrder();

const result = await cardSession.submit(orderId, {
  // supported billing / checkout data as required
});
```

Important behavior documented by PayPal:

- Values passed through the supported `submit` data flow are sent to the PayPal-hosted field/checkout flow.
- Do not serialize raw card numbers or CVV into the merchant application's request payload.
- Treat the Card Fields session as the boundary for sensitive card data.

The browser therefore sends the **order ID and supported checkout metadata**, not raw PAN/CVV, to the Card Fields submission operation.

---

# 10. Backend route pattern from PayPal Card Fields documentation

The current PayPal Card Fields guide describes a three-route style backend pattern:

```text
GET  /paypal-api/auth/browser-safe-client-token
POST /paypal-api/checkout/orders/create-with-sample-data
POST /paypal-api/checkout/orders/{orderId}/capture
```

For the Adobe solution, the routes should be implemented as App Builder actions/endpoints rather than copying the sample URL names literally.

Recommended logical App Builder actions:

```text
paypal/browser-safe-client-token
paypal/create-order
paypal/capture-order
```

Optional supporting action:

```text
paypal/validate-order
```

The exact public URL shape can follow the Adobe App Builder deployment model.

---

# 11. Browser-safe client token

PayPal v6 Card Fields requires a browser-safe client token.

Planning requirements:

1. EDS requests the token from App Builder.
2. App Builder authenticates server-side to PayPal as required.
3. App Builder returns only the browser-safe token.
4. EDS initializes the v6 SDK with that token.

Never return:

- PayPal client secret
- long-lived server credential
- raw OAuth access token unless PayPal's documented browser use explicitly requires it
- any server credential used to authorize backend Orders API calls

---

# 12. Create PayPal order

The browser should not be the authoritative source of the payment total.

Recommended ACCS/EDS flow:

```text
EDS
  |
  | cart identifier / checkout state
  v
App Builder create-order
  |
  +--> read/validate ACCS cart
  +--> validate currency
  +--> validate line items
  +--> validate shipping
  +--> validate tax
  +--> validate final total
  |
  +--> create PayPal Orders v2 order
  |
  v
return PayPal orderId
```

The PayPal order must be derived from authoritative commerce data.

Do not trust a browser-provided:

- price
- tax
- shipping charge
- discount
- grand total
- line-item price

without server-side validation against Commerce.

---

# 13. Orders v2 endpoints

Primary PayPal server-side endpoints:

```text
POST /v2/checkout/orders
POST /v2/checkout/orders/{ORDER-ID}/capture
```

Orders v2 supports operations including creating, updating/retrieving, authorizing, and capturing orders.

For an immediate-payment checkout, the typical intent is `CAPTURE`.

If the ACCS order lifecycle requires authorization first and capture later, an `AUTHORIZE` pattern may be selected, but it must be designed explicitly.

---

# 14. Create-order response

The important browser-facing result from the App Builder create-order action is the PayPal `orderId`.

Conceptually:

```json
{
  "orderId": "PAYPAL_ORDER_ID"
}
```

The browser uses this ID in the Card Fields submit flow.

The PayPal client secret and backend OAuth credentials never travel to EDS.

---

# 15. 3D Secure / SCA

PayPal's Card Fields integration supports 3D Secure.

The create-order flow can specify the desired verification behavior. PayPal documents the following concepts:

```text
SCA_ALWAYS
SCA_WHEN_REQUIRED
```

Interpretation:

- `SCA_ALWAYS`: request authentication for every applicable transaction.
- `SCA_WHEN_REQUIRED`: authenticate when required by the applicable regional/compliance rules.

The final choice must be driven by merchant requirements, supported markets, and PayPal's current capabilities.

The planning agent must design for both:

```text
No 3DS challenge
        |
        +--> successful authorization

3DS required
        |
        +--> customer authentication
        |
        +--> success / failure / cancellation
```

Do not make the architecture dependent on a single synchronous no-challenge path.

---

# 16. Approval / liability shift

The PayPal card flow can expose an approval result containing payment/authentication information such as `liabilityShift`.

The application should not blindly mark the ACCS order as paid merely because a browser callback exists.

Instead:

1. Inspect the PayPal result.
2. Apply the project's liability-shift / authentication policy.
3. Call server-side capture where appropriate.
4. Validate the server-side capture response.
5. Only then update/complete the Commerce order/payment state.

---

# 17. Capture flow

The server-side capture operation is:

```text
POST /v2/checkout/orders/{ORDER-ID}/capture
```

App Builder should perform this request with PayPal server-side credentials.

The EDS browser should not use the PayPal client secret or directly perform privileged capture operations.

Conceptual flow:

```text
EDS
 |
 | successful PayPal Card Fields submission
 v
App Builder capture-order
 |
 v
PayPal Orders v2 capture
 |
 v
Capture response
 |
 v
validate payment result
 |
 v
update/complete ACCS payment/order state
```

---

# 18. Payment result handling

A production implementation must handle more than a binary HTTP success/failure.

Plan for:

- successful payment/capture
- payment declined
- payment failed
- customer canceled flow
- 3DS challenge failure
- 3DS challenge cancellation
- pending transaction
- capture conflict / duplicate request
- timeout / transient PayPal API failure
- order-not-found / stale order ID
- already-captured order

The checkout state machine must distinguish:

```text
Payment not started
Payment order created
Card fields submitted
Authentication required
Payment authorized/approved
Capture pending
Payment completed
Payment failed
Payment canceled
Payment requires recovery
```

---

# 19. Idempotency and retries

App Builder actions should be written with retry-safe behavior.

At minimum the plan should address:

- duplicate create-order attempts from double-click or repeated browser events;
- duplicate capture requests after network retries;
- timeout after PayPal may already have accepted the operation;
- browser refresh after a PayPal order has already been created;
- stale PayPal order IDs;
- reconciliation between PayPal payment state and ACCS order/payment state.

Do not blindly retry a capture if the prior request's final state is unknown. Retrieve/verify payment state where appropriate before attempting another irreversible operation.

---

# 20. EDS responsibilities

EDS checkout should be responsible for:

- displaying the payment section;
- loading the PayPal v6 SDK;
- requesting the browser-safe token;
- checking Card Fields eligibility;
- mounting PayPal Card Fields;
- collecting merchant-owned billing/shipping data where required;
- requesting PayPal order creation through App Builder;
- submitting the Card Fields session;
- handling client-side validation and payment UI state;
- requesting server-side capture after the appropriate PayPal result;
- presenting recoverable and non-recoverable payment errors.

EDS should not:

- hold PayPal client secrets;
- create privileged PayPal OAuth credentials;
- send raw PAN/CVV to App Builder;
- calculate the authoritative grand total;
- directly call privileged Orders API endpoints with server credentials.

---

# 21. App Builder responsibilities

App Builder should be the server-side integration boundary.

It should:

- securely hold PayPal credentials/secrets;
- create the browser-safe client-token flow;
- validate ACCS cart/order state;
- construct the PayPal order;
- call PayPal Orders v2;
- apply merchant-side amount/currency validations;
- capture the PayPal order;
- validate capture response;
- coordinate Commerce payment/order state updates;
- implement safe retries and idempotency;
- log correlation IDs and non-sensitive payment metadata.

Never log:

- PAN
- CVV
- full card number
- PayPal secrets
- OAuth credentials
- browser-safe token values if they are not required for debugging

---

# 22. Adobe Commerce as a Cloud Service constraint

This is **Adobe Commerce as a Cloud Service / SaaS**, not a traditional PaaS deployment.

Do not plan a custom in-process Magento module as the primary extension mechanism.

The preferred architecture is out-of-process:

```text
EDS
  |
  v
Checkout / OOPE integration
  |
  v
App Builder
  |
  +---- PayPal
  |
  +---- ACCS APIs / supported commerce integration
```

Commerce remains the authoritative source for cart/order state.

App Builder owns custom payment orchestration outside the Commerce runtime.

---

# 23. PayPal Advanced / Expanded Checkout prerequisites

PayPal's documentation indicates that advanced card payments require the merchant/account to be enabled/eligible for the relevant advanced card capability.

Planning should include a prerequisite check for the intended sandbox and production merchant accounts.

At minimum confirm:

- PayPal business account
- PayPal REST app
- client ID
- client secret
- permission to create browser-safe client tokens
- Advanced Credit and Debit Card Payments / advanced cards eligibility
- intended country/currency support
- 3DS/Strong Customer Authentication requirements for target markets

---

# 24. Country and currency constraints

PayPal's examples often use USD/US for demonstration.

Do not assume the example's:

- USD currency
- US buyer country
- US billing address
- US 3DS behavior

apply to the real project.

The actual implementation must use the ACCS market/store/currency configuration and PayPal-supported country/currency combinations for the merchant account.

---

# 25. Card Fields vs legacy Hosted Fields

This distinction is critical.

## New implementation

Use:

```text
JavaScript SDK v6
Card Fields
```

## Legacy implementation

Older PayPal material may refer to:

```text
JavaScript SDK v5
HostedFields
```

Do not copy v5 HostedFields code into this new architecture simply because it appears to render iframes.

The design decision is:

```text
NEW -> v6 + Card Fields
OLD EXISTING -> v5/HostedFields only if maintaining an existing integration
```

---

# 26. Representative UI structure

The EDS checkout can conceptually expose:

```html
<section class="paypal-card-payment">
  <div id="paypal-card-name-field"></div>
  <div id="paypal-card-number-field"></div>
  <div id="paypal-card-expiry-field"></div>
  <div id="paypal-card-cvv-field"></div>

  <div class="billing-address">
    <!-- merchant-owned billing fields if required -->
  </div>

  <button type="button" id="paypal-card-submit">
    Pay now
  </button>

  <div id="paypal-payment-error"></div>
</section>
```

This is an architectural example, not a verbatim PayPal sample.

---

# 27. Representative v6 browser pseudocode

Use this only as planning-level pseudocode; final coding must follow the exact PayPal v6 API contract.

```javascript
async function initializePayPalCardPayment() {
  const clientToken = await getBrowserSafeClientToken();

  const paypalSdk = await window.paypal.createInstance({
    clientToken,
    components: ["card-fields"],
    pageType: "checkout"
  });

  const methods = await paypalSdk.findEligibleMethods();

  if (!methods.isEligible("advanced_cards")) {
    return { eligible: false };
  }

  const cardSession = paypalSdk.createCardFieldsOneTimePaymentSession();

  const cardNumber = cardSession.createCardFieldsComponent({ type: "number" });
  const cardExpiry = cardSession.createCardFieldsComponent({ type: "expiry" });
  const cardCvv = cardSession.createCardFieldsComponent({ type: "cvv" });

  mount(cardNumber, "#paypal-card-number-field");
  mount(cardExpiry, "#paypal-card-expiry-field");
  mount(cardCvv, "#paypal-card-cvv-field");

  return {
    eligible: true,
    cardSession
  };
}

async function pay(cardSession) {
  const orderId = await appBuilderCreatePayPalOrder();

  const result = await cardSession.submit(orderId, {
    // supported billing/checkout information
  });

  return result;
}
```

Do not treat this as production-ready code. It is included so a planning agent understands the API sequence and separation of responsibilities.

---

# 28. Representative backend pseudocode

Create order:

```javascript
async function createPayPalOrder({ cartId }) {
  const cart = await getAuthoritativeAccsCart(cartId);

  validateCart(cart);

  const paypalOrder = await paypalOrdersV2.create({
    intent: "CAPTURE",
    purchase_units: buildPurchaseUnitsFromCart(cart)
  });

  return {
    orderId: paypalOrder.id
  };
}
```

Capture:

```javascript
async function capturePayPalOrder({ orderId }) {
  const result = await paypalOrdersV2.capture(orderId);

  validateCaptureResult(result);

  return result;
}
```

The real implementation must include authentication, idempotency, error mapping, logging, timeout policy, and ACCS synchronization.

---

# 29. Architecture decisions the planning agent must make

The planning agent should explicitly decide/document:

1. Which ACCS APIs are used to read the cart and update payment/order state.
2. Which EDS checkout extensibility/OOPE payment extension point hosts the payment method.
3. Exact App Builder action contracts.
4. Browser-safe token acquisition and caching/lifetime policy.
5. PayPal order amount construction from ACCS cart data.
6. `CAPTURE` versus `AUTHORIZE` intent.
7. 3DS policy (`SCA_WHEN_REQUIRED` versus `SCA_ALWAYS`) for the target markets.
8. How Card Fields eligibility failure is presented.
9. Exact Card Fields layout and styling supported by PayPal.
10. Error and recovery states.
11. Idempotency strategy.
12. ACCS order/payment state synchronization after PayPal capture.
13. Monitoring and correlation IDs.
14. Sandbox-to-production configuration separation.
15. CSP/domain requirements for EDS and PayPal hosted content.

---

# 30. Security acceptance criteria

A proposed design should be rejected if it does any of the following:

- sends PAN/CVV through an App Builder action;
- stores PAN/CVV in ACCS or App Builder logs/database;
- exposes the PayPal client secret in the browser;
- calculates the authoritative final payment amount only in browser code;
- allows the browser to directly perform privileged PayPal capture operations;
- assumes payment success without validating the PayPal server-side result;
- treats a 3DS challenge as an exceptional edge case instead of part of the normal payment state machine.

A compliant design should preserve this boundary:

```text
                 SENSITIVE CARD DATA
                       |
                       v
              PayPal-hosted Card Fields
                       |
                       v
                    PayPal

EDS <---- orderId / status ----> App Builder <----> PayPal Orders API
                                      |
                                      v
                                    ACCS
```

---

# 31. Embedded PayPal documentation facts for the planning agent

The following facts are intentionally embedded so the agent does not need web access:

### Fact A - Current SDK
PayPal's current documentation says new integrations should use JavaScript SDK v6. SDK v5 is treated as legacy/support material for existing integrations.

### Fact B - Current card component
The current card integration is the **CardFields** component. `HostedFields` is the legacy component.

### Fact C - Card fields are hosted by PayPal
PayPal's Card Fields documentation describes hosted card fields for number, CVV/security code, and expiry. The merchant page supplies containers while PayPal provides the payment field implementation.

### Fact D - Browser-safe token
PayPal v6 Card Fields initialization uses a browser-safe client token. The merchant client secret remains server-side.

### Fact E - v6 session
The current v6 flow creates a one-time Card Fields payment session and creates field components such as number, expiry, and CVV from the session.

### Fact F - Eligibility
The implementation checks for eligibility for advanced cards before rendering the fields.

### Fact G - Order creation
The front end needs a PayPal order ID. The recommended architecture obtains it from the merchant backend, which calls the Orders API.

### Fact H - Submit
The Card Fields session is submitted against the PayPal order ID. Supported billing/checkout information can accompany the submit operation. Raw PAN/CVV must not be copied into the merchant request model.

### Fact I - 3DS
PayPal documents 3DS support for Card Fields and supports create-order verification configuration such as `SCA_ALWAYS` and `SCA_WHEN_REQUIRED` in the applicable integration.

### Fact J - Capture
After the payment flow is successfully approved, the backend captures the order through the Orders API endpoint:

```text
POST /v2/checkout/orders/{ORDER-ID}/capture
```

### Fact K - Account prerequisites
Advanced card payments require the relevant PayPal advanced card capability/eligibility for the merchant account.

### Fact L - Production planning
Currency, country, account eligibility, 3DS behavior, risk controls, and supported payment capabilities must be validated for the actual merchant markets rather than copied from PayPal's US/USD examples.

---

# 32. Source references embedded for provenance

These URLs are included only as provenance for a human reviewer. The planning agent must not depend on accessing them.

## Current Card Fields documentation

Title: Card fields - PayPal Developer

URL:
https://developer.paypal.com/expanded/card-fields

Key subjects represented in this context:

- JavaScript SDK v6 core loading
- browser-safe client token
- Card Fields number/CVV/expiry
- create and submit order
- capture order
- 3DS outcomes
- backend route pattern

## Current Advanced Card Payments integration

Title: Integrate card payments - PayPal Developer

URL:
https://developer.paypal.com/platforms/checkout/advanced/integrate/

Key subjects represented in this context:

- Expanded Checkout
- current/legacy SDK distinction
- CardFields versus HostedFields
- hosted field containers
- card-field rendering
- createOrder
- capture
- 3DS
- styling
- advanced card eligibility

## Current PayPal Expanded Checkout overview

Title: PayPal Expanded Checkout

URL:
https://developer.paypal.com/studio/checkout/advanced

Key subjects represented in this context:

- customized credit/debit card fields
- one-time card payments
- fraud/authentication capabilities
- 3DS
- country/currency availability considerations

## Legacy Hosted Fields distinction

Title: Integrate PayPal buttons and hosted fields - PayPal Developer

URL:
https://developer.paypal.com/platforms/checkout/advanced/sdk/v1/

Use this source only to understand the terminology and legacy boundary. Do not use its HostedFields implementation as the basis for this new v6 integration.

---

# 33. Final planning recommendation

For the requested Adobe architecture, plan for:

```text
Adobe EDS Checkout
   |
   |  OOPE/payment extension
   v
PayPal JS SDK v6
   |
   +--> Card Fields
   |      +--> card number
   |      +--> expiry
   |      +--> CVV
   |
   +--> PayPal authentication / 3DS flow
   |
   v
Adobe App Builder
   |
   +--> browser-safe token
   +--> validate ACCS cart
   +--> PayPal Orders v2 create
   +--> PayPal Orders v2 capture
   |
   v
Adobe Commerce as a Cloud Service
```

The key implementation rule is:

> **Use PayPal JavaScript SDK v6 Card Fields for the browser-hosted card entry, App Builder for privileged PayPal server-side operations, and ACCS as the authoritative Commerce source of cart/order state.**

Do not substitute PayPal v5 HostedFields code, and do not pass raw card data through EDS, App Builder, or ACCS.

---

# 34. Additional PayPal gaps identified after documentation review

The following requirements were added after a broader review of PayPal's Card Fields, REST API, 3D Secure, webhook, and production-readiness documentation. A planning agent should treat these as part of the payment design rather than optional polish.

## 34.1 Webhooks and asynchronous reconciliation

Do not rely only on the browser returning from `cardSession.submit()` or on the synchronous capture HTTP response. The backend needs a PayPal webhook endpoint and a reconciliation strategy because payment state can change independently of the active browser session.

PayPal documents checkout/payment webhook events including:

```text
CHECKOUT.ORDER.APPROVED
CHECKOUT.PAYMENT-APPROVAL.REVERSED
PAYMENT.CAPTURE.PENDING
PAYMENT.CAPTURE.COMPLETED
PAYMENT.CAPTURE.DENIED
```

Relevant meanings for the implementation:

- `CHECKOUT.ORDER.APPROVED`: the buyer approved the order; for flows requiring capture, the server can proceed with capture according to the selected integration design.
- `CHECKOUT.PAYMENT-APPROVAL.REVERSED`: a problem occurred after buyer approval and before successful capture. Treat this as a recovery/failure condition rather than fulfillment success.
- `PAYMENT.CAPTURE.PENDING`: capture initiation succeeded but completion is still pending. Do not fulfill merely because the capture request was accepted.
- `PAYMENT.CAPTURE.COMPLETED`: the capture completed; this is an authoritative event useful for payment/order reconciliation and fulfillment gating.
- `PAYMENT.CAPTURE.DENIED`: capture was denied; do not fulfill the order as paid.

The App Builder design should therefore include a webhook action, for example:

```text
paypal/webhook
```

and persist enough non-sensitive correlation data to map:

```text
PayPal order ID
PayPal capture ID
ACCS cart/order identifier
merchant idempotency/correlation identifier
payment state
```

Webhook processing must be idempotent because delivery can be repeated. The implementation must also verify webhook authenticity using PayPal's supported verification mechanism before mutating Commerce state.

## 34.2 Fulfillment must not be based on browser success alone

The browser is an orchestration/UI participant, not the final authority for fulfillment.

A robust state transition is:

```text
Card Fields submission succeeds
        |
        v
server-side capture requested
        |
        +--> COMPLETED -> mark payment captured / allow fulfillment
        |
        +--> PENDING   -> keep payment/order pending; await reconciliation/webhook
        |
        +--> DENIED    -> payment failure path
        |
        +--> unknown due to timeout -> query/reconcile before retrying
```

A browser tab can close, refresh, lose connectivity, or fail to receive a successful response even when PayPal has processed an operation. Backend reconciliation must handle that case.

## 34.3 REST idempotency is a first-class requirement

PayPal recommends `PayPal-Request-Id` for API calls that create or modify data. The value is a merchant-generated unique identifier used by PayPal to make supported state-changing requests idempotent.

Use it on supported `POST`/`PUT` operations, especially payment creation/capture operations, so network retries or double submission do not unintentionally create duplicate effects.

Planning requirements:

```text
create-order idempotency key != capture idempotency key
```

Each logical operation should have a stable key across retries of that same operation.

Example conceptual mapping:

```text
create order:
  PayPal-Request-Id = paypal-create-{checkoutAttemptId}

capture order:
  PayPal-Request-Id = paypal-capture-{paypalOrderId}-{captureAttemptId}
```

Do not generate a new idempotency key merely because the HTTP client is retrying the same logical operation. A new key would defeat the duplicate-protection purpose.

If an HTTP timeout or 5xx occurs after a state-changing request, first use the same idempotency key and/or retrieve current PayPal state according to the API contract instead of assuming the operation failed.

## 34.4 Disable duplicate browser submissions

The checkout UI should enter a processing state immediately after the user initiates payment.

At minimum:

- disable the Pay button while the current payment attempt is active;
- prevent multiple simultaneous create-order calls;
- prevent multiple simultaneous Card Fields submissions;
- do not create a fresh PayPal order merely because the user double-clicked;
- show a clear recoverable state if the network response is unknown.

This UI protection complements server-side idempotency; it does not replace it.

## 34.5 Exact 3DS/SCA configuration belongs to the server-side order model

PayPal's Orders API card model supports verification configuration under the card payment-source attributes. Documented verification methods include:

```text
SCA_ALWAYS
SCA_WHEN_REQUIRED
3D_SECURE
AVS_CVV
```

For the SCA strategy discussed in this document, the important options are:

```text
SCA_ALWAYS
SCA_WHEN_REQUIRED
```

The API model describes `SCA_WHEN_REQUIRED` as the default verification method for the applicable card-verification field.

The planning agent must not hard-code `SCA_ALWAYS` simply because 3DS is supported. Select the policy based on merchant requirements and supported markets. PayPal specifically calls out PSD2/European scenarios as situations where 3DS may be required.

The order/payment state machine must support payer action/authentication being required rather than assuming every transaction proceeds directly to capture.

## 34.6 Billing address is relevant to risk/SCA

PayPal's current Card Fields guide allows billing data to be supplied during Card Fields submission, for example through a `billingAddress` object. The guide specifically uses postal code as an example and recommends including the fields required by the merchant's risk and SCA strategy.

Therefore the planning agent should explicitly define:

- which billing fields ACCS already owns;
- which billing fields are supplied to PayPal;
- normalization of country/region/postal-code values;
- whether billing address is the same as shipping;
- validation ownership between EDS, ACCS, and PayPal;
- how billing data is handled for guest versus authenticated checkout.

Do not add merchant-owned PAN/CVV fields while solving billing-address requirements.

## 34.7 Card Fields eligibility must have a defined fallback

PayPal's v6 Card Fields guide checks eligible methods before rendering advanced cards. The guide also advises defensive integration because eligibility information can vary.

The planner must define what happens when `advanced_cards` is unavailable. Valid product decisions could include hiding the card option, presenting another configured payment method, or displaying an availability message. The implementation must not leave an empty payment section or assume Card Fields will always render.

Eligibility should be evaluated for the active checkout context, including the relevant currency where supported by the SDK call.

## 34.8 Styling is constrained to PayPal-supported properties

Card Fields are hosted fields. Arbitrary EDS CSS cannot be assumed to style the internals of the PayPal field.

PayPal publishes a Card Fields Style Guide and supports a defined set of CSS properties. Unsupported properties can generate browser-console warnings rather than being applied.

The design process should therefore separate:

```text
EDS/container styling
  -> grid, spacing, labels, surrounding border/layout, responsive placement

PayPal Card Fields supported styling
  -> only properties supported by the Card Fields styling API
```

Do a visual proof-of-concept before promising pixel-identical behavior to a native EDS `<input>`.

## 34.9 Accessibility is part of production readiness

PayPal's current Card Fields production checklist calls out keyboard and screen-reader accessibility.

Acceptance testing should include:

- keyboard-only navigation;
- sensible focus order into and out of hosted fields;
- visible focus treatment in supported styling;
- labels/instructions associated with the payment controls;
- error messaging that is perceivable without relying only on color;
- screen-reader behavior around the PayPal-hosted components;
- loading/processing state announcement where appropriate.

## 34.10 Content Security Policy must be planned before launch

Because the PayPal SDK and hosted payment UI are loaded from PayPal-controlled origins, a restrictive EDS Content Security Policy can block the integration.

PayPal's Card Fields production checklist explicitly requires updating CSP for PayPal domains.

The implementation plan should inventory the actual PayPal production and sandbox resources used by the final integration and update the appropriate CSP directives. Do not blindly copy a permissive wildcard CSP into production.

CSP validation must be part of sandbox/UAT testing.

## 34.11 Generate browser-safe client tokens server-side per session

PayPal's current Card Fields production checklist says to generate client tokens server-side per session.

For this architecture:

```text
EDS -> App Builder browser-safe-token action -> PayPal
```

The planning agent should define token lifetime/caching behavior and avoid treating the browser-safe token as a permanent storefront configuration value.

The PayPal client secret must never be shipped to EDS.

## 34.12 CSRF protection is required for merchant backend routes

PayPal's Card Fields production checklist explicitly calls for CSRF protection on backend routes.

The App Builder design should therefore distinguish public browser-callable payment actions from trusted server-to-server operations and define appropriate protections for actions such as:

```text
browser-safe-client-token
create-order
capture-order
```

Do not assume that hiding an App Builder URL is an access-control mechanism.

## 34.13 Log PayPal correlation information, not card data

PayPal's Card Fields production checklist recommends logging PayPal API correlation IDs for support/troubleshooting.

Operational logs should contain identifiers such as:

```text
ACCS cart/order ID
PayPal order ID
PayPal capture ID when available
PayPal correlation/debug identifier from API response headers when available
App Builder request/correlation ID
idempotency key
high-level payment status/error category
```

Logs must not contain PAN, CVV, client secrets, OAuth credentials, or other prohibited sensitive payment data.

## 34.14 Sandbox and production endpoints must be separated

PayPal REST API base URLs differ by environment:

```text
Sandbox REST API:
https://api-m.sandbox.paypal.com

Production REST API:
https://api-m.paypal.com
```

PayPal JS SDK v6 core is likewise environment-specific:

```text
Sandbox:
https://www.sandbox.paypal.com/web-sdk/v6/core

Production:
https://www.paypal.com/web-sdk/v6/core
```

Environment selection must be server/configuration driven. Never infer production mode from browser input.

## 34.15 Negative and failure-path testing is required

PayPal provides facilities/documentation for negative API testing and webhook-event simulation. The test plan should exercise more than a successful sandbox card.

At minimum test:

```text
Card Fields ineligible
invalid/incomplete card fields
card/payment decline
3DS required + successful authentication
3DS failure/cancellation where testable
create-order timeout
capture timeout
capture pending
capture denied
repeated Pay click
repeated create request
repeated capture request
browser refresh during payment
browser closed after approval
webhook duplicate delivery
webhook arriving before/after browser completion handling
Commerce update failure after PayPal capture
```

The last case is especially important: if PayPal capture succeeds but the ACCS order update fails, the system needs reconciliation rather than attempting an unqualified second capture.

## 34.16 Optional vaulting/saved-card scope must be decided explicitly

PayPal Orders v2 supports card vaulting in supported scenarios using card attributes such as `vault.store_in_vault = ON_SUCCESS`, and can return a PayPal vault/payment-source identifier for future use.

Do not accidentally include vaulting in the initial implementation merely because the API supports it.

The planning agent must state one of:

```text
Phase 1: one-time card payment only; no card vaulting
```

or

```text
Saved cards are in scope and require a separate design covering consent,
customer association, stored-payment-source semantics, lifecycle, and PayPal vault IDs.
```

A PayPal vault ID is not the same as storing raw card details. Raw PAN/CVV must still never be stored by EDS/App Builder/ACCS.

## 34.17 CAPTURE versus AUTHORIZE must remain an explicit business decision

The Card Fields example is commonly presented as an immediate `CAPTURE` flow, but Orders v2 also supports authorization-oriented payment lifecycles.

The planning agent must determine whether the merchant needs:

```text
CAPTURE
  -> take payment during checkout

AUTHORIZE
  -> authorize during checkout and capture later according to business workflow
```

Do not introduce delayed capture unless there is a concrete fulfillment/business requirement and the corresponding PayPal/ACCS state transitions are designed.

## 34.18 Do not overgeneralize PayPal Checkout and Card Fields 3DS behavior

PayPal documentation distinguishes standard PayPal Checkout from advanced card/Card Fields integrations. Standard PayPal Checkout may handle authentication differently, while advanced card/Card Fields integrations expose card-specific 3DS configuration and outcomes.

For this project, any 3DS design statement must be tied specifically to **advanced card/Card Fields**, not copied from a PayPal-wallet-only integration.

---

# 35. Expanded App Builder action inventory

A production-oriented plan should now consider this logical action set:

```text
paypal/browser-safe-client-token
paypal/create-order
paypal/capture-order
paypal/get-order-or-reconcile       # optional but recommended for recovery
paypal/webhook                      # asynchronous PayPal event processing
```

Responsibilities:

```text
browser-safe-client-token
  - obtain browser-safe PayPal SDK initialization credential
  - never expose client secret

create-order
  - validate current ACCS cart
  - derive amount/currency server-side
  - set intent and applicable verification strategy
  - send PayPal-Request-Id
  - persist correlation between checkout attempt and PayPal order

capture-order
  - validate expected PayPal order/Commerce relationship
  - send stable PayPal-Request-Id for retries
  - inspect actual capture state
  - never treat PENDING as COMPLETED

get-order-or-reconcile
  - recover from unknown browser/network outcomes
  - retrieve current PayPal state where required
  - repair/continue the local state machine without duplicate charging

webhook
  - verify webhook authenticity
  - process events idempotently
  - reconcile PayPal and ACCS state
  - gate fulfillment on authoritative successful payment state
```

---

# 36. Expanded payment state model

A planning agent should model at least these states, even if the final persistence names differ:

```text
NOT_STARTED
CARD_FIELDS_READY
CREATING_PAYPAL_ORDER
PAYPAL_ORDER_CREATED
SUBMITTING_CARD
PAYER_ACTION_REQUIRED / AUTHENTICATING
APPROVED_OR_SUBMITTED
CAPTURE_REQUESTED
CAPTURE_PENDING
CAPTURE_COMPLETED
CAPTURE_DENIED
CANCELED
FAILED_RECOVERABLE
FAILED_FINAL
RECONCILIATION_REQUIRED
```

Important invariants:

1. `CAPTURE_COMPLETED` is materially different from `APPROVED_OR_SUBMITTED`.
2. `CAPTURE_PENDING` must not be treated as paid/fulfilled.
3. An HTTP timeout is not proof that a PayPal operation failed.
4. Reconciliation can move an unknown/recoverable state to completed without creating a second charge.
5. Browser state and backend payment state can temporarily disagree; backend/PayPal reconciliation is authoritative for fulfillment.

---

# 37. Additional PayPal source provenance

These references are included for human provenance only. The offline planning agent must rely on the facts embedded in this file and must not require network access.

## Card Fields

Title: Card fields - PayPal Developer

URL:
https://developer.paypal.com/expanded/card-fields

Additional facts incorporated:

- browser-safe client token
- eligibility check for `advanced_cards`
- billing address supplied during submit
- production readiness checklist
- per-session server-side client token generation
- CSRF protection
- robust error/retry states
- PayPal correlation-ID logging
- accessibility
- CSP requirements

## 3D Secure for Expanded Checkout

Title: 3D Secure - PayPal Developer

URL:
https://developer.paypal.com/expanded/3d-secure/

Additional facts incorporated:

- Card Fields 3DS flow
- SCA strategy concepts
- payer authentication as part of the card-payment state machine

## Orders v2 card definitions

Title: Card / card request - Orders v2 - PayPal Developer

Representative URLs:
https://developer.paypal.com/sdk/orders/v2/definitions/card/
https://developer.paypal.com/sdk/orders/v2/definitions/card_request/

Additional facts incorporated:

- card verification methods
- `SCA_ALWAYS`
- `SCA_WHEN_REQUIRED`
- optional vault instruction
- PayPal vault identifiers for supported saved-payment-source use cases

## PayPal REST API requests and idempotency

Title: API requests - PayPal Developer

URL:
https://developer.paypal.com/api/rest/requests/

Additional facts incorporated:

- `PayPal-Request-Id`
- idempotent supported state-changing requests
- safe retry design after timeouts/server errors
- sandbox and production REST base URLs

## Checkout webhooks

Title: Subscribe to checkout webhooks - PayPal Developer

URL:
https://developer.paypal.com/payment-methods/webhooks/

Additional facts incorporated:

- `CHECKOUT.ORDER.APPROVED`
- `CHECKOUT.PAYMENT-APPROVAL.REVERSED`
- `PAYMENT.CAPTURE.PENDING`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.DENIED`
- do not fulfill a pending capture

## Webhooks overview

Title: Webhooks overview - PayPal Developer

URL:
https://developer.paypal.com/api/rest/webhooks

Additional facts incorporated:

- PayPal sends HTTPS webhook notifications to merchant server endpoints
- asynchronous state changes must be handled server-side

## Card Fields Style Guide

Title: Card Fields Style Guide - PayPal Developer

URL:
https://developer.paypal.com/docs/checkout/advanced/customize/card-field-style/

Additional facts incorporated:

- Card Fields expose a supported subset of styling properties
- unsupported styling cannot be assumed to work inside hosted fields

---

# 38. Updated planning-agent checklist

Before considering the PayPal portion of the design complete, the planning agent must answer all of the following:

1. How is the v6 SDK loaded in sandbox and production?
2. How is the browser-safe client token generated per session?
3. How is `advanced_cards` eligibility checked and what is the fallback?
4. Which Card Fields are rendered and where are their EDS containers?
5. Which billing fields are merchant-owned and which are sent to PayPal?
6. Which supported Card Fields styling options are required?
7. How is the authoritative amount/currency obtained from ACCS?
8. Is the PayPal order intent `CAPTURE` or `AUTHORIZE`, and why?
9. What SCA/3DS verification strategy is used for each target market?
10. How does the UI represent authentication/payer-action-required states?
11. What stable `PayPal-Request-Id` strategy is used for create/capture retries?
12. How are double-clicks and simultaneous browser submissions prevented?
13. How are timeouts with unknown payment outcome reconciled?
14. Which PayPal webhooks are subscribed to?
15. How is webhook authenticity verified and duplicate delivery handled?
16. Which exact PayPal state allows ACCS fulfillment to proceed?
17. How are `PENDING`, `DENIED`, and approval-reversed states represented in ACCS?
18. What happens if PayPal capture succeeds but ACCS synchronization fails?
19. Which PayPal/Adobe correlation identifiers are logged?
20. What CSP changes are required for PayPal resources?
21. What keyboard/screen-reader acceptance tests cover hosted fields?
22. Which negative sandbox scenarios are included in UAT?
23. Are saved cards/vaulting explicitly out of scope or explicitly designed?
24. Are sandbox and production credentials/endpoints fully separated?
25. Can any code path expose PAN, CVV, client secret, or privileged OAuth credentials? The required answer is no.

