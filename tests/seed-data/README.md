# E2E Testing and Seed Data Generation System

Automated end-to-end testing system with comprehensive seed data generation for CareNest Flutter application.

## Overview

This system addresses the challenge of testing 200+ API endpoints across 10 major feature phases by providing:

- **Automated Seed Data Generation**: Creates realistic test data for all database entities
- **Smart Relationship Building**: Maintains referential integrity across all entities
- **Integration Test Suite**: Automated tests for critical workflows
- **Multi-Environment Support**: Works with development, staging, and production-like environments
- **Data Management**: Easy cleanup and reset with production data protection

## Quick Start

### Installation

```bash
cd backend/tests/seed-data
npm install
```

### Generate Seed Data

```bash
# Generate data for all phases (small volume)
npm run seed:generate -- --env development --volume small

# Generate data for specific phase
npm run seed:generate -- --env development --phase financial-intelligence --volume medium

# Incremental generation (add more data)
npm run seed:generate -- --env development --volume small --incremental
```

### Run Integration Tests

```bash
# Run all integration tests
npm run test:e2e -- --env development

# Run tests for specific phase
npm run test:e2e -- --env development --phase care-intelligence

# Run tests in parallel
npm run test:e2e -- --env development --parallel
```

### Data Management

```bash
# Check current seed data status
npm run seed:status -- --env development

# Cleanup seed data
npm run seed:cleanup -- --env development --confirm

# Reset all seed data
npm run seed:reset -- --env development --confirm

# Cleanup specific phase
npm run seed:cleanup -- --env development --phase financial-intelligence --confirm
```

### API Coverage

```bash
# Show API endpoint coverage
npm run test:coverage -- --env development
```

## Configuration

### Environment Configuration

Edit files in `config/environments/`:
- `development.json` - Local development
- `staging.json` - Staging environment
- `production-like.json` - Production-like testing

### Volume Presets

Edit files in `config/volumes/`:
- `small.json` - Quick testing (15-20 entities per type)
- `medium.json` - Standard testing (80-150 entities per type)
- `large.json` - Performance testing (400-800 entities per type)

### Feature Phase Configuration

Edit files in `config/features/` to customize entity types and dependencies for each phase.

## Features

### 10 Feature Phases Supported

1. **Financial Intelligence** - Invoices, payments, budgets, forecasts
2. **Care Intelligence** - Care plans, medications, incidents, risk assessments
3. **Workforce Optimization** - Schedules, performance metrics, resource allocation
4. **Real-Time Portal** - Tracking data, messages, service confirmations
5. **Client Portal** - Client accounts, appointments, invoices
6. **Payroll** - Timesheets, pay periods, deductions
7. **Offline Sync** - Sync queues, conflict records
8. **Compliance** - Audit logs, compliance checks, certifications
9. **Expenses** - Expense records, receipts, approvals
10. **Scheduling** - Shifts, assignments, availability
11. **Analytics** - Metrics, predictions, reports

### Key Capabilities

- ✅ Realistic data generation with faker.js
- ✅ Automatic relationship building
- ✅ Backend validation compliance
- ✅ Incremental data generation
- ✅ Selective cleanup by phase or entity type
- ✅ Production data protection
- ✅ Multi-environment support
- ✅ Detailed test reporting
- ✅ API endpoint coverage tracking

## Project Structure

```
backend/tests/seed-data/
├── config/
│   ├── environments/       # Environment configurations
│   ├── features/          # Feature phase configurations
│   └── volumes/           # Volume presets
├── src/
│   ├── cli/              # CLI interface
│   ├── config/           # Configuration manager
│   ├── factories/        # Entity factories
│   ├── generators/       # Seed data generator
│   ├── relationships/    # Relationship builder
│   ├── validators/       # Data validators
│   ├── tests/           # Integration test runner
│   ├── reporters/       # Test reporters
│   ├── management/      # Data management tools
│   └── utils/           # Utilities and logger
├── logs/                # Log files
├── tests/              # Unit and property tests
└── README.md

```

## Development

### Run Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Logging

Logs are written to the `logs/` directory:
- `combined.log` - All logs
- `error.log` - Error logs only
- `seed-data.log` - Seed data operations
- `tests.log` - Test execution

Log level can be controlled with `LOG_LEVEL` environment variable:
```bash
LOG_LEVEL=debug npm run seed:generate
```

## Troubleshooting

### Connection Issues

If you encounter connection errors:
1. Verify the API is running and accessible
2. Check database connection string in environment config
3. Ensure authentication credentials are correct

### Data Generation Failures

If seed data generation fails:
1. Check logs in `logs/seed-data.log`
2. Verify backend validation rules
3. Try with smaller volume preset
4. Check for database constraints

### Test Failures

If integration tests fail:
1. Check logs in `logs/tests.log`
2. Verify seed data was generated successfully
3. Check API endpoint availability
4. Review test report for detailed error information

## Contributing

When adding new features:
1. Add entity factory in `src/factories/`
2. Update relationship rules in `src/relationships/`
3. Add integration tests in `src/tests/suites/`
4. Update feature configuration in `config/features/`

## License

MIT

## Support

For issues or questions, please refer to the main project documentation or contact the development team.
