# Event-Driven Architecture & Redis Integration

## Overview
This document outlines the Event-Driven Architecture (EDA) implemented to decouple services, improve scalability, and handle asynchronous tasks like invoice generation.

## Components

### 1. Event Bus (`backend/core/EventBus.js`)
- **Purpose**: Central hub for publishing and subscribing to domain events.
- **Implementation**: Wraps Node.js `EventEmitter` and `ioredis` Pub/Sub.
- **Capabilities**:
  - `publish(event, payload)`: Emits locally and broadcasts to Redis (for distributed services).
  - `subscribe(event, handler)`: Listens for events.

### 2. Job Queue (`backend/core/QueueManager.js`)
- **Purpose**: Handle background tasks reliably.
- **Implementation**: Uses `bullmq` (backed by Redis).
- **Queues**:
  - `invoice-generation`: Processes invoice calculation jobs.

### 3. Redis Caching (`backend/services/cacheService.js`)
- **Purpose**: Cache frequently accessed data (Pricing, Org Settings).
- **Implementation**: Simple key-value store with TTL using `ioredis`.

### 4. Rate Limiting
- **Implementation**: `express-rate-limit` with `rate-limit-redis` store.
- **Persistence**: Rate limits survive server restarts.

## Event Flows

### Shift Completion Flow
1. **Trigger**: `SchedulerService.updateShift` sets status to `completed`.
2. **Event**: `shift.completed` is published via `EventBus`.
3. **Subscriber**: `ShiftSubscriber` listens to `shift.completed`.
4. **Action 1 (Timesheet)**: `ShiftSubscriber` creates/updates a `workedTime` record in MongoDB.
5. **Action 2 (Invoice)**: `ShiftSubscriber` queues a job `generate-preview` in `invoice-generation` queue.
6. **Worker**: `InvoiceWorker` picks up the job and executes `InvoiceGenerationService` logic (pre-calculation).

## Configuration
- **Redis**: Configured in `backend/config/redis.js`.
- **Env Variables**: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`.

## Testing
- **Unit Tests**: `backend/tests/core/EventBus.test.js`
- **Integration Tests**: `backend/tests/integration/eventFlow.test.js`
