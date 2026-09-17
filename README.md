<div align="center">
  <img src="https://raw.githubusercontent.com/Bin-E-Commerce/Bin-E-Commerce-UI-Web/main/public/images/logo/logo_background_white.png" alt="Bin E-Commerce" width="220" />

  # Seller Service

  Turn a seller application into a trusted shop with verified ownership, safe profile changes, and shipping-ready operations.

  <p>
    <img src="https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white" alt="NestJS 11" />
    <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.7" />
    <img src="https://img.shields.io/badge/PostgreSQL-336791?logo=postgresql&logoColor=white" alt="PostgreSQL" />
    <img src="https://img.shields.io/badge/TypeORM-FE0803?logo=typeorm&logoColor=white" alt="TypeORM" />
    <img src="https://img.shields.io/badge/Kafka-231F20?logo=apachekafka&logoColor=white" alt="Kafka" />
    <img src="https://img.shields.io/badge/Helmet-security-4B5563" alt="Helmet security headers" />
  </p>

  [Portfolio](https://daongocanh.site)
</div>

---

## Table of contents

1. [Problem](#1-problem)
2. [Service at a glance](#2-service-at-a-glance)
3. [Responsibility and boundaries](#3-responsibility-and-boundaries)
4. [Trust surface](#4-trust-surface)
5. [See it work](#5-see-it-work)
6. [Installation](#6-installation)
7. [Seller onboarding lifecycle](#7-seller-onboarding-lifecycle)
8. [Shop provisioning and ownership](#8-shop-provisioning-and-ownership)
9. [Compliance and sensitive changes](#9-compliance-and-sensitive-changes)
10. [Shipping settings and pickup addresses](#10-shipping-settings-and-pickup-addresses)
11. [Public shop experience](#11-public-shop-experience)
12. [Events and integrations](#12-events-and-integrations)
13. [Persistence model](#13-persistence-model)
14. [API reference](#14-api-reference)
15. [Project structure](#15-project-structure)
16. [Configuration](#16-configuration)
17. [Local development](#17-local-development)
18. [Testing](#18-testing)
19. [Security and data integrity](#19-security-and-data-integrity)
20. [Operations](#20-operations)
21. [FAQ](#21-faq)
22. [Ownership](#22-ownership)

---

## 1. Problem

Becoming a seller is a controlled business workflow, not a single role flag. A user must save an application, provide identity or business information, configure payout and pickup details, submit the application, wait for administrative review, and possibly correct specific sections before resubmitting.

After approval, the platform still needs a durable shop boundary. Public shop information, private compliance data, pickup addresses, shipping readiness, product ownership, and seller access must not be mixed together.

Seller Service owns these boundaries. It manages seller applications, approval state, shop provisioning, shop profile, compliance snapshots, sensitive profile change requests, public shop relationships, and shipping settings. Auth Service remains the authority for users and role assignment; Product Service remains the authority for products.

---

## 2. Service at a glance

| Property | Value |
| --- | --- |
| Runtime | Node.js with NestJS 11 |
| Language | TypeScript |
| Default HTTP port | 3007 |
| HTTP prefix | /api |
| URI version | /v1 |
| Database | PostgreSQL |
| ORM | TypeORM |
| Event integration | Kafka producer |
| HTTP security | Helmet |
| Health endpoint | GET /api/v1/health |
| API documentation | GET /docs outside production |
| Schema policy | Migrations only; synchronize is disabled |
| Main downstream services | Auth, Catalog, Location, Product, Shipping |

### What this service provides

- seller application drafts;
- application submission and resubmission;
- admin application list and detail review;
- approve and reject decisions;
- correction targets and review notes;
- shop creation from approved applications;
- private seller shop profile;
- compliance and payout data;
- controlled sensitive profile change requests;
- public shop list, detail, and follow/unfollow;
- shipping settings and preparation windows;
- pickup address CRUD and default-address selection;
- shipping readiness for Product and Shipping integrations;
- Kafka events for application and shop profile changes;
- internal shop shipping lookup.

### What this service does not provide

- login, JWT issuance, or user role storage;
- product creation or product inventory;
- binary file storage;
- category taxonomy;
- shipment creation or carrier execution;
- payment settlement;
- public display of compliance documents or bank credentials.

---

## 3. Responsibility and boundaries

### Seller Service owns

| Area | Responsibility |
| --- | --- |
| Seller application | Draft, submit, resubmit, review state, correction targets |
| Onboarding data | Seller identity/business, contact, payout, pickup snapshot |
| Admin review | Approve/reject decisions, notes, reviewer identity, timestamps |
| Shop | Stable shop ID, owner, slug, status, public profile |
| Compliance | Verified legal, identity, tax, and payout snapshot |
| Sensitive changes | Tax, payout, and identity change requests |
| Public shop | Public shop listing, detail, follow relation, counters |
| Shipping settings | Preparation time, pickup window, enabled state |
| Pickup addresses | Shop-owned addresses and default address |
| Integration events | Application and shop profile lifecycle events |

### Other services own

| Concern | Owner | Seller Service interaction |
| --- | --- | --- |
| Authentication and roles | Auth Service | Reads trusted identity; emits approval handoff |
| Category taxonomy | Catalog Service | Validates application and shop category |
| Product listing | Product Service | Reads shop ownership and active-product count |
| Media assets | Media Service | Stores logo and document assets by reference |
| Address master data | Location Service | Validates GHN province, district, and ward mapping |
| Shipment execution | Shipping Service | Reads pickup address and readiness |
| Customer-facing routing | API Gateway / Web | Forwards authenticated context and renders responses |
| Notifications | Notification Service | Consumes seller application/profile events |

A shop is the stable cross-service reference. Product Service stores the shop ID and seller owner ID, while Seller Service remains the owner of shop lifecycle and ownership.

---

## 4. Trust surface

The service handles identity, legal information, bank information, shop ownership, and operational addresses. Its security boundary is therefore explicit:

- user identity is derived from trusted Gateway headers;
- seller routes never trust a user ID or shop ID submitted in the body;
- admin actions require the appropriate permission from the forwarded context;
- approved applications create or activate shop state through a transaction;
- Auth Service owns seller-role assignment and receives the approval event;
- sensitive profile changes are submitted as requests and are not applied immediately;
- profile changes use a compliance version to prevent approving a stale snapshot;
- internal shipping routes require x-internal-service-token;
- public shop responses exclude compliance and payout data;
- Kafka payloads exclude citizen IDs, bank account numbers, and identity-document content;
- DTO validation rejects unknown fields and invalid values;
- schema changes are applied by migration, never automatic synchronization.

<details>
<summary><b>Caller capabilities and data exposure</b></summary>

| Caller | Allowed operation |
| --- | --- |
| Authenticated user | Read and edit their own draft application |
| Applicant | Submit or resubmit their own application |
| Admin with review permission | List, inspect, approve, and reject applications |
| Approved seller | Read and update their own public shop profile |
| Approved seller | Manage their own shipping settings and pickup addresses |
| Approved seller | Submit sensitive profile change requests |
| Admin with compliance permission | Review and approve or reject sensitive changes |
| Public visitor | Read active public shops and public shop details |
| Authenticated customer | Follow or unfollow a public shop |
| Product Service | Read active product count and shipping readiness |
| Shipping Service | Read a shop's default pickup address and readiness |

A public or seller response must never include raw verification documents, bank account numbers, tax identifiers, or private internal service credentials unless a narrowly authorized admin response explicitly requires a masked representation.

</details>

---

## 5. See it work

### Start the service

~~~powershell
cd services/seller-service
Copy-Item .env.example .env
npm install
npm run dev
~~~

### Check health

~~~powershell
curl http://localhost:3007/api/v1/health
~~~

Expected response shape:

~~~json
{
  "service": "seller-service",
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-09-16T08:00:00.000Z"
}
~~~

### Read the current application

~~~powershell
curl http://localhost:3007/api/v1/seller/applications/me -H "x-user-id: user-123" -H "x-user-email: seller@example.com"
~~~

### Read public shops

~~~powershell
curl "http://localhost:3007/api/v1/shops?page=1&pageSize=20"
~~~

### Read shipping settings

~~~powershell
curl http://localhost:3007/api/v1/seller/shipping/settings -H "x-user-id: seller-123"
~~~

A complete onboarding test saves a draft, submits it, reviews it with an admin context, verifies the approval event, and then reads the provisioned shop and shipping settings.

---

## 6. Installation

### Prerequisites

- Node.js version supported by the monorepo;
- npm or the repository package manager;
- PostgreSQL;
- Kafka for application and profile event publishing;
- Catalog Service for category validation;
- Location Service for address validation;
- Auth Service and API Gateway for trusted identity and permissions;
- Product Service when validating active product and shop ownership rules;
- Media Service when testing logo or document references.

### Install dependencies

From the repository root:

~~~bash
npm install
~~~

### Configure local environment

~~~powershell
Copy-Item .env.example .env
~~~

Set PostgreSQL credentials and service URLs. The local defaults point to:

- Seller Service on port 3007;
- Catalog Service on port 3003;
- Location Service on port 3006;
- Kafka broker on localhost:29092.

> [!IMPORTANT]
> Seller Service stores onboarding and shop data in PostgreSQL, publishes Kafka events, and calls Catalog and Location services during validation. Internal shipping routes are protected by a shared service token. No files are created outside the service workspace. Stop the process or container to disable it; remove only the dedicated development database to clear local seller data. Never use local sample credentials in production.

### Database migrations

Migrations run on startup and synchronize is disabled. Review the migration plan before production deployment, especially changes affecting GHN address codes, public shop indexes, and existing shop followers.

### Production build

~~~bash
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
npm run start
~~~

---

## 7. Seller onboarding lifecycle

~~~text
DRAFT
  -> PENDING_REVIEW
       -> APPROVED
       -> REJECTED
       -> correction targets -> corrected draft -> resubmitted
~~~

### Draft

A user can save a partial application. The current user is resolved from the authenticated context, so the frontend does not need to send a user ID.

Draft data can include:

- shop name and stable slug;
- main category and business model;
- shop description and logo reference;
- individual or business profile type;
- legal and representative information;
- contact information;
- verification-document references;
- pickup contact and address snapshot;
- payout bank information.

### Submission

Submission validates required fields and cross-service references before changing the application to pending_review.

The service records:

- submittedAt;
- submissionRevision;
- normalized data;
- review-ready status;
- an event payload that contains navigation and safe summary data only.

The submit event is published after the database write so Notification Service does not send a success message for a transaction that did not commit.

### Admin review

Admins can list and inspect applications, then approve or reject them. Rejection requires a review note. The service checks:

- admin identity;
- review permission;
- current application state;
- valid status transition;
- request payload and note.

### Correction and resubmission

A review can identify correction targets instead of treating the entire application as invalid. The applicant updates the required sections and resubmits.

The application stores correction snapshot hashes so the service can verify that the requested sections actually changed without copying another version of sensitive documents into the correction record.

### Approval

Approval:

1. verifies the application is still pending review;
2. records reviewer and review time;
3. creates or provisions the shop;
4. creates the verified compliance snapshot;
5. commits the state transaction;
6. publishes the seller-approved event.

Auth Service consumes the approval event and owns the seller-role assignment. Seller Service does not directly mutate Auth Service role storage.

---

## 8. Shop provisioning and ownership

### Stable shop identity

The Shop entity has:

- stable UUID;
- owner user ID;
- source seller application ID;
- unique public slug;
- public name, logo, and description;
- main category and business model;
- public contact values;
- active, suspended, or closed status;
- follower counters;
- verification timestamp.

Each seller account currently maps to one shop through a unique owner constraint. The application-to-shop relation is also unique, preventing duplicate shop provisioning from repeated approval handling.

### Ownership checks

Seller operations resolve the shop from the authenticated user. The API does not accept a seller-controlled shop ID as an authorization shortcut.

This is used by:

- shop profile reads and updates;
- shipping settings;
- pickup address operations;
- sensitive profile changes;
- product-related shipping readiness checks;
- internal service lookups.

### Shop status

| Status | Meaning |
| --- | --- |
| active | Shop can operate and appear in public listings |
| suspended | Shop exists but operational access or visibility is restricted |
| closed | Shop is no longer an active operating shop |

Shop status is independent from the original application status. An approved seller can later be suspended without rewriting the onboarding history.

### Profile updates

Public profile fields can be updated through the seller profile route. The service does not allow an ordinary profile patch to change:

- owner user ID;
- verification state;
- shop status;
- legal compliance snapshot;
- payout credentials.

Sensitive data follows the change-request workflow.

---

## 9. Compliance and sensitive changes

### Compliance snapshot

The compliance profile stores the currently verified version of:

- individual or business profile type;
- legal name;
- citizen ID or tax code;
- representative information;
- legal contact details;
- verification document references;
- bank and payout information;
- verification timestamp;
- compliance version.

Private responses should mask or omit sensitive values according to caller permission.

### Change-request workflow

Sensitive sections are grouped into:

- tax;
- payout;
- identity.

~~~text
seller submits requested changes
  -> PENDING_REVIEW
  -> admin compares current snapshot and requested changes
  -> APPROVED: apply atomically and increment version
  -> REJECTED: keep effective profile unchanged
  -> CANCELLED: close without applying
~~~

A request stores:

- shop and requester;
- sections being changed;
- current snapshot;
- normalized requested changes;
- base compliance version;
- seller note;
- reviewer identity and note;
- submitted and reviewed timestamps.

### Optimistic safety

The base compliance version prevents an admin from approving a request based on an obsolete snapshot. If the effective profile changed after submission, the request must be reviewed again rather than silently overwriting newer verified data.

### Audit behavior

Approval and rejection preserve the request record and decision metadata. Rejection requires a reason. The effective compliance profile is changed only inside the approved transaction.

---

## 10. Shipping settings and pickup addresses

Seller Service owns shop-level shipping readiness data needed by Product and Shipping integrations.

### Shipping settings

Settings include:

- default pickup address ID;
- whether onboarding address synchronization completed;
- preparation time in hours;
- pickup window start and end;
- enabled flag;
- update timestamp.

Carrier credentials belong to the platform/deployment boundary, not to a seller request.

### Pickup address

A pickup address stores:

- contact name and phone;
- GHN province, district, and ward identifiers;
- display names captured with the codes;
- detailed address line;
- default flag;
- timestamps.

Address values are validated against the current Location master-data contract. Storing both codes and names keeps historical display stable while codes remain the integration key.

### Default address rules

- a seller can choose one default pickup address;
- the default address is used by quote and shipment flows;
- an address used by active products cannot be removed until a replacement is selected;
- deleting an address must verify shop ownership;
- internal consumers receive the minimum required pickup data.

### Internal shipping routes

~~~text
GET /api/v1/internal/seller/shops/{shopId}/pickup-address
GET /api/v1/internal/seller/shops/{shopId}/shipping-readiness
x-internal-service-token: shared internal token
~~~

These routes do not return seller payout data or carrier credentials.

---

## 11. Public shop experience

Public endpoints expose only the shop information customers need:

- active shop list;
- shop detail by identifier;
- public name, logo, description, category, contact surface, and counters;
- whether the current viewer follows the shop when an authenticated user is present.

### Follow behavior

Follow and unfollow are idempotent:

- repeated follow does not create duplicate relations;
- repeated unfollow does not produce a negative counter;
- follower and following counters are updated consistently;
- a guest cannot create a follow relation without authenticated identity.

### Public and private separation

| Public response | Private/admin response |
| --- | --- |
| Shop name, slug, logo, description | Compliance profile |
| Main category and public contact | Tax and identity data |
| Follow state and public counters | Bank and payout information |
| Public operating status | Verification documents |
| Public catalog summary references | Review notes and internal audit fields |

Public shop reads must not become an indirect way to inspect onboarding or compliance data.

---

## 12. Events and integrations

### Seller application events

Seller Service publishes shared seller events for:

- application submitted;
- application approved;
- application rejected.

Events include stable IDs, status, user/shop references, safe navigation fields, event time, and actor information required by consumers. Sensitive identity documents, citizen IDs, and bank account values are excluded.

Notification Service consumes these events to send in-app and email notifications. Auth Service consumes approval to manage seller capability.

### Shop profile change events

The service publishes events for:

- profile change requested;
- profile change approved;
- profile change rejected.

The payload contains request/shop references, changed sections, safe status, and review information needed by Notification Service. The effective profile remains the source of truth in Seller Service.

### Kafka behavior

The producer:

- uses KAFKA_BROKERS and KAFKA_CLIENT_ID;
- uses an aggregate key so events for one application or shop remain ordered within a partition;
- retries short connection failures;
- logs publish failure without corrupting committed PostgreSQL data;
- connects lazily again after a broker restart.

For high-assurance production delivery, monitor the event/outbox path and replay failed integration events using the platform's operational tooling.

### HTTP integrations

| Integration | Use |
| --- | --- |
| Catalog Service | Validate main category and catalog references |
| Location Service | Validate address and GHN mapping |
| Product Service | Check active products before address deletion or shop operations |
| Auth Service | Resolve identity context and role handoff |
| Notification Service | Consume application and profile-change events |
| Shipping Service | Read pickup address and readiness |

---

## 13. Persistence model

### seller_applications

Stores the onboarding aggregate:

- unique user and shop slug;
- status and submission revision;
- shop and business information;
- profile type, legal identity, representative, and contacts;
- verification-document references;
- pickup snapshot;
- payout information;
- submission/review timestamps;
- review note and correction targets;
- correction snapshot hashes;
- metadata.

### shops

Stores the stable shop boundary:

- owner user ID;
- source application ID;
- public name and slug;
- logo and description;
- main category and business model;
- public contacts;
- shop status;
- follower counters;
- verification timestamp.

Unique indexes protect one owner-to-shop mapping and one slug-to-shop mapping.

### shop_compliance_profiles

Stores the verified sensitive snapshot separately from public shop information. It has a version used by sensitive change requests.

### shop_profile_change_requests

Stores before/after snapshots and review workflow. The request is not applied merely because it was created.

### shop_shipping_settings

Stores one settings record per shop:

- default pickup address;
- preparation window;
- enabled state;
- synchronization state.

### shop_pickup_addresses

Stores multiple shop-owned pickup locations and the default marker.

### shop_follow

Stores the user-to-shop follow relation. Unique constraints and transactional counter updates protect idempotency.

### Migrations

Recent migrations cover:

- removal of obsolete shipping-provider fields;
- GHN address mapping;
- public shop follow metrics;
- current shop and onboarding persistence evolution.

Review migration order before deploying against an existing seller database.

---

## 14. API reference

All routes are served below /api/v1 when URI versioning is enabled.

### Seller applications

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /seller/applications/me | Read the current user's application |
| PATCH | /seller/applications/me | Save or update a draft |
| POST | /seller/applications/submit | Submit a draft for review |
| POST | /seller/applications/resubmit | Resubmit corrected application data |
| GET | /seller/applications/admin | List applications for admin review |
| GET | /seller/applications/admin/:id | Read one application for admin |
| POST | /seller/applications/admin/:id/approve | Approve a pending application |
| POST | /seller/applications/admin/:id/reject | Reject with a review note |

### Shop profile

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /seller/shop/profile | Read the current seller's shop profile |
| PATCH | /seller/shop/profile | Update allowed public profile fields |

### Sensitive profile change requests

| Method | Route | Purpose |
| --- | --- | --- |
| POST | /seller/shop/profile/change-requests | Submit a sensitive change request |
| GET | /seller/shop/profile/change-requests/admin | List requests for admin review |
| GET | /seller/shop/profile/change-requests/admin/:requestId | Read request snapshots |
| POST | /seller/shop/profile/change-requests/admin/:requestId/approve | Apply approved changes |
| POST | /seller/shop/profile/change-requests/admin/:requestId/reject | Reject a request with a reason |

### Shipping and pickup

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /seller/shipping/settings | Read shop shipping settings and addresses |
| PATCH | /seller/shipping/settings | Update preparation and pickup settings |
| POST | /seller/shipping/pickup-addresses | Add a pickup address |
| PATCH | /seller/shipping/pickup-addresses/:id | Update an owned pickup address |
| POST | /seller/shipping/pickup-addresses/:id/default | Set the default pickup address |
| DELETE | /seller/shipping/pickup-addresses/:id | Delete an eligible pickup address |

### Public shops

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /shops | List active public shops |
| GET | /shops/:identifier | Read a public shop by identifier |
| PUT | /shops/:identifier/follow | Follow a shop as the authenticated viewer |
| DELETE | /shops/:identifier/follow | Unfollow a shop |

### Internal integrations

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /internal/seller/shops/:shopId/pickup-address | Return default pickup address |
| GET | /internal/seller/shops/:shopId/shipping-readiness | Return readiness for selling/shipping |

### Health and documentation

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /api/v1/health | Report service liveness |
| GET | /docs | Swagger UI outside production |

Seller and admin routes derive scope from trusted headers. Internal routes require x-internal-service-token. Public routes intentionally have a smaller response shape.

---

## 15. Project structure

~~~text
services/seller-service/
+-- src/
|   +-- main.ts
|   +-- app.module.ts
|   +-- common/
|   |   +-- config/
|   |       +-- helmet.config.ts
|   +-- database/
|   |   +-- migrations/
|   |   +-- seller-onboarding/
|   |   |   +-- entities/
|   |   |   +-- enums/
|   |   +-- shop-profile/
|   |   |   +-- entities/
|   |   |   +-- enums/
|   |   +-- shared/
|   |       +-- enums/
|   +-- kafka/
|   |   +-- kafka.module.ts
|   |   +-- kafka-producer.service.ts
|   +-- modules/
|       +-- health/
|       +-- seller.module.ts
|       +-- seller-onboarding/
|       |   +-- application/
|       |   +-- presentation/
|       +-- shop-profile/
|           +-- application/
|           +-- presentation/
+-- .env.example
+-- package.json
+-- tsconfig.json
+-- README.md
~~~

### Organization rules

- controllers map HTTP input to application services;
- application services own state transitions, ownership, validation, and transactions;
- clients isolate Auth, Catalog, Location, and Product integrations;
- database entities and enums define persistence state;
- Kafka services publish integration contracts;
- public, seller, admin, and internal controllers remain separate boundaries;
- no controller accepts a client-provided identity as an authorization decision.

---

## 16. Configuration

Use [.env.example](./.env.example) as the canonical local template.

| Variable | Required | Purpose |
| --- | --- | --- |
| NODE_ENV | No | Runtime environment |
| PORT | No | HTTP port, default 3007 |
| APP_VERSION | No | Version returned by health |
| TYPEORM_LOGGING | No | Enable TypeORM SQL logging |
| POSTGRES_HOST | Yes | PostgreSQL host |
| POSTGRES_PORT | No | PostgreSQL port, default 5432 |
| POSTGRES_USER | Yes | PostgreSQL user |
| POSTGRES_PASSWORD | Yes | PostgreSQL password |
| POSTGRES_DB | Yes | Seller database name |
| CATALOG_SERVICE_URL | Yes | Category and catalog validation |
| KAFKA_BROKERS | Yes for events | Kafka broker list |
| KAFKA_CLIENT_ID | No | Kafka producer client ID |
| INTERNAL_SERVICE_TOKEN | Yes for internal calls | Shared service-to-service secret |

### Configuration ownership

- Auth and Gateway own user identity and permission context;
- Seller Service owns seller business rules;
- Catalog and Location own their master data;
- deployment configuration owns service URLs and internal secrets;
- migration files own database schema evolution.

Do not put bank credentials, identity documents, or internal tokens in Kafka messages, logs, or public API responses.

---

## 17. Local development

### Commands

~~~bash
npm run dev
npm run type-check
npm run lint
npm test
npm run build
npm run start
~~~

### Recommended sequence

1. Start PostgreSQL and create the seller database.
2. Start Kafka if testing events or Notification integration.
3. Start Catalog and Location services for validation.
4. Start Auth/Gateway for realistic identity and permission headers.
5. Copy .env.example to .env.
6. Start Seller Service in watch mode.
7. Verify GET /api/health and GET /docs.
8. Save and submit a seller application.
9. Review it with an admin context.
10. Verify shop provisioning and the seller-approved event.
11. Update public profile fields.
12. Create and approve a sensitive profile change request.
13. Configure pickup addresses and shipping readiness.
14. Test public shop reads and follow/unfollow.
15. Confirm Product and Shipping internal lookups.

### Swagger

When NODE_ENV is not production:

~~~text
http://localhost:3007/docs
~~~

Swagger documents the HTTP controllers. Kafka event payloads are defined by shared contracts and event publisher services.

---

## 18. Testing

### Onboarding tests

Cover:

- draft creation and partial save;
- required field validation;
- profile-type-specific data;
- category validation;
- duplicate user and shop slug rejection;
- submit only from an eligible state;
- approval and rejection permissions;
- required rejection note;
- correction target tracking;
- resubmission only after required corrections;
- submission revision and timestamps;
- shop provisioning exactly once.

### Shop and ownership tests

Cover:

- a seller cannot read or update another shop;
- owner is derived from trusted context;
- public listing excludes suspended/closed shops according to policy;
- slug uniqueness;
- public response excludes compliance;
- follow and unfollow idempotency;
- follower counters do not become negative.

### Compliance tests

Cover:

- sensitive sections are whitelisted;
- request stores current and requested snapshots;
- approval checks base compliance version;
- approval applies all fields atomically;
- rejection leaves effective data unchanged;
- rejection requires a reason;
- admin identity is stored from trusted context.

### Shipping tests

Cover:

- settings are scoped to the current shop;
- GHN address codes are validated;
- only one default pickup address is selected;
- default address cannot be deleted while required by active products;
- internal token is required;
- readiness reflects enabled settings and a valid default address;
- internal response excludes private seller data.

### Integration tests

Cover:

- Kafka events are published after the database transaction;
- event payloads exclude sensitive fields;
- aggregate keys are stable;
- broker failure does not corrupt committed PostgreSQL state;
- downstream consumers can process submitted, approved, rejected, and profile-change events;
- migrations work on an empty and existing database.

### Commands

~~~bash
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
~~~

---

## 19. Security and data integrity

- put Seller Service behind API Gateway in production;
- trust x-user-id and permission headers only from the Gateway boundary;
- never accept ownerUserId or shopId from a seller request as authorization input;
- protect internal routes with x-internal-service-token;
- keep tokens and database credentials in deployment secrets;
- use Helmet security headers;
- use DTO whitelist and forbid unknown properties;
- validate UUID route parameters before database access;
- use transactions for approval, shop provisioning, compliance updates, follow counters, and address selection;
- use optimistic compliance versions for sensitive changes;
- preserve onboarding and review history instead of overwriting it;
- mask bank accounts and tax/identity fields in permitted private responses;
- never publish identity documents, citizen IDs, or bank account values to Kafka;
- do not log full application payloads or authorization headers;
- use TLS for PostgreSQL, Kafka, and service-to-service HTTP in production;
- use least-privilege database credentials;
- validate external URLs and media references before persisting;
- apply migrations through controlled deployment;
- rate-limit public and seller-facing endpoints at the gateway or service boundary.

---

## 20. Operations

### Health

GET /api/v1/health reports the service name, status, application version, and timestamp. It is a lightweight process check; dependency-specific monitoring should also cover PostgreSQL and Kafka.

### Metrics to monitor

- application draft, submit, approve, reject, and resubmit counts;
- time from submission to admin decision;
- correction and resubmission rate;
- approval/rejection error rate;
- duplicate shop-provisioning attempts;
- PostgreSQL transaction latency and pool usage;
- Kafka publish failures and event lag;
- profile-change queue age;
- address validation failures;
- shipping-readiness failures;
- public shop latency;
- follow/unfollow conflict rate.

### Scaling

Multiple instances can share:

- the same PostgreSQL database;
- compatible migration state;
- Kafka broker configuration;
- shared event contracts.

Transactions and unique indexes protect application and shop provisioning. If event publication is made fully outbox-backed in deployment, coordinate dispatch ownership so multiple instances do not publish the same outbox record.

### Recovery

- PostgreSQL is the source of truth for seller and shop state;
- Kafka consumers can replay application/profile events;
- approval does not need to be undone by deleting history;
- a failed Auth role handoff should be retried from the approval event;
- a failed Notification delivery should be retried by Notification Service;
- an invalid profile change should be rejected or rolled back through the request workflow;
- a shop can be suspended without deleting compliance or onboarding history.

### Deployment checklist

1. Apply migrations.
2. Confirm Catalog and Location URLs.
3. Confirm internal token rotation.
4. Verify Kafka connectivity.
5. Check health endpoint.
6. Test a read-only public shop request.
7. Test a protected seller read.
8. Verify event publishing.
9. Monitor approval and profile-change queues.
10. Confirm no sensitive fields appear in logs or event payloads.

---

## 21. FAQ

### Does Seller Service assign the seller role?

No. Seller Service approves the business application and publishes the approval event. Auth Service owns role assignment.

### Can a user create a shop before approval?

No. The shop boundary is provisioned from an approved seller application.

### Why are sensitive profile changes not handled by PATCH profile?

Tax, identity, and payout changes need review and an audit trail. They are submitted as explicit change requests and applied only after approval.

### Does Seller Service own products?

No. Product Service owns product aggregates and inventory. Seller Service owns the shop and seller ownership boundary used by Product Service.

### Why are address names stored together with GHN codes?

Codes are the integration identifiers. Names make snapshots and historical display stable when master-data labels change.

### Can a public customer read seller compliance information?

No. Public shop responses exclude compliance, tax, identity, payout, and verification-document data.

### What happens if Kafka is unavailable after approval?

The committed approval remains in PostgreSQL. The event delivery path must retry so Auth and Notification can converge without changing the approval decision.

### Why can an address be blocked from deletion?

An active product or shipping flow may depend on a valid pickup location. The seller must select a replacement before removing the address.

### Can an admin approve an old profile-change request after the shop changed?

The compliance version check prevents silently applying a stale request. The request must be reviewed against the current version.

---

## 22. Ownership

### Engineering

**Đào Ngọc Anh**

**Software Engineer**

[View portfolio](https://daongocanh.site)

Software Engineer responsible for the architecture, implementation, integration, and maintenance of this service.

### Architecture and API design

**Đào Ngọc Anh**

Designed the seller onboarding state machine, shop ownership boundary, compliance review workflow, public shop surface, pickup-address model, shipping readiness contract, and Auth/Kafka integrations for the Bin E-Commerce ecosystem.
