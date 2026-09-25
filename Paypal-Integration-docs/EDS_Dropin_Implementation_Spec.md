# PayPal Advanced Checkout — EDS Drop-in Implementation Spec

> **Audience:** the EDS drop-in implementation agent/developer.
> **Source of truth:** `PayPal_Advanced_Checkout_ACCS_Solution_Design_Document 1.docx` (SDD v1.0),
> `..._DataFlow_Diagram 1.drawio`, `..._Sequence_Diagram 1.drawio`.
> **Purpose:** turn the SDD (which is architecture-level) into a connected, implementation-ready
> contract for the EDS side only. Refund/void, webhooks, SFMC and NetSuite are **not** EDS work.
>
> **Legend:**
> ✅ = explicitly specified in the SDD · ⚠️ **GAP** = missing, must be confirmed before/while
> building · 🔷 **PROPOSED** = a concrete shape proposed here to unblock EDS work, **provisional
> until the App Builder dev confirms the real API Mesh schema.**

---

## 1. Scope recap (EDS only)

The EDS storefront must, inside the checkout flow:

1. Render a **custom "PayPal" payment option** (NOT the built-in `storefront-payment-services`
   PayPal drop-in — see §7).
2. Load the **PayPal JS SDK** (`buttons` + `card-fields`) browser-side.
3. Call **API Mesh GraphQL** to (a) create a PayPal order and (b) authorize/capture payment.
4. Drive the approval → authorize → order-placed UI, including error/retry branches.

EDS calls **only API Mesh** for server operations. The **only** direct browser→PayPal path is the
JS SDK (card entry + Wallet login). ✅ (SDD §3.1 flow legend 2–3)

---

## 2. All references invoked via App Builder (consolidated)

These are every App Builder action and the PayPal REST endpoint each fronts. The **"EDS invokes?"**
column is what matters for this drop-in.

| App Builder action | PayPal REST endpoint it calls | Trigger | EDS invokes? (via API Mesh) |
|---|---|---|---|
| `create-paypal-order` | `POST /v2/checkout/orders` (intent `AUTHORIZE`\|`CAPTURE`) | Buyer selects PayPal at checkout | ✅ **YES** |
| `authorize-payment` | `POST /v2/checkout/orders/{id}/authorize` **or** `POST /v2/checkout/orders/{id}/capture` | Buyer approved (Wallet) / submitted Card Fields | ✅ **YES** |
| (deferred) capture-authorized | `POST /v2/payments/authorizations/{id}/capture` | ACCS invoice/shipment event (AUTHORIZE strategy only) | ❌ no — event-driven |
| `refund-payment` | `POST /v2/payments/captures/{id}/refund` **or** void/auth-cancel | Commerce Admin credit memo → ACCS out-of-process webhook | ❌ no — Admin side |
| Webhook Notification Handler | (receives) PayPal async webhooks | PayPal → App Builder | ❌ no |
| Event Consumers | SFMC Transactional API, MuleSoft/NetSuite | ACCS Adobe I/O Events | ❌ no |

**PayPal server auth** (Client Credentials grant → OAuth access token) happens **inside** App
Builder; EDS never sees PayPal secrets or tokens. ✅ (SDD §4.10, §5.3)

**So the EDS drop-in only ever invokes TWO App Builder actions**, both via API Mesh GraphQL:
`create-paypal-order` and `authorize-payment`.

---

## 3. PayPal JS SDK references (browser-side, direct to PayPal)

Loaded once by the checkout block. NOT routed through App Builder/Mesh.

| Item | Value / reference |
|---|---|
| SDK script | `https://www.paypal.com/sdk/js?client-id={CLIENT_ID}&components=buttons,card-fields&intent={authorize\|capture}&currency={CUR}` |
| Buttons component | Renders PayPal Wallet button; uses `createOrder` + `onApprove` callbacks |
| Card Fields component | PayPal-hosted card inputs (PCI SAQ-A); 3DS handled internally |
| 3-D Secure | Entirely inside Card Fields — EDS only receives success/failure outcome ✅ (SDD §4.3, §7) |
| Client ID | ⚠️ **GAP** — public, must be provided by App Builder dev / PayPal account (see §6) |

