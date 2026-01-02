# Deployment Guide

This repository uses GitHub Actions for Continuous Integration and Continuous Deployment (CI/CD) to Firebase.

## Environments

We support two environments:
1.  **Development**: Deployed from the `dev` branch.
2.  **Production**: Deployed from the `main` branch.

Each environment requires its own Firebase Project to ensure complete isolation of data and Cloud Functions.

## Setup Instructions

### 1. Firebase Projects
You can host these projects in the **same** Google Account or **different** Google Accounts (e.g., a personal account for Dev and a company account for Prod). The CI/CD pipeline connects via Service Accounts, so the owner account doesn't matter.

*   **Development Project**: Already set up (ID: `invoice-660f3`).
*   **Production Project**: Create this in the [Firebase Console](https://console.firebase.google.com/) (e.g., `invoice-prod`). This can be under a completely different Google/Gmail account.

### 2. GitHub Secrets
You need to add the following secrets to your GitHub repository settings (`Settings` > `Secrets and variables` > `Actions`).

#### Development Secrets (Existing)
These secrets are used for the `dev` branch deployment:
*   `FIREBASE_PROJECT_ID`
*   `FIREBASE_PRIVATE_KEY_ID`
*   `FIREBASE_PRIVATE_KEY`
*   `FIREBASE_CLIENT_EMAIL`
*   `FIREBASE_CLIENT_ID`
*   `FIREBASE_CLIENT_CERT_URL`
*   `MONGODB_URI`
*   `DB_NAME`: (Optional) Database name. Defaults to `Invoice` if not set.
*   `JWT_SECRET`

#### Production Secrets (New - Required)
You must generate a new Service Account for your **Production** Firebase project and add these secrets with the `PROD_` prefix:

*   `PROD_FIREBASE_PROJECT_ID`: The ID of your production project.
*   `PROD_FIREBASE_PRIVATE_KEY_ID`
*   `PROD_FIREBASE_PRIVATE_KEY`
*   `PROD_FIREBASE_CLIENT_EMAIL`
*   `PROD_FIREBASE_CLIENT_ID`
*   `PROD_FIREBASE_CLIENT_CERT_URL`
*   `PROD_MONGODB_URI`: Connection string for your **Production** database.
*   `PROD_DB_NAME`: (Optional) Database name for prod. Defaults to `Invoice` if not set.
*   `PROD_JWT_SECRET`: Secret for signing tokens in prod.

#### Generating JWT Secrets
You can generate a secure random string for `PROD_JWT_SECRET` (and `JWT_SECRET` if not set) using this terminal command:
```bash
openssl rand -hex 32
```
Example output (DO NOT USE THIS ONE): `e664d92028ec116952d76csda4854f9cae3fa964aaaa3d562cb8985bb8c64b75`

### 3. Workflow & Merging Strategy

This project uses a "Git Flow" inspired strategy to manage releases.

#### Step 1: Feature Development
1.  **Start**: Create a new branch from `dev` (e.g., `feature/new-login`).
    ```bash
    git checkout dev
    git pull origin dev
    git checkout -b feature/new-login
    ```
2.  **Work**: Write code, commit changes.
3.  **Merge to Dev**: Open a **Pull Request (PR)** on GitHub from `feature/new-login` → `dev`.
    *   Once approved and merged, GitHub Actions triggers **[deploy-dev.yml]**.
    *   Your code is now live on the **Development** Firebase project.
    *   *Verification*: Test your changes on the dev URL.

#### Step 2: Production Release
1.  **Prepare**: When `dev` is stable and you are ready to release to users.
2.  **Merge to Main**: Open a **Pull Request (PR)** on GitHub from `dev` → `main`.
    *   This PR represents your "Release Candidate".
    *   Review the changes one last time.
    *   Once merged, GitHub Actions triggers **[deploy-prod.yml]**.
    *   Your code is now live on the **Production** Firebase project.

### Why this approach?
*   **Safety**: You never push directly to `main`. All code must pass through `dev` first.
*   **Verification**: You can test features in a live "Development" environment that mirrors production before real users see them.
*   **Automation**: No manual `firebase deploy` commands required. Merging branches triggers the deployments.
