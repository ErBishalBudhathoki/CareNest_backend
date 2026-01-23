# Redis Setup & Configuration

## Overview
The application connects to Redis using a standard connection URL (`REDIS_URL`). This allows flexibility to use any Redis provider, such as Redis Cloud, Upstash, or a self-hosted instance, without being tied to Google Cloud Memorystore.

## Deployment Configuration

### GitHub Secrets
To configure Redis for your environments, add the following secrets to your GitHub repository:

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `REDIS_URL` | Connection string for Development | `redis://default:password@host:port` |
| `PROD_REDIS_URL` | Connection string for Production | `rediss://default:password@host:port` |

### Infrastructure
The deployment workflows (`deploy-dev.yml`, `deploy-prod.yml`) do **not** provision any Redis infrastructure or VPC connectors on Google Cloud.

*   **Cost Efficient**: This configuration avoids the costs associated with "always-on" VPC Access Connectors and managed Memorystore instances.
*   **Legacy Cleanup**: If you have migrated from the previous Google Cloud Memorystore setup, ensure you **manually delete** these unused resources to avoid charges:
    *   **VPC Serverless Access Connectors**: `invoice-vpc-connector` (and any prod equivalents)
    *   **Cloud Memorystore Instances**: `invoice-redis-dev`, `invoice-redis-prod`

## Application Configuration
The application connection logic is handled in `backend/config/redis.js`.

### Local Development
For local testing, if `REDIS_URL` is not provided, the application falls back to standard local defaults:
- `REDIS_HOST`: `localhost`
- `REDIS_PORT`: `6379`
