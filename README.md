<div align="center">

# Seller Service

### Seller onboarding workflow with draft saving, submit validation, and Kafka notification events.

NestJS 11 · TypeScript · PostgreSQL · TypeORM · Kafka · Axios · Swagger · Helmet

</div>

---

## The Problem

Turning a buyer account into a seller account is not a single form submit. A real marketplace needs draft saving, identity information, pickup address validation, payout data, category checks, duplicate shop slug protection, and a review state before seller privileges are granted.

Seller Service owns that workflow and keeps the seller application lifecycle separate from Auth, Catalog, Location, and future Shop/Product services.

---

## See It Work

The service is normally called through API Gateway, which injects authenticated user headers.

```bash
cd services/seller-service
cp .env.example .env
npm run dev
```

Example direct local request:

```bash
curl -X PATCH "http://localhost:3007/api/v1/seller/applications/me" \
  -H "Content-Type: application/json" \
  -H "x-user-id: 226123a7-91de-4738-b7b1-c39f1caab780" \
  -H "x-user-email: seller@example.com" \
  -d '{
    "shop": {
      "name": "Bin Tech Store",
      "slug": "bin-tech-store",
      "mainCategoryId": "REPLACE_WITH_CATEGORY_UUID",
      "businessModel": "retail",
      "description": "Official electronics and accessories store."
    }
  }'
```

Submit for review:

```bash
curl -X POST "http://localhost:3007/api/v1/seller/applications/submit" \
  -H "Content-Type: application/json" \
  -H "x-user-id: 226123a7-91de-4738-b7b1-c39f1caab780" \
  -H "x-user-email: seller@example.com" \
  -d '{ "acceptedTerms": true }'
```

Swagger is available in development at:

```text
http://localhost:3007/docs
```

---

## Quick Start

```bash
cd services/seller-service
cp .env.example .env
npm install
npm run dev
```

Required local infrastructure:

```text
PostgreSQL database: bin_ecommerce_seller
Kafka broker:        localhost:29092
Catalog Service:     http://localhost:3003
Location Service:    http://localhost:3006
Default port:        3007
API prefix:          /api/v1
```

---

## Trust And Operations

| Concern | How this service handles it |
| --- | --- |
| Authentication | The service trusts `x-user-id`, `x-user-email`, and role headers injected by API Gateway. It does not accept user identity from request body. |
| Network calls | Submit validation calls Catalog Service and Location Service. Kafka is used to publish notification events. |
| Database writes | Saves seller application drafts and status transitions in `seller_applications`. |
| Sensitive data | Stores identity and payout application data. Do not expose this service directly to browsers in production. |
| Failure behavior | Kafka publish failures are logged and do not crash the submit flow. Catalog/location validation failures return business-friendly errors. |
| Reversibility | A local application can be reset by deleting rows from `seller_applications` or resetting the seller database. |

---

## API Reference

All routes are served under `/api/v1`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/seller/applications/me` | Get the current user's seller application or `null`. |
| `PATCH` | `/seller/applications/me` | Save a draft. Any subset of form sections can be saved. |
| `POST` | `/seller/applications/submit` | Validate the full application, mark it `pending_review`, and publish Kafka notification event. |

Required gateway-injected headers:

| Header | Purpose |
| --- | --- |
| `x-user-id` | Authenticated user UUID. |
| `x-user-email` | User email used for notification and audit. |
| `x-user-roles` | Optional comma-separated roles for future admin/seller workflows. |

---

## Application Lifecycle

```text
draft
  -> pending_review
  -> approved
  -> rejected
