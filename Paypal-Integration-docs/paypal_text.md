Solution Design Document
PayPal Advanced Checkout Integration - Wallet + Card PaymentsAdobe Commerce as a Cloud Service (SaaS) + Edge Delivery Services + API Mesh + App Builder
Document Type
Solution Design Document (SDD)
Project
Adobe Commerce as a Cloud Service - PayPal Advanced Checkout Integration (Custom App Builder Module)
Version
1.0 (Draft for Review)
Date
10 July 2026
Prepared By
Adobe Commerce / Payments Integration Practice
Classification
Confidential - Internal & Client Distribution Only

# Document Control

## Version History
Version
Date
Author
Description
0.1
10 Jul 2026
Solution Architect
Initial draft for internal review
1.0
10 Jul 2026
Solution Architect
Baselined for client review and sign-off

## Reviewers / Approvers
Name
Role
Organisation
[Client Sponsor]
Business Owner
Client
[Client IT Lead]
Technical Approver
Client
[Delivery Lead]
Engagement / Delivery Lead
Adobe Commerce Partner
[Security / PCI Lead]
Security & Compliance Reviewer
Client / Partner

## Distribution List
Client Program Team, Adobe Commerce Delivery Team, PayPal Account Team, PCI/Security Compliance Team.

# Table of Contents
1. Introduction
2. Solution Overview
3. Solution Architecture
4. Detailed Design
5. Security & Compliance (PCI DSS)
6. Non-Functional Requirements
7. Error Handling & Exception Scenarios
8. Testing Strategy
9. Deployment & Rollout Plan
10. Risks & Mitigations
11. Roles & Responsibilities (RACI)
12. Appendix
Note: This is a static outline. In Microsoft Word, right-click and choose “Update Field” if an automatic Table of Contents field is inserted, or use References > Table of Contents to regenerate with live page numbers.

# 1. Introduction

## 1.1 Purpose
This Solution Design Document (SDD) describes the target architecture, integration approach, and detailed design for a custom PayPal payment integration on Adobe Commerce as a Cloud Service (SaaS), using a headless architecture. The integration follows PayPal's Advanced (Expanded) Checkout model - using the PayPal JavaScript SDK's Buttons and Card Fields components together with the Orders v2 REST API - as described in PayPal's developer documentation (developer.paypal.com/docs/checkout/advanced/). This document is intended for solution architects, developers, QA engineers, security/compliance reviewers, and business stakeholders who will build, review, or sign off on the integration.

## 1.2 Scope
In Scope:
PayPal Express Checkout with card payments: PayPal Wallet (login/redirect or popup) and card payments via PayPal's own hosted Card Fields, on the Edge Delivery Services (EDS) storefront backed by Adobe Commerce as a Cloud Service (SaaS).
A new, purpose-built Adobe App Builder module implementing PayPal order creation, authorization/capture, and refund/void.
Authorization and Capture flows, configurable per business rule (intent = AUTHORIZE, with a later separate capture; or intent = CAPTURE, immediate).
3-D Secure, handled entirely by PayPal as part of the Card Fields component - no separate 3DS implementation required from the client or App Builder.
API Mesh aggregating both the ACCS Commerce GraphQL API and the App Builder PayPal checkout actions into a single endpoint for the EDS storefront.
Registration of PayPal as an out-of-process payment method on ACCS for refund/void triggered from Commerce Admin, with all logic implemented in App Builder - no code in Commerce.
An App Builder event-driven pattern that triggers SFMC transactional emails and NetSuite order synchronisation via MuleSoft on order placement.
Configuration of PayPal credentials, held as App Builder secrets, across Integration, Staging, and Production environments.
Out of Scope:
PayPal Pay Later, Venmo, and local alternative payment methods, unless explicitly added in a future phase.
Vaulting/saved PayPal accounts or cards for returning customers, unless explicitly added in a future phase.
In-store / POS card-present payments.
Migration of historical transaction data from a legacy payment gateway.
Any other payment methods that may be offered on the storefront; this document covers the PayPal integration only.