**Callback wiring (standard Advanced Checkout pattern — 🔷 PROPOSED, make explicit in code):**
- SDK `createOrder()` callback → call **`create-paypal-order`** (API Mesh) → return its `paypalOrderId` to the SDK.
- SDK `onApprove()` (Wallet) / Card Fields `submit()` success → call **`authorize-payment`** (API Mesh) with that `paypalOrderId`.
- SDK `onError()` / 3DS failure → EDS error/retry UI (App Builder not involved). ✅ (SDD §7)

---

## 4. EDS ↔ App Builder contract (via API Mesh) — 🔷 PROPOSED

> ⚠️ **GAP #1 (blocking):** the SDD never defines the API Mesh GraphQL schema. The shapes below are
> **proposed** to let EDS build contract-first against a mock. **The App Builder dev must confirm or
> replace field names before integration.** Do not treat as final.

### 4.1 Create order

```graphql
mutation CreatePayPalOrder($input: CreatePayPalOrderInput!) {
  createPayPalOrder(input: $input) {
    paypalOrderId          # PayPal order id, fed back into the SDK createOrder callback
    status                 # CREATED
    # cardFieldsSession?   # ⚠️ GAP: SDD §4.2 mentions "card-fields session data" — undefined shape
  }
}
```
- `CreatePayPalOrderInput` 🔷: `{ cartId, amount, currencyCode, intent }` — ⚠️ **GAP:** exact fields
  ("cart/amount details", SDD §4.2) not specified. Confirm whether Mesh reads the cart from ACCS by
  `cartId` or EDS sends amount/line-items.
- Fronts `POST /v2/checkout/orders`. ✅

### 4.2 Authorize / capture payment

```graphql
mutation AuthorizePayPalPayment($input: AuthorizePayPalPaymentInput!) {
  authorizePayPalPayment(input: $input) {
    result                 # AUTHORIZED | CAPTURED | FAILED
    retryable              # ⚠️ GAP: needed to distinguish retryable vs hard failure (SDD §7) — PROPOSE App Builder returns this
    orderNumber            # ACCS order number, once App Builder places the order (SDD §4.4, seq 21–23)
    error { code message } # PROPOSED machine-readable error contract
  }
}
```
- `AuthorizePayPalPaymentInput` 🔷: `{ paypalOrderId, payerId?, idempotencyKey? }` — `payerId` present
  for Wallet path (SDD seq step 15).
- Fronts `POST .../authorize` or `.../capture` per intent. ✅
- **App Builder writes payment status THEN places the ACCS order** and returns confirmation — order
  placement is App Builder-driven, EDS does not call ACCS `placeOrder`. ✅ (SDD §3.3, §4.4)

---

## 5. Connected end-to-end EDS flow (mapped to sequence diagram)

```
Buyer selects PayPal ──▶ [SDK createOrder cb] ──▶ createPayPalOrder (Mesh)     seq 1–7 ✅
        │                                             └─ POST /v2/checkout/orders
        ▼
Load PayPal SDK (buttons + card-fields)                                         seq 8 ✅
        │
        ├─ Wallet:  button ▶ PayPal popup/login ▶ onApprove(payerID, orderID)   seq 9–10, 15 ✅
        └─ Card:    Card Fields ▶ submit ▶ (PayPal runs 3DS internally)         seq 9c–13 ✅
                    └─ validation/3DS failure ▶ EDS retry UI                    seq 11–12, 13f–14f ✅
        ▼
[onApprove / card submit success] ──▶ authorizePayPalPayment(paypalOrderId)     seq 16–19 ✅
        │                                 └─ POST .../authorize|capture
        ├─ result AUTHORIZED|CAPTURED ─▶ App Builder places ACCS order ─▶ orderNumber ─▶ EDS shows confirmation   seq 20–24 ✅
        ├─ result FAILED + retryable ──▶ EDS "retry authorization" (reuse same paypalOrderId, no re-entry)         seq 19f, 20r–21r ✅ / ⚠️ GAP: reuse-order not stated
        └─ result FAILED + hard ───────▶ EDS terminal failure, choose another method                              seq 20h ✅
```

