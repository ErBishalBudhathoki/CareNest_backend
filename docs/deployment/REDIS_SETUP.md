# Redis Setup Guide for Google Cloud & GitHub Actions

## Automated Infrastructure Provisioning

The GitHub Actions workflow (`deploy-dev.yml`) has been updated to **automatically provision and configure** the required Redis infrastructure in Google Cloud. You do **NOT** need to manually create instances.

### How it Works

1.  **Enables APIs**: The workflow automatically enables `redis.googleapis.com` and `vpcaccess.googleapis.com` on your project.
2.  **Creates Resources** (Idempotent):
    *   **VPC Connector**: Creates a serverless VPC connector (`invoice-vpc-connector`) in `australia-southeast1` if it doesn't exist.
    *   **Redis Instance**: Creates a Basic Tier Redis instance (`invoice-redis-dev`) in the same region.
3.  **Injects Configuration**:
    *   Retrieves the Redis Host and Port dynamically.
    *   Injects them into the `.env` file used by Cloud Functions.
    *   Updates `firebase.json` on the fly to attach the VPC Connector to your functions.

### Prerequisites

For this automation to work, your **GitHub Repository Secrets** must include:

1.  `GCP_SA_KEY`: A Service Account Key (JSON) with permissions to create Redis instances and VPC Connectors.
    *   **Roles Required**: `Cloud Redis Admin`, `Serverless VPC Access Admin`, `Compute Network Admin`.
2.  `FIREBASE_PROJECT_ID`: Your Google Cloud Project ID.

### Manual Verification (Optional)

If you wish to verify the resources created by the automation:
*   **Redis**: Console > Memorystore > Redis.
*   **VPC Connector**: Console > VPC network > Serverless VPC access.

### Troubleshooting Automation

*   **Permission Denied**: Ensure `GCP_SA_KEY` service account has the admin roles listed above.
*   **Quota Exceeded**: If the workflow fails due to IP range conflicts or quota, check your VPC network quotas.
