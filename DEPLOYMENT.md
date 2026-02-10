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

### Deployment Secrets (Workload Identity Federation)

This repo deploys with **keyless auth** using Workload Identity Federation (no JSON keys stored in GitHub).

| Secret Name | Description |
|-------------|-------------|
| `WIF_PROVIDER` | Workload identity provider resource for dev deployments |
| `WIF_SERVICE_ACCOUNT` | Service account email used by GitHub Actions for dev |
| `PROD_WIF_PROVIDER` | Workload identity provider resource for production deployments |
| `PROD_WIF_SERVICE_ACCOUNT` | Service account email used by GitHub Actions for production |

### Application Secrets

Application secrets are stored in **Google Secret Manager** as a single JSON blob per environment:

- `app-secrets-dev` in project `invoice-660f3`
- `app-secrets-prod` in project `carenest-prod`

Cloud Run receives `CONSOLIDATED_SECRET_NAME` + `GCP_PROJECT_ID` and loads secrets at runtime.

## 3. Deployment Workflow

The deployment is automated via GitHub Actions:

1.  **Trigger**: Push code to the `dev` branch (development) or `main` (production).
2.  **Process**:
    *   Code is checked out.
    *   Docker image is built using `backend/Dockerfile`.
    *   Image is pushed to Google Artifact Registry.
    *   Service is deployed to Cloud Run.

### Dev URL access

Development is configured as **IAM-protected** (not publicly invokable). Smoke tests use an identity token to validate the tagged revision.

### Scale to Zero
The service is configured with `--min-instances=0`. This means:
*   When no requests are coming in, Google shuts down the container (0 cost).
*   When a request arrives, it spins up a container instantly (cold start typically < 2s).

## 4. Documentation Access

Both Swagger UI and Redoc are integrated directly into the backend:

*   **Swagger UI**: `https://YOUR-CLOUD-RUN-URL/api-docs`
*   **Redoc**: `https://YOUR-CLOUD-RUN-URL/api-docs/redoc`

No separate containers are needed.
