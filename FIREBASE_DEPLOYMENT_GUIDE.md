# Firebase Backend Deployment Guide

This guide details how to deploy the Node.js backend to Firebase Hosting (using Cloud Functions) with automated CI/CD via GitHub Actions. It also covers setting up Budget Alerts to monitor costs.

## Architecture

- **Cloud Functions**: The Express backend (`server.js`) is wrapped and deployed as a Firebase Cloud Function named `api`.
- **Firebase Hosting**: Acts as a global CDN and reverse proxy. It is configured to rewrite all requests (`**`) to the `api` Cloud Function.
- **GitHub Actions**: Automates the deployment process on every push to the `main` branch affecting the `backend` folder.

## Prerequisites

1.  **Firebase Project**: Create a project at [console.firebase.google.com](https://console.firebase.google.com/).
2.  **Blaze Plan**: Upgrade your project to the **Blaze (Pay as you go)** plan. This is required for Node.js 10+ Cloud Functions.
3.  **GitHub Repository**: Ensure this code is pushed to GitHub.

## 1. Initial Setup

### Firebase CLI (Local)
Ensure you have the Firebase CLI installed locally for testing (optional but recommended).
```bash
npm install -g firebase-tools
firebase login
```

### Project Configuration
The project is already configured with:
- `firebase.json`: Defines Hosting rewrites and Functions source.
- `functions_entry.js`: Entry point for Cloud Functions.
- `.firebaserc`: Stores project aliases.

**Action Required**:
Update `.firebaserc` with your actual project ID if you want to use local commands, or just rely on CI/CD.
```json
{
  "projects": {
    "default": "your-actual-project-id"
  }
}
```

## 2. GitHub Actions Secrets

For the CI/CD pipeline to work, you must add the following secrets to your GitHub Repository (**Settings > Secrets and variables > Actions**).

### Firebase Token
1.  Run `firebase login:ci` locally.
2.  Copy the token printed in the terminal.
3.  Add secret: `FIREBASE_TOKEN`.

### Project ID
1.  Add secret: `FIREBASE_PROJECT_ID` with your Firebase Project ID (e.g., `my-invoice-app`).

### Application Configuration
In addition to the Firebase credentials, you must add the following secrets for the backend to function (Database, Auth, etc.):
- `MONGODB_URI`: Connection string for MongoDB.
- `JWT_SECRET`: Secret key for JWT signing.
- `ADMIN_EMAIL`: Email for sending notifications.
- `APP_PASSWORD`: App password for the admin email (if using Gmail).
- `JWT_EXPIRES_IN`: (Optional) Token expiry, defaults to '24h'.

### Firebase Admin SDK Credentials
These are required to generate `firebase-admin-config.js` during deployment. Get these from your Service Account JSON file (Firebase Console > Project Settings > Service accounts).

Add the following secrets:
- `FIREBASE_PRIVATE_KEY_ID`
- `FIREBASE_PRIVATE_KEY` (Copy the entire private key including `-----BEGIN...` and `...END-----`)
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_CLIENT_ID`
- `FIREBASE_CLIENT_CERT_URL`

## 3. Budget Alerts Setup (Crucial)

To prevent unexpected costs, set up a budget alert in the Google Cloud Console.

1.  **Access Billing**:
    - Go to the [Google Cloud Console](https://console.cloud.google.com/).
    - Select your Firebase project.
    - Navigate to **Billing** > **Budgets & alerts** in the left sidebar.

2.  **Create Budget**:
    - Click **Create Budget**.
    - **Name**: e.g., "Monthly Backend Budget".
    - **Time range**: Monthly.
    - **Projects**: Select your specific project.

3.  **Set Amount**:
    - **Budget type**: Specified amount.
    - **Target amount**: Enter your limit (e.g., $10 or $50). This is just a threshold for alerts, it does not auto-stop services (unless you configure programmatic actions, which is advanced).

4.  **Set Thresholds**:
    - Configure alert percentages:
        - 50% (Warning)
        - 90% (Critical)
        - 100% (Budget Reached)
    - Ensure **Email alerts to billing admins and users** is checked.
    - (Optional) Add specific email addresses for developers.

5.  **Finish**: Click **Save**. You will now receive emails if costs spike.

## 4. Deployment

### Automated (CI/CD)
Push changes to the `main` branch in the `backend/` directory.
```bash
git add backend/
git commit -m "feat: configure firebase deployment"
git push origin main
```
Go to the **Actions** tab in GitHub to monitor the `Deploy Backend to Firebase` workflow.

### Manual (Local)
If you need to deploy manually:
1.  Set up environment variables in `.env`.
2.  Run the generation script:
    ```bash
    node scripts/generate-firebase-config.js
    ```
3.  Deploy:
    ```bash
    firebase deploy --only functions,hosting
    ```

## 5. Troubleshooting

- **Cold Starts**: Cloud Functions may take a few seconds to start if inactive. This is normal.
- **Memory Limit**: If the app crashes with memory errors, increase memory in `firebase.json` or `functions_entry.js` (e.g., `functions.runWith({ memory: '1GB' })`).
- **Logs**: View runtime logs in the Firebase Console > Functions > Logs.

## 6. Security Note

Never commit `.env` files or `firebase-admin-config.js` to the repository. The CI/CD pipeline generates the config file on the fly using GitHub Secrets, ensuring credentials are never hardcoded in the codebase.
