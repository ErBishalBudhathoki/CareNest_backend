# 🔒 API Security & Zero-Trust Architecture

This API implements a **Zero-Trust Security Model** for multi-tenant data access.

---

## 🔑 Authentication & Authorization

### 1. Authentication (Bearer Token)
All protected endpoints require a valid JWT token in the header.

```http
Authorization: Bearer <your_jwt_token>
```

### 2. Organization Context (Zero-Trust)
To access organization-specific resources (invoices, clients, teams, etc.), you **MUST** provide the target Organization ID. This allows the backend to validate that the authenticated user has active membership permissions for that specific organization.

**Header (Recommended):**
```http
x-organization-id: <organization_id>
```

**Query Parameter (Alternative):**
```http
GET /api/resource?organizationId=<organization_id>
```

**Body Parameter (For POST/PUT):**
```json
{
  "organizationId": "<organization_id>",
  ...
}
```

### 3. Public Endpoints
The following endpoints do not require authentication:
- `/api/auth/login`
- `/api/auth/register`
- `/health`
- `/api-docs`

---

## 🛡️ Organization Context Middleware

The `organizationContextMiddleware` enforces security by:
1. Extracting `organizationId` from request (Header > Query > Body > User Defaults).
2. Verifying the user has a valid, active record in `UserOrganization` collection.
3. Rejecting request with `403 Forbidden` if membership is missing or inactive.
4. Injecting user's role and permissions into `req.organizationContext`.

### Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| `ORG_CONTEXT_REQUIRED` | 400 | No organization ID provided in request. |
| `ORG_ACCESS_DENIED` | 403 | User is not a member of the requested organization. |
| `ORG_INACTIVE` | 403 | Organization or User membership is inactive. |

---

## 📝 Developer Guidelines

When adding new routes:

1. **Always apply `authenticateUser` middleware.**
2. **If the route touches organization data, apply `organizationContextMiddleware`.**
3. **NEVER** query `User` collection by `organizationId` directly. Always query `UserOrganization` first to validate membership.

```javascript
// ✅ CORRECT (Zero-Trust)
const userOrgs = await UserOrganization.find({ organizationId, isActive: true });
const userIds = userOrgs.map(uo => uo.userId);
const users = await User.find({ _id: { $in: userIds } });

// ❌ INCORRECT (Insecure)
const users = await User.find({ organizationId });
```