```

Current behavior:

- A user can create or update a `draft`.
- A `rejected` application can be edited and submitted again.
- A `pending_review` or `approved` application cannot be edited by the seller.
- Admin review endpoints are intentionally not part of this service version yet.

---

## Validation Rules

<details>
<summary><b>Shop section</b></summary>

| Field | Rule |
| --- | --- |
| `name` | 3-120 characters. |
| `slug` | 3-140 characters, lowercase kebab-case. |
| `mainCategoryId` | UUID and must exist in Catalog Service. |
| `businessModel` | `retail`, `brand`, or `distributor`. |
| `description` | Max 1000 characters. |
| `logoUrl` | Optional absolute URL. |

</details>

<details>
<summary><b>Seller identity section</b></summary>

| Field | Rule |
| --- | --- |
| `profileType` | `individual` or `business`. |
| `legalName` | 2-180 characters. |
| `citizenId` | Required for individual profile, 9 or 12 digits. |
| `taxCode` | Required for business profile, 10 or 13 digits. |
| `representativeName` | 2-160 characters. |
| `representativeRole` | Optional, max 120 characters. |
| `phone` | Vietnamese phone number, `0...` or `+84...`. |
| `email` | Valid email address. |

</details>

<details>
<summary><b>Pickup and payout sections</b></summary>

Pickup address:

| Field | Rule |
| --- | --- |
| `contactName` | 2-160 characters. |
| `phone` | Vietnamese phone number. |
| `provinceId` | UUID and must exist in Location Service as `province`. |
| `wardId` | UUID and must exist in Location Service as `ward` under selected province. |
| `addressLine` | Required, max 500 characters. |

Payout:

| Field | Rule |
| --- | --- |
| `bankCode` | Required, max 60 characters. |
| `bankName` | 2-120 characters. |
| `accountNumber` | 6-30 digits. |
| `accountHolderName` | 2-180 characters. |
| `accountType` | `personal` or `business`. |
| `branch` | Optional, max 160 characters. |

</details>

---

## Integration Flow

```text
Frontend Seller Register
  -> API Gateway validates JWT
  -> API Gateway injects x-user-* headers
  -> Seller Service saves draft
  -> Seller Service validates Catalog and Location on submit
  -> Seller Service writes pending_review
  -> Seller Service publishes Kafka event
  -> Notification Service sends email: application submitted
```

Kafka topic constants live in the shared package:

```ts
import { SellerEvents } from "@common/kafka/events";
```

The submit event payload includes:

```json
{
  "userId": "226123a7-91de-4738-b7b1-c39f1caab780",
  "email": "seller@example.com",
  "applicationId": "8a2372f4-f4d8-48c9-a8de-b0c6d20e97ea",
  "shopName": "Bin Tech Store",
  "submittedAt": "2026-06-23T10:00:00.000Z"
}
```

---

## Data Model

`seller_applications` is intentionally application-oriented instead of shop-oriented. It stores the data needed to review and approve a seller before creating future shop, wallet, fulfillment, and seller-role records.

Important constraints:

| Constraint | Purpose |
| --- | --- |
| `UNIQUE(user_id)` | One active application per user. |
| `UNIQUE(shop_slug)` | Prevent public shop URL collisions. |
| `INDEX(status)` | Efficient admin review queues. |

Important groups:

| Group | Fields |
| --- | --- |
| User context | `user_id`, `user_email` |
| Shop | `shop_name`, `shop_slug`, `main_category_id`, `business_model`, `logo_url` |
| Identity | `profile_type`, `legal_name`, `citizen_id`, `tax_code`, `verification_documents` |
| Pickup | `pickup_contact_name`, `pickup_phone`, `pickup_province_id`, `pickup_ward_id`, `pickup_address_line` |
| Payout | `bank_code`, `bank_name`, `bank_account_number`, `bank_account_holder_name`, `bank_account_type` |
| Review | `status`, `submitted_at`, `reviewed_at`, `review_note` |

---

## Engineering Notes

- Nest global prefix and URI versioning are enabled: `/api/v1`.
- `ValidationPipe` uses `whitelist`, `forbidNonWhitelisted`, and implicit conversion.
- Helmet is configured through `common/config/helmet.config.ts`.
- CORS is disabled at the service level because browser traffic should enter through API Gateway.
- Kafka producer connection failure is non-fatal so local seller registration can still be developed without blocking on Kafka availability.
- Downstream Catalog and Location calls run only when submitting, not on every draft save.

---

## Scripts

```bash
npm run dev          # Start with Nest watch mode
npm run build        # Compile service
npm run start        # Run compiled service
npm run type-check   # TypeScript noEmit check
npm run lint         # ESLint over src
npm run test         # Jest
```

---

## Environment

See [.env.example](./.env.example).

Production should inject these variables per service through Secret Manager, Kubernetes Secret, ECS Task Definition, or CI/CD secrets. Do not reuse the root local Docker `.env` as a production secret source.

