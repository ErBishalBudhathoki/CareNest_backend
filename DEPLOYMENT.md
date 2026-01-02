# Deployment Guide

This repository uses GitHub Actions for Continuous Integration and Continuous Deployment (CI/CD) to Firebase.

## Environments

We support two environments:
1.  **Production**: Deployed from the `main` branch.
2.  **Development**: Deployed from the `dev` branch.

Each environment requires its own Firebase Project to ensure complete isolation of data and Cloud Functions.

## Setup Instructions

### 1. Firebase Projects
*   **Production Project**: Already set up (ID: `invoice-660f3`).
*   **Development Project**: You need to create a new project in the [Firebase Console](https://console.firebase.google.com/) (e.g., `invoice-dev-123`).

### 2. GitHub Secrets
You need to add the following secrets to your GitHub repository settings (`Settings` > `Secrets and variables` > `Actions`).

#### Production Secrets (Existing)
*   `FIREBASE_PROJECT_ID`
*   `FIREBASE_PRIVATE_KEY_ID`
*   `FIREBASE_PRIVATE_KEY`
*   `FIREBASE_CLIENT_EMAIL`
*   `FIREBASE_CLIENT_ID`
*   `FIREBASE_CLIENT_CERT_URL`
*   `MONGODB_URI`
*   `APP_PASSWORD`
*   `ADMIN_EMAIL`
*   `JWT_SECRET`

#### Development Secrets (New - Required)
You must generate a new Service Account for your **Development** Firebase project and add these secrets with the `DEV_` prefix:

*   `DEV_FIREBASE_PROJECT_ID`: The ID of your development project.
*   `DEV_FIREBASE_PRIVATE_KEY_ID`
*   `DEV_FIREBASE_PRIVATE_KEY`
*   `DEV_FIREBASE_CLIENT_EMAIL`
*   `DEV_FIREBASE_CLIENT_ID`
*   `DEV_FIREBASE_CLIENT_CERT_URL`
*   `DEV_MONGODB_URI`: Connection string for your **Development** database (do not use the production DB!).
*   `DEV_APP_PASSWORD`: App password for dev email sending.
*   `DEV_ADMIN_EMAIL`: Admin email for dev.
*   `DEV_JWT_SECRET`: Secret for signing tokens in dev.

### 3. Workflow
1.  **Develop**: Create a feature branch from `dev`.
2.  **Test**: Push changes. Open a PR to `dev`.
3.  **Deploy Dev**: Merge into `dev`. GitHub Actions will automatically deploy to the Development Firebase project.
4.  **Release**: When ready, open a PR from `dev` to `main`.
5.  **Deploy Prod**: Merge into `main`. GitHub Actions will automatically deploy to the Production Firebase project.

## Troubleshooting
*   **Permissions**: Ensure the Cloud Build API is enabled in both Google Cloud projects.
*   **Service Account**: Ensure the Service Account used in GitHub Secrets has "Firebase Admin", "Service Account User", and "API Keys Admin" roles.
