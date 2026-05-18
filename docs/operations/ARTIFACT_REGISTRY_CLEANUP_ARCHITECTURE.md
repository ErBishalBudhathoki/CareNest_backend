# Artifact Registry Cleanup Architecture

## Overview
This document details the automated Temporal-based cleanup architecture for managing the Google Cloud Artifact Registry. Since GitHub Actions continuously builds and pushes new Docker images for Cloud Run deployments, we maintain a periodic Temporal cron workflow (`CleanupArtifactRegistryWorkflow`) to delete older, unused images and prevent storage costs from spiraling.

## Temporal Worker Architecture & Independence
It is critical to distinguish between the **main API deployments** and the **Temporal Workers**:

1. **GitHub Actions & Google Cloud Run**: The main backend API is built and pushed by GitHub Actions to Google Cloud Artifact Registry, where it is deployed to Google Cloud Run. These images are the targets of this cleanup script.
2. **Dokploy & Oracle VPS**: The Temporal Workers (which execute background tasks like this cleanup, email reminders, etc.) are hosted on a self-managed Oracle VPS using Dokploy. 
   - They pull the backend codebase from GitHub, but Dokploy builds its own local Docker images exclusively for running the Temporal worker processes.
   - Dokploy's local worker images have **no relation** to the Google Cloud Artifact Registry images.

### Environment Isolation & Task Queues
To prevent cross-environment execution, the Temporal workers are strictly isolated into independent containers within Dokploy:

* **Development Worker**: Runs on Dokploy as a separate Docker service, configured with `NODE_ENV=development`. It connects to the Temporal cluster and listens **exclusively** on the `default-dev` task queue. It manages cleanup for the `backend-dev` Google Cloud Artifact Registry.
* **Production Worker**: Runs on Dokploy as a distinct Docker service, configured with `NODE_ENV=production`. It listens **exclusively** on the `default-prod` task queue and manages cleanup for the `backend-prod` Artifact Registry in the `carenest-prods` GCP project.

This ensures background schedules (like cron cleanups) triggered in Production will only ever be executed by the Production worker with Production credentials.

## Multi-Architecture Images & OCI Manifests
When GitHub Actions pushes the main API image to Google Cloud (especially those built via `buildx` or Cloud Buildpacks), it often pushes a **multi-architecture Docker image**. This is not a single entity, but typically a set of three linked objects pushed simultaneously:
1. **Parent Manifest List (Index)**: The root pointer (e.g., `linux/amd64` vs `linux/arm64`).
2. **Child Manifest (`amd64`)**: The actual image layer for AMD architectures.
3. **Child Manifest (`arm64`)**: The actual image layer for ARM architectures.

These three objects share identical or near-identical `createTime` timestamps.

## The Cleanup Logic
Our script (`temporal/activities/system_cron.js`) pulls a flat list of all artifact versions in the Artifact Registry repository, sorts them by `createTime`, and **keeps the 20 most recent items**. Anything older than the 20th item is targeted for deletion.

### The "Chop" Problem (FAILED_PRECONDITION)
Because `keepCount` is a raw number (20), the threshold can fall squarely in the middle of a multi-architecture image deployment. For example:
* Item #20: Parent Manifest List -> **KEPT**
* Item #21: Child Manifest (`amd64`) -> **TARGETED FOR DELETION**

When the script attempts to delete the child manifest (Item #21), Google Cloud Artifact Registry strictly blocks it, returning `Error Code 9: FAILED_PRECONDITION`. Google enforces that a child layer **cannot** be deleted if its parent manifest still exists and references it. 

### Why `force: true` Is Insufficient
While the `@google-cloud/artifact-registry` SDK supports a `force: true` flag in the `deleteVersion` call, this flag only forces deletion if the version is referenced by *tags*. It **does not** bypass structural OCI parent-child dependencies. The API will still throw a precondition error if the parent is retained.

## The Graceful Skip Resolution
To cleanly handle this structural constraint without flagging the Temporal workflow as "failed", the cleanup logic uses a multi-pass approach with graceful error handling:

1. **MAX_PASSES Retries**: The script attempts to delete all non-protected, targeted versions up to 5 times. This handles legitimate parent-then-child deletion races (since deleting a parent first will fail if the child still exists, but the next pass will succeed once the child is gone).
2. **Code 9 Detection**: If a version permanently fails after 5 passes specifically with `err.code === 9`, the script recognizes this as a *child layer belonging to a parent that was kept in the top 20*.
3. **Graceful Categorization**: Instead of throwing an error or marking the item as `failedCount`, the script safely skips the layer and increments the `skippedProtected` counter.

This ensures that automated cleanups remain completely green/successful in Temporal, while accurately tracking layers that are structurally protected by retained parents.
