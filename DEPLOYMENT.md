# Backend Deployment Guide (Google Cloud Run)

This repository uses GitHub Actions to deploy the backend to **Google Cloud Run**.
Cloud Run is a serverless platform that automatically scales your container up and down, including **scaling to zero** when not in use (cost-effective).

## 1. Google Cloud Setup

1.  **Create a Project**: Ensure you have a Google Cloud Project (e.g., `invoice-backend-prod`).
2.  **Enable APIs**: Enable the following APIs in the Google Cloud Console:
    *   **Cloud Run Admin API**
    *   **Artifact Registry API**
    *   **Cloud Build API** (optional, useful for logs)
3.  **Create Artifact Registry Repository**:
    *   Go to Artifact Registry in the Console.
    *   Create a new repository.
    *   Name: `invoice-backend-repo`
    *   Format: **Docker**
    *   Region: `australia-southeast1` (Must match the workflow config)
4.  **Create Service Account**:
    *   Go to IAM & Admin > Service Accounts.
    *   Create a new Service Account (e.g., `github-deployer`).
    *   Assign Roles:
        *   `Cloud Run Admin`
        *   `Service Account User`
        *   `Artifact Registry Writer`
    *   Create a **JSON Key** for this service account and download it.

## 2. GitHub Secrets Configuration

Go to your GitHub Repository > **Settings** > **Secrets and variables** > **Actions** > **New repository secret**.

Add the following secrets:

### Deployment Secrets
| Secret Name | Value |
|-------------|-------|
| `GCP_PROJECT_ID` | Your Google Cloud Project ID (e.g., `invoice-backend-123`) |
| `GCP_SA_KEY` | Paste the entire content of the JSON Key file downloaded in Step 1 |

### Application Environment Secrets
These secrets will be injected into the application environment at runtime.

| Secret Name | Description |
|-------------|-------------|
| `MONGODB_URI` | Connection string for your production MongoDB |
| `JWT_SECRET` | Strong secret key for signing tokens |
| `REDIS_URL` | URL for your Redis instance (required for rate limiting) |
| `BACKEND_URL` | The URL of your deployed service (e.g. `https://invoice-backend-xyz.a.run.app`) |
| `FIREBASE_PROJECT_ID` | Your Firebase Project ID |
| `FIREBASE_CLIENT_EMAIL`| Firebase Service Account Email |
| `FIREBASE_PRIVATE_KEY` | Firebase Private Key (include `-----BEGIN PRIVATE KEY-----`) |
| `SMTP_PASSWORD` | Password/App Password for email service |
| `R2_ACCOUNT_ID` | (Optional) Cloudflare R2 Account ID |
| `R2_ACCESS_KEY_ID` | (Optional) Cloudflare R2 Access Key |
| `R2_SECRET_ACCESS_KEY` | (Optional) Cloudflare R2 Secret Key |
| `R2_BUCKET_NAME` | (Optional) R2 Bucket Name |
| `R2_PUBLIC_DOMAIN` | (Optional) R2 Public Domain |

## 3. Deployment Workflow

The deployment is automated via GitHub Actions:

1.  **Trigger**: Push code to the `main` branch.
2.  **Process**:
    *   Code is checked out.
    *   Docker image is built using `backend/Dockerfile`.
    *   Image is pushed to Google Artifact Registry.
    *   Service is deployed to Cloud Run.

### Scale to Zero
The service is configured with `--min-instances=0`. This means:
*   When no requests are coming in, Google shuts down the container (0 cost).
*   When a request arrives, it spins up a container instantly (cold start typically < 2s).

## 4. Documentation Access

Both Swagger UI and Redoc are integrated directly into the backend:

*   **Swagger UI**: `https://YOUR-CLOUD-RUN-URL/api-docs`
*   **Redoc**: `https://YOUR-CLOUD-RUN-URL/api-docs/redoc`

No separate containers are needed.