⚠️ **GAP #2:** how EDS receives the *final placed-order* result. SDD seq step 23 shows "Order
confirmation" returning to the storefront, but doesn't say whether `authorize-payment` is
**synchronous** (returns `orderNumber` in one call — assumed above) or whether EDS must poll. Confirm
with App Builder dev.

---

## 6. Config keys the EDS drop-in needs — ⚠️ GAP (none defined in SDD)

Add to `config.json` (branch/local) and the Configuration Service (prod). Names 🔷 PROPOSED:

| Key | Purpose | Source |
|---|---|---|
| `paypal-client-id` | PayPal JS SDK `client-id` (public) | ⚠️ App Builder dev / PayPal account |
| `paypal-sdk-components` | `"buttons,card-fields"` | fixed |
| `paypal-intent` | `authorize` \| `capture` | ⚠️ business rule (SDD §4.5) — confirm first cut |
| `paypal-currency` | SDK + order currency | ⚠️ multi-currency source undefined (SDD §4.1) |
| `commerce-endpoint` / mesh endpoint | must point at the **API Mesh** unified endpoint, not ACCS directly | ✅ (SDD §3.1) |

---

## 7. Critical architectural decision to confirm — ⚠️ GAP #3

The boilerplate already ships `scripts/__dropins__/storefront-payment-services/` with
`PayPalButtons.js` and hosted `CreditCard.js` — but that talks to **Adobe Payment Services**, not
this custom App Builder module. The SDD explicitly rejects Payment Services and mandates a **custom**
integration talking directly to PayPal Orders v2 (SDD §2.2, §3.3, §3.4).

**Therefore:** build a **custom payment method** in `blocks/commerce-checkout/containers.js`
(`renderPaymentMethods` slot map, where `CREDIT_CARD` renders today) that mounts your own SDK
Buttons/Card Fields and calls the two Mesh mutations — do **not** enable the built-in `SMART_BUTTONS`.
⚠️ Confirm the custom payment-method **code** used to register/identify this method in the ACCS
checkout payment list (undefined in SDD).

---

## 8. Consolidated gap list (must close before/while EDS build)

| # | Gap | Owner | Blocking? |
|---|---|---|---|
| 1 | API Mesh GraphQL schema (mutation names, input/output) for create + authorize | App Builder | 🔴 Yes |
| 2 | Is `authorize-payment` synchronous & returns `orderNumber`, or does EDS poll? | App Builder | 🔴 Yes |
| 3 | Custom-vs-built-in PayPal path confirmation + payment-method code | Architect | 🔴 Yes |
| 4 | PayPal `client-id` (sandbox + prod) | App Builder / PayPal | 🔴 Yes |
| 5 | `create-paypal-order` input fields (cartId vs amount/line-items) | App Builder | 🟠 |
| 6 | "Card-fields session data" shape returned by create-order (SDD §4.2) | App Builder | 🟠 |
| 7 | Machine-readable `retryable` flag + error-code contract (SDD §7 is prose only) | App Builder | 🟠 |
| 8 | Browser→API Mesh auth for these mutations (IMS is server-to-server; browser is not) | App Builder / Security | 🟠 |
| 9 | Idempotency key: generated by EDS or App Builder? (SDD §4.9) | App Builder | 🟡 |
| 10 | Retry reuses same `paypalOrderId` — confirm | App Builder | 🟡 |
| 11 | Capture intent for first cut: AUTHORIZE, CAPTURE, or both (SDD §4.5) | Business | 🟡 |
| 12 | Currency/locale source of truth (SDD §4.1) | Business | 🟡 |

---

## 9. Recommended EDS build order (contract-first)

1. Close gaps #1–#4 (at least sketch the GraphQL contract) with the App Builder dev.
2. Config plumbing (§6) + point storefront GraphQL at API Mesh.
3. `scripts/paypal-sdk.js` — load SDK, render Buttons + Card Fields against PayPal **sandbox**.
4. `blocks/commerce-checkout/paypal-api.js` — the two Mesh mutations, built against a **mock** first.
5. Add custom PayPal method into `containers.js` `renderPaymentMethods`.
6. Wire the full happy path (§5), then error/retry branches (§7 of SDD).
7. Swap mock → real API Mesh; end-to-end sandbox test per SDD §8.2.