## 1.3 Assumptions & Dependencies
The client's Adobe Commerce instance is Adobe Commerce as a Cloud Service (SaaS); no Commerce codebase or database access is required or used for this integration.
The client holds (or will create) a PayPal Business account with REST API credentials (Client ID and Secret) for Sandbox and Production, via the PayPal Developer Dashboard.
Advanced (Expanded) Credit and Debit Card Payments capability is enabled on the PayPal business account (confirmed via Apps & Credentials > Features > Accept payments in the PayPal Developer Dashboard).
Adobe App Builder and API Mesh workspaces/projects are provisioned under the client's Adobe Developer Console organisation.
The Adobe Commerce Webhooks module and Adobe I/O Events for Adobe Commerce are available and configurable on the client's SaaS instance via Commerce Admin, requiring no code deployment.
The EDS storefront is available as the front-end delivery channel and can load the PayPal JavaScript SDK (buttons and card-fields components) in the checkout block.
The client has an active SFMC instance with Transactional Messaging capability enabled.
Shopper browsers meet the PayPal JavaScript SDK's minimum supported versions.
The client's PCI DSS compliance program (SAQ-A) owns the annual attestation; this document supports but does not replace that process.

## 1.4 References
Reference
Description
PayPal Advanced (Expanded) Checkout - Get Started
developer.paypal.com/docs/checkout/advanced/getstarted/ - overview of the Buttons + Card Fields integration model this design is built around
PayPal Advanced Checkout - Integrate
developer.paypal.com/docs/checkout/advanced/integrate/ (client-referenced as platforms/checkout/advanced/integrate) - end-to-end integration steps
PayPal Orders v2 API Reference
Create, Authorize, Capture, and Refund Orders API endpoints
PayPal JavaScript SDK Reference
Buttons and Card Fields component configuration
PayPal 3D Secure with Card Fields
3-D Secure authentication behaviour when using the CardFields component
Adobe Commerce Out-of-Process Payment Methods
Extensibility documentation for registering payment methods via webhook subscription, without Commerce code changes
PCI Security Standards Council - SAQ-A
PCI DSS self-assessment questionnaire scope definition for merchants using a validated, iframe-isolated payment provider

# 2. Solution Overview

## 2.1 Business Context
The client wants to offer PayPal - both the PayPal Wallet (login/redirect) and card payments - as a payment option on the storefront. The business has decided to build a purpose-built App Builder module that talks directly to PayPal's own Orders v2 REST API and JavaScript SDK. This keeps the integration entirely headless and App Builder-centric: no Commerce code is written or deployed; all custom logic lives in App Builder, wired into Commerce through out-of-process payment method webhooks (for refund/void) and Adobe I/O Events (for downstream email/ERP sync).

