# Infrastructure Security & Zero-Trust Audit

**Date Started**: May 22, 2026  
**Last Updated**: May 22, 2026  
**Status**: ✅ SECURED & VERIFIED

This document serves as the canonical record for the infrastructure security review of the CareNest application stack. It details how the system achieves strict multi-tenant isolation and network-level security across Google Cloud Platform (GCP), MongoDB, Cloudflare R2, and Oracle Cloud Infrastructure (OCI).

---

## 1. Multi-Tenant Data Isolation (MongoDB)

MongoDB does not provide database-engine-level Row-Level Security (RLS) in the same way PostgreSQL does. To compensate, CareNest relies on a robust **Logical (Application-Enforced) Row-Level Security** model at the Node.js API layer.

### 1.1 The Zero-Trust Organization Context
The API relies on the Zero-Trust pattern. Every request attempting to access or modify tenant data must clear two major hurdles:
1. **`authenticateUser`**: Validates the JWT Bearer token.
2. **`organizationContextMiddleware`**: Extracts the target `organizationId` from the request (headers, query, or body) and queries the `UserOrganization` collection. 
   - If the user does not have an active membership for the requested organization, the request is immediately rejected with a `403 Forbidden` (`ORG_ACCESS_DENIED`).
   - If membership is valid, the middleware injects `req.organizationContext` containing the user's validated role and permissions.

### 1.2 BOLA / IDOR Protection
To prevent Insecure Direct Object Reference (IDOR) attacks (where an attacker tries to access another tenant's document by guessing its ID), the API uses the `requireOrganizationOwnership` middleware.
- Before returning or modifying a specific resource (e.g., `/api/invoices/:invoiceId`), the backend fetches the resource and asserts that its `organizationId` exactly matches `req.organizationContext.organizationId`.
- This creates a strict boundary, guaranteeing users can only interact with documents belonging to their assigned organizations.

---

## 2. File Storage Security (Cloudflare R2)

CareNest uses Cloudflare R2 (S3-compatible) for asset storage (e.g., invoices, profile pictures).

### 2.1 Presigned URLs
- **No Client Secrets**: The Flutter mobile application **does not contain any R2/AWS static access keys**. 
- **Temporary Access**: To upload or download a file, the Flutter app requests a short-lived, single-use presigned URL from the Node.js backend.
- **Backend Gatekeeper**: The Node.js backend only generates this presigned URL after the user has passed the `organizationContextMiddleware` check. 

### 2.2 Path Segregation
Files in the R2 bucket are strictly segregated by organization ID to prevent namespace collisions and maintain logical isolation:
`organizations/{organizationId}/invoices/{invoiceId}.pdf`

---

## 3. Background Workflows (Temporal on Oracle OCI)

Temporal coordinates distributed background jobs (billing cycles, email dispatches). Because Temporal is hosted on a separate cloud provider (Oracle Cloud OCI VPS), it requires strict network boundaries to prevent malicious actors from hijacking workflows or scraping history.

### 3.1 Network Isolation & mTLS
- **No Frontend Access**: The Flutter app never communicates with Temporal. It only communicates with the Node.js API.
- **mTLS Proxy (Port 7236)**: The Node.js backend running on GCP communicates with Temporal through a secure Nginx reverse proxy running on the OCI VPS. This connection is encrypted and authenticated using **Mutual TLS (mTLS)** on port `7236`.
- **Closed Backdoors**: The `docker-compose.yml` on the Oracle VPS is explicitly configured to *not* bind the Temporal Server's raw gRPC port (`7233`) to the host network. All traffic must flow through the Nginx mTLS gateway.

### 3.2 Dashboard Security
- **Web UI**: The Temporal UI is accessible via `https://temporal.bishalbudhathoki.com/dashboard`.
- **Basic Authentication**: The dashboard is protected by Nginx HTTP Basic Authentication using a secure `.htpasswd` file, preventing unauthorized web access.

---

## 4. Environment Separation

To ensure production integrity, CareNest strictly isolates development and production environments:

* **Development**:
  * Uses Google account `deverbishal331@gmail.com`.
  * Connects to a dedicated development MongoDB instance.
  * Uses the development Temporal namespace.
* **Production**:
  * Uses Google account `budhathokib085@gmail.com`.
  * Connects to a dedicated production MongoDB instance.
  * Uses the production Temporal namespace.

**Golden Rule:** Configuration, credentials, and databases must never be mixed between these two tracks.
