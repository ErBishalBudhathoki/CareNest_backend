# Deployment Guide

This repository uses GitHub Actions for Continuous Integration and Continuous Deployment (CI/CD) to Firebase.

## Environments

We support two environments:
1.  **Development**: Deployed from the `dev` branch.
2.  **Production**: Deployed from the `main` branch.

Each environment requires its own Firebase Project to ensure complete isolation of data and Cloud Functions.

## Setup Instructions

### 1. Firebase Projects
*   **Development Project**: Already set up (ID: `invoice-660f3`).
*   **Production Project**: You need to create a new project in the [Firebase Console](https://console.firebase.google.com/) (e.g., `invoice-prod`).

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
*   `APP_PASSWORD`
*   `ADMIN_EMAIL`
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
*   `PROD_APP_PASSWORD`: App password for prod email sending.
*   `PROD_ADMIN_EMAIL`: Admin email for prod.
*   `PROD_JWT_SECRET`: Secret for signing tokens in prod.

### 3. Workflow
1.  **Develop**: Create a feature branch from `dev`.
2.  **Test**: Push changes. Open a PR to `dev`.
3.  **Deploy Dev**: Merge into `dev`. GitHub Actions will automatically deploy to the Development Firebase project using the standard secrets.
4.  **Release**: When ready, open a PR from `dev` to `main`.
5.  **Deploy Prod**: Merge into `main`. GitHub Actions will automatically deploy to the Production Firebase project using the `PROD_` prefixed secrets.