## 2.2 Integration Approach
The integration is built from four complementary building blocks:
PayPal JavaScript SDK (client-side capture): Loaded with both the buttons and card-fields components so the shopper can choose PayPal Wallet or enter card details. Card Fields are PayPal-hosted (PCI SAQ-A eligible) and include 3-D Secure handling internally - no separate 3DS implementation is required. Neither card data nor PayPal login credentials ever reach the EDS runtime, API Mesh, or App Builder.
API Mesh (GraphQL gateway): The EDS storefront talks to a single, unified GraphQL endpoint. API Mesh aggregates the native ACCS Commerce GraphQL API together with the custom App Builder PayPal checkout actions (create order, authorize payment) into one schema.
App Builder (Adobe I/O Runtime) - custom PayPal module: All PayPal logic - creating orders, authorizing/capturing payment, handling PayPal's own webhook notifications, and processing refunds/voids - runs as serverless App Builder actions (create-paypal-order, authorize-payment, refund-payment). This is the only place custom code executes; Commerce itself is never modified. App Builder drives this flow end-to-end: it authorizes payment with PayPal first, and only then writes the payment status and places the order in ACCS.
ACCS Out-of-Process Payment Method Webhook & Adobe I/O Events: PayPal is registered on ACCS for refund/void purposes via a webhook subscription - no code deployment. Commerce Admin credit-memo actions trigger the App Builder refund-payment action through this channel. Separately, ACCS emits Adobe I/O Events (order placed, invoice created) that App Builder Event Consumers subscribe to, for SFMC email and MuleSoft/NetSuite sync.
aio-lib-state (App Builder's managed key-value state store) is used for order/payment status tracking, idempotency keys, and transaction cross-references - the same role it plays in the other payment integrations.

## 2.3 Key Design Principles
No Commerce code or database access: all custom logic lives in App Builder.
Security first: no cardholder data or PayPal credentials touch the EDS storefront runtime, API Mesh, or App Builder at any point; 3-D Secure is entirely PayPal's responsibility.
Payment before order: the order is only created in ACCS once PayPal has confirmed authorization (or capture), avoiding orders with unconfirmed payment status.
Single storefront entry point: EDS calls only API Mesh, which proxies both Commerce and App Builder PayPal operations.
Reuse, don't duplicate: SFMC email and MuleSoft/NetSuite order sync are handled by common App Builder event consumers, decoupled from the payment-specific actions.
Environment parity: Integration, Staging, and Production use isolated PayPal REST API credentials (Sandbox vs. Live) and isolated App Builder workspaces.
Configurable capture strategy: Authorize-then-capture or immediate capture, selectable per business rule without code changes to the checkout flow itself.

# 3. Solution Architecture

## 3.1 Architecture Diagram
Figure 1: High-level solution architecture - PayPal Advanced Checkout (custom App Builder module) across EDS, API Mesh, App Builder, PayPal, ACCS (SaaS), MuleSoft/NetSuite, and SFMC

### Flow Legend
1. Customer browses the EDS storefront and reaches checkout (edge-rendered pages served via Adobe's CDN).
2. The checkout block loads the PayPal JavaScript SDK in the browser (buttons + card-fields components); this is the only client-side, browser-direct path for card entry and PayPal login - everything else goes through API Mesh.
3. The EDS storefront sends all GraphQL requests to the single API Mesh endpoint - it never calls App Builder or ACCS directly.
4. API Mesh routes PayPal checkout operations (create order, authorize payment) to the App Builder module, and receives the response the same way (4r).
5. The App Builder create-paypal-order and authorize-payment actions call PayPal's Orders v2 API (Create / Authorize / Capture).
6. PayPal's own asynchronous Webhooks (payment capture/refund notifications) are delivered directly to the App Builder Webhook Notification Handler.
7. Commerce Admin refund/void actions (via credit memo) trigger ACCS's registered out-of-process payment webhook, invoking the App Builder refund-payment action.
8. Once payment is authorized (or captured), App Builder writes the payment status onto the order and places the order in ACCS - in that order. The order is never created before payment is confirmed.
9. App Builder event consumers call the SFMC Transactional Messaging API to send order confirmation, payment receipt, refund, or decline emails.
10. App Builder triggers the MuleSoft/NetSuite ERP synchronisation.
Note: PCI DSS scope is SAQ-A: card entry happens inside PayPal-hosted Card Fields, and 3-D Secure is handled entirely by PayPal - neither card data nor authentication challenges are ever seen by ACCS, App Builder, or API Mesh. Order placement here is App Builder-driven and happens only after payment authorization succeeds, rather than ACCS creating the order first and calling out to authorize payment mid-checkout.

## 3.2 Component Description
Component
Responsibility
Storefront - Edge Delivery Services (EDS)
Content-driven, edge-rendered storefront pages; hosts the checkout block that embeds the PayPal JavaScript SDK (Buttons + Card Fields).
API Mesh - Unified GraphQL Gateway
Single GraphQL endpoint consumed by the storefront; aggregates the ACCS Commerce API and the App Builder PayPal checkout actions into one schema.
Adobe App Builder - Custom PayPal Module
Hosts all PayPal logic as serverless actions: create-paypal-order, authorize-payment, refund-payment, a Webhook Notification Handler for PayPal's own async events, plus the reused Event Consumers and aio-lib-state.
create-paypal-order
Calls PayPal's Orders v2 API to create an order with intent AUTHORIZE or CAPTURE, per configuration.
authorize-payment
Calls PayPal's Authorize or Capture endpoint once the buyer has approved payment (via Wallet or Card Fields).
refund-payment
Invoked via ACCS's out-of-process payment webhook when a refund/void is initiated from Commerce Admin; calls PayPal's Refund/Void API.
aio-lib-state
App Builder's managed key-value state store, used for idempotency keys, transaction cross-references, and order/payment status tracking. No cardholder data is stored here.
PayPal Orders v2 API
PayPal's REST API for creating, authorizing, capturing, and refunding orders.
PayPal JS SDK Components (Buttons + Card Fields)
Client-side components rendering the PayPal Wallet button and PayPal-hosted card entry fields (PCI SAQ-A eligible).
3-D Secure (internal to PayPal)
Strong Customer Authentication handled entirely within the Card Fields component; no separate 3DS implementation is required.
PayPal Webhooks
PayPal's own asynchronous notification channel for payment capture/refund events, delivered directly to the App Builder Webhook Notification Handler.
Adobe Commerce as a Cloud Service (SaaS)
Headless SaaS commerce engine: Commerce GraphQL API, out-of-process payment method webhook subscription (refund/void only), Commerce Admin, Adobe I/O Events, and the fully managed order/catalog data store.
MuleSoft Anypoint Platform / NetSuite (ERP)
Order synchronisation to NetSuite, returning a netsuite_order_id written back onto the ACCS order.
Salesforce Marketing Cloud (SFMC)
Sends transactional emails via its Transactional Messaging API, triggered by App Builder event consumers.

## 3.3 Why Order Placement Is App Builder-Driven
A common pattern for payment integrations is to let ACCS create the order first, then call out to App Builder synchronously (via an out-of-process payment webhook) to authorize payment as part of that order creation. This design deliberately does not follow that pattern for the primary checkout flow: App Builder creates the PayPal order, drives the buyer through approval (Wallet or Card Fields, with 3DS handled internally by PayPal), and only calls ACCS to write the payment status and place the order once PayPal has confirmed authorization or capture. This avoids ACCS ever holding an order in an ambiguous payment-pending state, and matches the client's own reference sequence for this integration. Refunds and voids, which happen after the order already exists, still use the standard out-of-process payment webhook pattern (ACCS calling out to App Builder).

## 3.4 Alternative Considered: ACCS-First Order Creation
As an alternative, ACCS could instead create the order first (in a pending-payment state) and call App Builder synchronously to authorize payment as part of that creation - a webhook-first pattern. This was not selected for this design because it would require ACCS to represent and manage an intermediate “pending payment” order state, adding complexity for a scenario (PayPal Wallet redirect/popup approval) where the buyer's approval genuinely happens before the merchant can know the outcome. The App Builder-driven, payment-first approach is simpler and matches the client's own reference design. This should be revisited if the client's order state model requires a single, uniform order-creation pattern across all payment methods.

## 3.5 Sequence Diagram
The sequence diagram below shows the same end-to-end flow as Figure 1, laid out in time order across the seven participants: Customer, EDS Storefront, API Mesh, App Builder, PayPal, ACCS (SaaS), and SFMC. It is organised into four phases - PayPal order creation, SDK loading and payment method selection (Wallet or Card Fields, with 3-D Secure handled internally by PayPal), order placement and payment authorization, and the later refund/void flow via the reused webhook pattern - with alt frames marking each success/failure branch and retry path, based on the client's own reference sequence diagram.
Figure 2: Sequence diagram - PayPal order creation, Wallet/Card Fields selection with internal 3DS, App Builder-driven authorization and order placement, and reused refund/void

# 4. Detailed Design

## 4.1 Payment Methods
PayPal Wallet (login/redirect or popup), via the PayPal JS SDK Buttons component.
Visa, Mastercard, American Express, Discover (subject to PayPal eligibility and the client's account configuration), via PayPal's Card Fields component.
Currency and country support aligned to the client's PayPal business account configuration and PayPal's Advanced Checkout eligibility (36+ countries, 22+ currencies at time of writing - to be reconfirmed at build time).

## 4.2 PayPal Order Creation
When the customer reaches checkout and selects PayPal as the payment option, the EDS storefront calls the create-paypal-order App Builder action (via API Mesh), passing cart/amount details.
The action calls PayPal's Create Order endpoint (POST /v2/checkout/orders) with intent set to AUTHORIZE or CAPTURE, per the configured capture strategy (Section 4.5).
On success, the orderID (and any card-fields session data needed to render hosted fields) is returned to the storefront. On failure, the storefront shows an error with a retry option, consistent with the client's reference sequence.

## 4.3 Loading the SDK & Payment Method Selection
The checkout block loads the PayPal JavaScript SDK with both the buttons and card-fields components enabled, so the shopper can choose either payment path.
PayPal Wallet path: Selecting the PayPal button opens a redirect or popup login; the buyer logs into PayPal and approves the payment, returning a payerID and orderID to the storefront.
Card Fields path: The buyer enters card details into PayPal-hosted Card Fields (PCI SAQ-A eligible). On submission, PayPal validates the card and, if required, runs 3-D Secure entirely within the Card Fields component - the storefront only needs to handle the success or failure outcome, not the 3DS challenge itself.
Card validation errors are surfaced to the buyer with a retry option; 3DS authentication failures are surfaced with an option to retry or choose a different payment method.

## 4.4 Authorization & Capture (App Builder-Driven)
Once the buyer has approved payment (Wallet) or completed card entry and any 3DS challenge (Card Fields), the storefront calls the authorize-payment App Builder action with the orderID.
The action calls PayPal's Authorize endpoint (POST /v2/checkout/orders/{id}/authorize) if intent was AUTHORIZE, or the Capture endpoint (POST /v2/checkout/orders/{id}/capture) if intent was CAPTURE.
On success, App Builder writes the payment status onto the order (via the out-of-process payment extension API) and then places the order in ACCS (createOrder/placeOrder) - in that order, so no order exists in ACCS without confirmed payment.
On authorization failure, the design supports either a retry (if the failure is retryable, e.g., a transient PayPal error) or a hard failure message to the shopper, per the client's reference sequence.

## 4.5 Capture Strategy Configuration
Authorize-then-capture: intent = AUTHORIZE at order creation; authorize-payment calls PayPal's Authorize endpoint; a later, separate action (triggered by an ACCS invoice/shipment event, reusing the established event-consumer pattern) calls PayPal's Capture Authorized Payment endpoint.
Immediate capture: intent = CAPTURE at order creation; authorize-payment calls PayPal's Capture endpoint directly, combining authorization and capture in one step.
The strategy is a configuration setting in the App Builder module, not a code branch in the storefront - the EDS checkout flow is identical either way.

## 4.6 Refunds & Voids
Full or partial refunds initiated from Commerce Admin (credit memo) trigger ACCS's registered out-of-process payment webhook, invoking the App Builder refund-payment action.
refund-payment calls PayPal's Refund API (for captured payments) or Void/Authorization-cancel API (for authorizations not yet captured), depending on transaction state.
The result is returned to ACCS via the webhook response, and the transaction record in aio-lib-state is updated accordingly.

## 4.7 Asynchronous Webhook Notifications & Events
This design distinguishes two different asynchronous mechanisms, both of which terminate in App Builder:
PayPal Webhooks: PayPal's native asynchronous notification channel (payment capture completed, refund processed, dispute created), delivered directly to a dedicated App Builder action. Signature validation happens entirely within App Builder using PayPal's webhook verification API.
ACCS Adobe I/O Events: Emitted by ACCS for order/payment lifecycle milestones (order placed, invoice created, credit memo created); App Builder Event Consumers subscribe to these to trigger SFMC email and MuleSoft/NetSuite sync.

## 4.8 Transactional Email & ERP Sync
App Builder Event Consumers, MuleSoft Anypoint Platform order sync, and the SFMC Transactional Messaging integration react to the ACCS order-placed event to send confirmation emails and synchronise the order to NetSuite, independent of the payment authorization logic described above.

## 4.9 aio-lib-state Usage
Idempotency tracking: request/response fingerprints for create-paypal-order, authorize-payment, and refund-payment calls, to safely handle retries.
Transaction cross-reference: mapping between the ACCS order number and the PayPal order/transaction ID.
Order/payment status tracking: recording the outcome of PayPal authorization before the corresponding ACCS order exists, since order placement happens after payment confirmation in this design.
No cardholder data or PayPal credentials are ever written to aio-lib-state.

## 4.10 Configuration Management
Setting
Description
Managed In
PayPal Client ID / Client Secret
PayPal REST API credentials per environment (Sandbox for Integration/Staging, Live for Production)
App Builder secrets (encrypted action parameters) per environment
PayPal OAuth Access Token
Short-lived server-to-server token obtained via Client Credentials grant, cached and refreshed by App Builder
Generated at runtime by App Builder actions; not persisted long-term
Capture Strategy (intent)
AUTHORIZE (deferred capture) vs. CAPTURE (immediate), configurable per business rule
App Builder action configuration
Out-of-Process Payment Method Webhook Subscription
Maps the ACCS refund/void webhook to the App Builder refund-payment action URL
Commerce Admin: System > Webhooks > Webhooks Subscriptions (SaaS, no code)
Adobe I/O Event Registrations
Subscriptions for order/invoice/credit-memo events consumed by App Builder
Adobe Developer Console (App Builder project)
PayPal Webhook Registration
Registered against the App Builder Webhook Notification Handler's endpoint URL
PayPal Developer Dashboard
SFMC API Credentials & Message Definitions
Server-to-server credentials and triggered-send/message IDs for transactional emails
App Builder secrets + SFMC Marketing Cloud configuration

# 5. Security & Compliance (PCI DSS)

## 5.1 PCI DSS Scope
Both payment paths qualify for PCI SAQ-A, the least burdensome PCI DSS self-assessment category. Card entry via PayPal's Card Fields happens inside PayPal-hosted iframes that the EDS storefront cannot access, and 3-D Secure is handled entirely within that same component; PayPal Wallet payments never involve card data at all, since the buyer authenticates directly with PayPal. Formal scope determination should still be validated with the client's Qualified Security Assessor (QSA) or acquiring bank.

## 5.2 Data Protection
No Primary Account Number (PAN), CVV, or PayPal login credentials are stored, logged, or transmitted through the EDS storefront, API Mesh, App Builder, aio-lib-state, or ACCS at any point.
ACCS stores only the PayPal order/transaction ID and payment method type against the order - not card data.
All communication (browser-to-PayPal, API Mesh-to-App Builder, App Builder-to-PayPal, App Builder-to-ACCS) is encrypted in transit using TLS 1.2 or higher.

## 5.3 API Authentication
Server-to-server calls from App Builder to PayPal's Orders v2 API are authenticated using an OAuth 2.0 access token obtained via the Client Credentials grant (Client ID + Secret).
Calls between App Builder, API Mesh, and ACCS use Adobe IMS OAuth service-to-service authentication, consistent with the other payment integrations.
ACCS-to-App Builder webhook calls (for refund/void) are validated using the Commerce Webhooks digital signature mechanism.
PayPal webhook notifications are verified using PayPal's webhook signature verification API before being processed.
Credentials are scoped per environment (Sandbox for Integration/Staging, Live for Production) and rotated on a defined schedule.

## 5.4 Secrets Management
All PayPal, SFMC, and Adobe IMS credentials are stored as encrypted App Builder action parameters/secrets - never in Commerce configuration, since no code or configuration is deployed to Commerce for this integration. Access to Production environment credentials is restricted to a limited set of authorised release engineers via the Adobe Developer Console.

# 6. Monitoring & Logging
Transaction-level logging (request/response metadata excluding sensitive fields) for every create-paypal-order, authorize-payment, and refund-payment invocation, persisted in aio-lib-state and/or App Builder's logging/monitoring integration.
Specific monitoring for orders that were successfully authorized with PayPal but not yet placed in ACCS (the intermediate state described in Section 6.2), with alerting if this state persists beyond an expected threshold.
PayPal's own dashboard provides transaction, settlement, and dispute reporting independent of App Builder logs.
Alerting is configured for elevated decline rates, App Builder action error spikes, or webhook processing failures, routed to the operations/support team.

# 7. Error Handling & Exception Scenarios
Scenario
Handling Approach
PayPal order creation fails
The storefront shows an error message with a retry option, per the client's reference sequence; App Builder logs the failure.
Card validation error (Card Fields)
PayPal returns a validation error to the Card Fields component; the storefront prompts the buyer to retry input.
3-D Secure authentication failure
PayPal returns an authentication-failed result; the storefront prompts the buyer to retry or choose a different payment method. App Builder is not involved in this exchange, since 3DS is handled entirely within the Card Fields component.
Authorization/capture failure - retryable
App Builder signals that retry is allowed; the storefront prompts the buyer to retry authorization without re-entering payment details, per the client's reference sequence.
Authorization/capture failure - hard failure
App Builder signals a hard failure; the storefront shows a terminal failure message and the buyer must choose a different payment method.
Payment authorized but order placement in ACCS fails
App Builder retries order placement (using the already-confirmed PayPal authorization/capture) without re-authorizing payment; if placement continues to fail, the shopper is shown a retry/contact-support message and operations is alerted, since payment has already been taken.
Duplicate submission (double-click / retry)
Idempotency key (tracked in aio-lib-state) ensures PayPal and ACCS both treat retried requests as the original operation rather than creating duplicate charges or orders.
ACCS refund/void webhook call to App Builder fails/times out
ACCS applies its own webhook failure policy; App Builder logs the failure and alerts operations.
PayPal webhook signature validation failure
Rejected by the App Builder Webhook Notification Handler and logged as a security event; does not update order status.
Refund exceeds captured amount
Rejected by the App Builder refund-payment action with a validation error before calling PayPal's Refund API.
MuleSoft/NetSuite or SFMC failure
Decoupled from checkout, retried with backoff, tracked in aio-lib-state.

# 8. Testing Strategy

## 8.1 Test Environments
All functional and integration testing is performed against the PayPal Sandbox environment using PayPal sandbox buyer/business accounts and test card numbers, together with dedicated Integration and Staging App Builder workspaces, prior to promotion to Production with live credentials.

## 8.2 Test Scenarios
Category
Representative Test Cases
Order creation
Successful order creation (both intents); order creation failure with retry.
PayPal Wallet - happy path
Successful login/redirect approval and order placement.
Card Fields - happy path
Successful card entry, tokenization, and authorization; both AUTHORIZE and CAPTURE intents.
Card Fields - errors
Invalid card number, expired card, validation errors, retry input.
3-D Secure
Frictionless success (no challenge); challenge success; challenge/authentication failure with retry or method change - all handled internally by PayPal, verifying only the outcome reaches the storefront correctly.
Authorization outcomes
Success (order placed); retryable failure (retry authorization); hard failure (terminal message).
Order placement after payment
Successful placement; placement failure with retry using the existing confirmed payment (no duplicate charge).
Refunds & voids
Full refund, partial refund, void before capture, refund exceeding captured amount (expected rejection) - via the webhook pattern.
Webhooks
Valid PayPal webhook notification processed; invalid/unsigned notification rejected. Valid signed ACCS webhook processed; invalid/unsigned webhook rejected.
Coexistence with other payment methods
If other payment methods are configured on the storefront, PayPal appears correctly alongside them, and placing an order with any method does not affect the others' configuration or reporting.
ERP/email flow
Order confirmation email and NetSuite sync fire correctly for orders placed via PayPal.
Regression
Cross-browser/device checkout validation of the Buttons and Card Fields components; multi-currency scenarios.

# 9. Deployment & Rollout Plan
1. Create/confirm the PayPal Business account and obtain Sandbox and Production REST API credentials (Client ID and Secret).
2. Confirm Advanced (Expanded) Credit and Debit Card Payments is enabled on the PayPal business account.
3. Provision the App Builder workspace and API Mesh instance for Integration, Staging, and Production environments.
4. Develop the App Builder actions: create-paypal-order, authorize-payment, refund-payment, and the PayPal Webhook Notification Handler.
5. Register the out-of-process payment method webhook subscription in Commerce Admin (System > Webhooks > Webhooks Subscriptions) for refund/void, pointing at the Integration App Builder action URL - no code deployment to Commerce.
6. Confirm Adobe I/O Event registrations fire correctly for PayPal-originated orders.
7. Extend the existing API Mesh configuration to expose the PayPal checkout actions through the unified GraphQL schema.
8. Update the EDS checkout block to load the PayPal JavaScript SDK (buttons + card-fields) alongside the existing payment options.
9. Register the PayPal webhook endpoint in the PayPal Developer Dashboard, pointed at the App Builder Webhook Notification Handler.
10. Execute the full test scenario pack (Section 8.2) in the Staging environment, including the App Builder-driven order placement failure/retry scenarios.
11. Conduct UAT with business stakeholders and obtain formal sign-off.
12. Perform a security/PCI review confirming SAQ-A applicability with the QSA or acquiring bank.
13. Deploy the App Builder application to Production and switch to live PayPal credentials during a low-traffic maintenance window.
14. Execute a smoke test in Production using a small set of low-value live transactions (Wallet and Card Fields, both capture strategies if both are used) before full traffic cutover.
15. Monitor authorization success rates, the intermediate authorized-but-not-yet-placed order state, and webhook processing for an initial hypercare period (recommended 2 weeks) post go-live.

## 9.1 Rollback Plan
Because this integration is entirely App Builder-based with no Commerce code changes, rollback does not require any Commerce deployment or rollback. If critical issues are identified post-deployment, the previous App Builder action version can be re-deployed, or the PayPal payment option can be temporarily hidden/disabled in the storefront configuration and the Commerce webhook subscription disabled in Admin, without touching Commerce configuration or code - leaving the other configured payment methods active while an issue is investigated.

# 10. Risks & Mitigations
Risk
Impact
Mitigation
Order authorized with PayPal but never placed in ACCS (e.g., App Builder crash between the two steps)
High
Track the intermediate state in aio-lib-state; implement a reconciliation job/alert that detects authorized-but-unplaced orders and either completes placement or triggers a manual refund.
Incomplete PCI scope validation before go-live
High
Engage QSA/acquirer early; validate SAQ-A applicability during design phase, not post-launch.
PayPal merchant account not fully verified for Production, or Advanced Checkout not enabled
Medium
Confirm Production account verification and Advanced Checkout eligibility with PayPal early, in parallel with development.
Duplicate charges or duplicate orders from retried requests
High
Idempotency keys enforced on all create-paypal-order/authorize-payment/refund-payment calls and tracked in aio-lib-state.
ACCS webhook or Adobe I/O Event delivery failure/spoofing
Medium
Mandatory signature validation on all inbound webhooks/events; reject unsigned/invalid payloads; monitor for delivery failures.
PayPal webhook signature validation misconfigured
Medium
Test webhook signature verification thoroughly in Sandbox before go-live; monitor rejection rates post-launch.
Key/credential leakage (PayPal, SFMC, Adobe IMS)
High
Secrets stored only as encrypted App Builder parameters; access restricted and audited via Adobe Developer Console.
Conflicts with other payment methods that may be configured on the storefront
Medium
Test all payment methods together in Staging; confirm checkout UI clearly differentiates them for the shopper.
Scope creep (Pay Later, Venmo, vaulting) during build
Medium
Change control process; explicit reference to Section 1.2 Out of Scope items.

# 11. Roles & Responsibilities (RACI)
Activity
Client Business
Client IT/Security
Adobe Commerce Partner
PayPal
PayPal business account setup & Advanced Checkout enablement
A
C
R
R
Solution design & architecture (this document)
C
C
R/A
C
App Builder action development (create-paypal-order, authorize-payment, refund-payment)
I
I
R/A
C
Out-of-process payment webhook configuration
I
C
R/A
I
API Mesh resolver configuration
I
I
R/A
I
EDS checkout block updates
I
I
R/A
I
PCI DSS scope validation / SAQ
A
R
C
C
QA / UAT execution
R
C
R
I
Production deployment (App Builder)
I
A
R
I
Post-launch monitoring & support
I
C
R
C
R = Responsible, A = Accountable, C = Consulted, I = Informed

# 12. Appendix

## A. Glossary
Term
Definition
ACCS (SaaS)
Adobe Commerce as a Cloud Service - the client's fully managed, headless SaaS commerce backend, with no developer access to application code or database.
EDS
Edge Delivery Services - Adobe's content-driven, edge-rendered storefront framework used as the front-end delivery channel.
API Mesh
Adobe's GraphQL aggregation service; combines the ACCS Commerce API and the App Builder PayPal checkout actions into a single schema.
App Builder
Adobe Developer platform (built on Adobe I/O Runtime) that hosts all custom serverless business logic for this integration.
PayPal Advanced (Expanded) Checkout
PayPal's integration model using the JavaScript SDK's Buttons and Card Fields components together with the Orders v2 REST API.
Orders v2 API
PayPal's REST API for creating, authorizing, capturing, and refunding orders (/v2/checkout/orders and related endpoints).
Card Fields
PayPal-hosted, PCI-isolated card entry fields provided by the PayPal JavaScript SDK, including internal 3-D Secure handling.
Buttons
The PayPal JavaScript SDK component that renders the PayPal Wallet payment button (login/redirect or popup).
Out-of-process payment method
Adobe Commerce's SaaS-native extensibility pattern for payment methods: registered via a webhook subscription, with all business logic external to Commerce (in App Builder).
create-paypal-order / authorize-payment / refund-payment
The three App Builder actions implementing PayPal order creation, authorization/capture, and refund/void respectively.
aio-lib-state
App Builder's managed key-value state store, used here for idempotency keys, transaction cross-references, and order/payment status tracking.
3-D Secure (3DS)
Card network protocol for strong customer authentication; handled entirely within PayPal's Card Fields component for this integration.
SAQ-A
The least burdensome PCI DSS Self-Assessment Questionnaire category, applicable when the merchant's page never receives, processes, or stores cardholder data.
intent (AUTHORIZE vs. CAPTURE)
The PayPal Orders v2 API parameter controlling whether an order is authorized only (capture deferred) or authorized and captured immediately.

## B. PayPal API Endpoints (Representative)
Operation
Representative Endpoint
Create Order
POST /v2/checkout/orders
Authorize Order
POST /v2/checkout/orders/{id}/authorize
Capture Order
POST /v2/checkout/orders/{id}/capture
Capture Authorized Payment (deferred capture)
POST /v2/payments/authorizations/{authorization_id}/capture
Refund Captured Payment
POST /v2/payments/captures/{capture_id}/refund
Void Authorization
POST /v2/payments/authorizations/{authorization_id}/void
OAuth 2.0 Access Token
POST /v1/oauth2/token (Client Credentials grant)
Note: Exact endpoint paths and payload structures should be confirmed against the current PayPal Orders v2 API reference documentation at build time. These endpoints are called exclusively from App Builder actions, never from ACCS or the EDS storefront directly.

## C. Sample Create Order Request (Illustrative, Simplified)
{  "intent": "AUTHORIZE",  "purchase_units": [    {      "reference_id": "<ACCS-cart-id>",      "amount": { "currency_code": "USD", "value": "125.00" }    }  ]}
This is an illustrative, simplified example for design reference only and does not reproduce PayPal's developer documentation verbatim. The intent field is set to CAPTURE instead if immediate capture is configured (Section 4.5).
