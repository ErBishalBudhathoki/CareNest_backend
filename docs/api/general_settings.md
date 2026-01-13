# General Settings API

## Overview
Atomic update endpoint for organization-wide general pricing settings.

- Base: `/api/settings/general`
- Versioned: `/api/v1/settings/general`
- Methods: `PUT` (preferred), `POST` (fallback)
- Auth: `Authorization: Bearer <JWT>` (see `middleware/auth.js`)

## Request

Headers:
- `Content-Type: application/json`
- `Authorization: Bearer <JWT>`

Body (JSON):
- `organizationId` (string, optional if provided in JWT): Organization context
- `defaultCurrency` (string, required): 3-letter code, e.g., `AUD`
- `pricingModel` (string, required): Model name (<= 100 chars)
- `roundingMethod` (string, required): Method label (<= 100 chars)
- `taxCalculation` (string, required): One of `GST Inclusive`, `GST Exclusive`
- `defaultMarkup` (number, required): 0–100 (float allowed)
- `maxPriceVariation` (number, required): 0–100 (float allowed)
- `priceHistoryRetention` (integer, required): 1–3650 days
- `bulkOperationLimit` (integer, required): 1–10000 records per op
- `autoUpdatePricing` (boolean, required)
- `enablePriceValidation` (boolean, required)
- `requireApprovalForChanges` (boolean, required)
- `enableBulkOperations` (boolean, required)
- `enablePriceHistory` (boolean, required)
- `enableNotifications` (boolean, required)

### Example (PUT)
```http
PUT /api/settings/general
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "defaultCurrency": "AUD",
  "pricingModel": "NDIS Standard",
  "roundingMethod": "Round to nearest cent",
  "taxCalculation": "GST Inclusive",
  "defaultMarkup": 10.0,
  "maxPriceVariation": 5,
  "priceHistoryRetention": 365,
  "bulkOperationLimit": 500,
  "autoUpdatePricing": true,
  "enablePriceValidation": true,
  "requireApprovalForChanges": false,
  "enableBulkOperations": true,
  "enablePriceHistory": true,
  "enableNotifications": false
}
```

## Response

Success (200):
```json
{
  "statusCode": 200,
  "message": "General settings updated",
  "data": {
    "organizationId": "org-123",
    "defaultCurrency": "AUD",
    "pricingModel": "NDIS Standard",
    "roundingMethod": "Round to nearest cent",
    "taxCalculation": "GST Inclusive",
    "defaultMarkup": 10.0,
    "maxPriceVariation": 5,
    "priceHistoryRetention": 365,
    "bulkOperationLimit": 500,
    "autoUpdatePricing": true,
    "enablePriceValidation": true,
    "requireApprovalForChanges": false,
    "enableBulkOperations": true,
    "enablePriceHistory": true,
    "enableNotifications": false,
    "updatedAt": "2025-01-05T10:30:00Z",
    "updatedBy": "admin@company.com",
    "version": 2
  }
}
```

## Error Responses

- 400 Invalid input:
```json
{
  "statusCode": 400,
  "message": "Invalid input",
  "errors": { "defaultCurrency": "must be a 3-letter code" }
}
```

- 401 Unauthorized:
```json
{ "statusCode": 401, "message": "Unauthorized" }
```

- 403 Forbidden:
```json
{ "statusCode": 403, "message": "User not authorized for this organization" }
```

- 413 Payload too large:
```json
{ "statusCode": 413, "message": "Payload too large" }
```

- 500 Server error:
```json
{ "statusCode": 500, "message": "Server error updating general settings" }
```

## Notes

- Atomicity: All settings update together in a single upsert. No partial writes.
- Performance: Payload size capped at 16KB; use paging for large future configs.
- Security: Requires valid JWT and organization membership; actions recorded in audit trail.