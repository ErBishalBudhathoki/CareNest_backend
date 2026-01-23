# Event-Driven Architecture (EDA) & Background Jobs

## Overview
The system has migrated from a monolithic, tightly coupled service architecture to an **Event-Driven Architecture (EDA)** backed by Redis and BullMQ. This ensures scalability, decoupling, and reliability for long-running tasks like invoice generation.

## 1. Core Architecture Components

### Event Bus (`backend/core/EventBus.js`)
A centralized event hub that abstracts `EventEmitter` and `Redis Pub/Sub`.
- **Local Events**: Handles in-process communication (e.g., immediate side effects).
- **Distributed Events**: Broadcasts events across multiple server instances via Redis.
- **Key Methods**:
  - `publish(event, payload)`: Emits an event to all subscribers.
  - `subscribe(event, handler)`: Registers a listener for an event.

### Queue Manager (`backend/core/QueueManager.js`)
Wrapper around **BullMQ** to manage distributed background jobs.
- **Queues**:
  - `invoice-generation`: Handles resource-intensive invoice calculations.
  - `email-notifications`: (Planned) For async email delivery.
- **Features**:
  - Automatic retries with exponential backoff.
  - Concurrency control per worker.
  - Redis-backed persistence (jobs survive server restarts).

### Redis Configuration (`backend/config/redis.js`)
Centralized Redis connection logic using `ioredis`.
- **Environment Variables**:
  - `REDIS_URL`: Primary connection string (supports `redis://` and `rediss://` for TLS).
  - `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Fallback for local development.
- **Features**:
  - **Auto-detection**: Automatically switches between local and cloud configurations based on environment variables.
  - **Robust Logging**: Logs connection lifecycle events (connecting, ready, error, close).
  - **Auto-reconnection**: Exponential backoff strategy for reliability.

## 2. Refactored Services & Flows

### Scheduler Service (`backend/services/schedulerService.js`)
**Before**: Directly called `TimesheetService` and `InvoiceService` upon shift completion.
**After**: Emits domain events.
- `shift.created`: When a new shift is scheduled.
- `shift.updated`: When details change.
- `shift.completed`: When a shift finishes.
- `shift.cancelled`: When a shift is removed.

### Shift Subscriber (`backend/subscribers/ShiftSubscriber.js`)
Listens for `shift.completed` and orchestrates side effects:
1.  **Timesheet Update**: Creates/Updates `workedTime` records in MongoDB.
2.  **Invoice Trigger**: Queues a job in `invoice-generation` queue for pre-calculation.

### Invoice Worker (`backend/workers/InvoiceWorker.js`)
Background worker that processes `invoice-generation` jobs.
- **Input**: `shiftId`, `clientEmail`, `organizationId`.
- **Action**: Generates invoice preview/data asynchronously.
- **Benefit**: Prevents HTTP request timeouts during bulk processing.

## 3. Infrastructure & Security

### Redis Cloud Integration
The system is designed to be cloud-agnostic regarding Redis.
- **Development**: Uses local Redis instance via Docker or system service.
- **Production/Cloud**: Connects to **Redis Cloud** (or any managed Redis provider) via `REDIS_URL`.
- **Cost Efficiency**: Eliminates the need for expensive dedicated heavy-provisioned instances (like Google Cloud Memorystore) for development/staging environments.

### Redis Caching (`backend/services/cacheService.js`)
New service for high-performance data retrieval.
- **Use Cases**: Caching Pricing Tables, Organization Settings.
- **TTL**: configurable time-to-live for cache keys.

### Rate Limiting (`backend/middleware/auth.js`)
Upgraded from in-memory to **Redis-backed Rate Limiting**.
- **Library**: `rate-limit-redis`.
- **Benefit**: Rate limits (e.g., login attempts) are shared across all server instances and persist after restarts.

### Docker Support (`backend/docker-compose.dev.yml`)
Added Docker Compose configuration to spin up a local Redis instance for development.

## 4. Quality Assurance

### Testing
- **Unit Tests**: `backend/tests/core/EventBus.test.js` - Verifies event publishing and subscription.
- **Integration Tests**: `backend/tests/integration/eventFlow.test.js` - Simulates the full flow:
  `Shift Complete -> Event Emitted -> Subscriber Triggered -> Job Queued`.

### Static Analysis
- All new components passed `eslint` checks with zero errors.

## 5. Usage Guide

### Publishing an Event
```javascript
const EventBus = require('../core/EventBus');
EventBus.publish('user.registered', { userId: '123', email: 'test@example.com' });
```

### Subscribing to an Event
```javascript
const EventBus = require('../core/EventBus');
EventBus.subscribe('user.registered', async (payload) => {
  console.log('New user:', payload.email);
});
```

### Adding a Background Job
```javascript
const QueueManager = require('../core/QueueManager');
await QueueManager.addJob('email-notifications', 'welcome-email', { email: 'test@example.com' });
```
