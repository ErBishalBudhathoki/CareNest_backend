#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import logger from '../utils/logger.js';
import configManager from '../config/ConfigurationManager.js';
import SeedDataGenerator from '../generator/SeedDataGenerator.js';
import DataManagement from '../management/DataManagement.js';
import IntegrationTestRunner from '../testing/IntegrationTestRunner.js';
import TestReporter from '../testing/TestReporter.js';
import CoverageTracker from '../testing/CoverageTracker.js';

const program = new Command();

program
  .name('seed-data-cli')
  .description('E2E Testing and Seed Data Generation System for CareNest')
  .version('1.0.0');

// Generate command
program
  .command('generate')
  .description('Generate seed data')
  .option('-e, --env <environment>', 'Environment (dev, staging, prod-like)', 'development')
  .option('-p, --phase <phase>', 'Feature phase or "all"', 'all')
  .option('-v, --volume <preset>', 'Volume preset (small, medium, large)', 'small')
  .option('-c, --custom-volume <file>', 'Custom volume configuration file')
  .option('-i, --incremental', 'Add to existing data without wiping')
  .action(async (options) => {
    const spinner = ora('Generating seed data...').start();
    logger.info('Seed data generation started', options);
    
    try {
      const envConfig = await configManager.loadEnvironmentConfig(options.env);
      const volumeConfig = options.customVolume 
        ? await configManager.loadVolumeConfig(options.customVolume)
        : await configManager.loadVolumeConfig(options.volume);
      
      const generator = new SeedDataGenerator({
        environment: options.env,
        apiBaseUrl: envConfig.apiBaseUrl,
        mongoUri: envConfig.database.connectionString,
        volumePreset: options.volume
      });
      
      await generator.initialize();
      
      const result = await generator.generate();
      
      await generator.cleanup();
      
      spinner.succeed('Seed data generation completed');
      console.log(chalk.green('\n✓ Generation Summary:'));
      console.log(chalk.gray(`  Entities Created: ${JSON.stringify(result.stats.byType, null, 2)}`));
      
      if (result.errors && result.errors.length > 0) {
        console.log(chalk.yellow(`\n⚠️  ${result.errors.length} errors occurred:`));
        result.errors.forEach(err => console.log(chalk.yellow(`  - ${err.message}`)));
      }
    } catch (error) {
      spinner.fail('Seed data generation failed');
      console.log(chalk.red(`\n❌ Error: ${error.message}`));
      logger.error('Seed data generation failed', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  });

// Cleanup command
program
  .command('cleanup')
  .description('Clean up seed data')
  .option('-e, --env <environment>', 'Environment', 'development')
  .option('-p, --phase <phase>', 'Feature phase or "all"', 'all')
  .option('--confirm', 'Skip confirmation prompt')
  .action(async (options) => {
    const spinner = ora('Cleaning up seed data...').start();
    logger.info('Seed data cleanup started', options);
    
    try {
      const envConfig = await configManager.loadEnvironmentConfig(options.env);
      
      const dataManagement = new DataManagement({
        environment: options.env,
        mongoUri: envConfig.database.connectionString
      });
      
      const phases = options.phase === 'all' ? undefined : [options.phase];
      
      const result = await dataManagement.cleanup({
        phases,
        confirm: options.confirm
      });
      
      spinner.succeed('Cleanup completed');
      console.log(chalk.green('\n✓ Cleanup Summary:'));
      console.log(chalk.gray(`  Entities Removed: ${JSON.stringify(result.entitiesRemoved, null, 2)}`));
      console.log(chalk.gray(`  Duration: ${(result.duration / 1000).toFixed(2)}s`));
      
      if (result.errors && result.errors.length > 0) {
        console.log(chalk.yellow(`\n⚠️  ${result.errors.length} errors occurred:`));
        result.errors.forEach(err => console.log(chalk.yellow(`  - ${err.message}`)));
      }
    } catch (error) {
      spinner.fail('Cleanup failed');
      console.log(chalk.red(`\n❌ Error: ${error.message}`));
      logger.error('Cleanup failed', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  });

// Reset command
program
  .command('reset')
  .description('Reset all seed data')
  .option('-e, --env <environment>', 'Environment', 'development')
  .option('--confirm', 'Skip confirmation prompt')
  .action(async (options) => {
    const spinner = ora('Resetting seed data...').start();
    logger.info('Seed data reset started', options);
    
    try {
      const envConfig = await configManager.loadEnvironmentConfig(options.env);
      
      const dataManagement = new DataManagement({
        environment: options.env,
        mongoUri: envConfig.database.connectionString
      });
      
      const result = await dataManagement.reset({
        confirm: options.confirm
      });
      
      spinner.succeed('Reset completed');
      console.log(chalk.green('\n✓ Reset Summary:'));
      console.log(chalk.gray(`  Entities Removed: ${JSON.stringify(result.entitiesRemoved, null, 2)}`));
      console.log(chalk.gray(`  Duration: ${(result.duration / 1000).toFixed(2)}s`));
      
      if (result.errors && result.errors.length > 0) {
        console.log(chalk.yellow(`\n⚠️  ${result.errors.length} errors occurred:`));
        result.errors.forEach(err => console.log(chalk.yellow(`  - ${err.message}`)));
      }
    } catch (error) {
      spinner.fail('Reset failed');
      console.log(chalk.red(`\n❌ Error: ${error.message}`));
      logger.error('Reset failed', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show current seed data status')
  .option('-e, --env <environment>', 'Environment', 'development')
  .action(async (options) => {
    const spinner = ora('Checking seed data status...').start();
    logger.info('Status check started', options);
    
    try {
      const envConfig = await configManager.loadEnvironmentConfig(options.env);
      
      const dataManagement = new DataManagement({
        environment: options.env,
        mongoUri: envConfig.database.connectionString
      });
      
      const status = await dataManagement.getStatus();
      
      spinner.succeed('Status check completed');
      
      console.log(chalk.cyan('\n📊 Seed Data Status:'));
      console.log(chalk.gray(`  Environment: ${options.env}`));
      console.log(chalk.gray(`  Total Entities: ${JSON.stringify(status.totalEntities, null, 2)}`));
      console.log(chalk.gray(`  Last Generated: ${status.lastGenerated || 'Never'}`));
      console.log(chalk.gray(`  Last Cleaned: ${status.lastCleaned || 'Never'}`));
    } catch (error) {
      spinner.fail('Status check failed');
      console.log(chalk.red(`\n❌ Error: ${error.message}`));
      logger.error('Status check failed', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  });

// Test command
program
  .command('test')
  .description('Run integration tests')
  .option('-e, --env <environment>', 'Environment', 'development')
  .option('-p, --phase <phase>', 'Feature phase or "all"', 'all')
  .option('--parallel', 'Run tests in parallel')
  .option('-f, --report-format <format>', 'Report format (html, json, console)', 'console')
  .action(async (options) => {
    const spinner = ora('Running integration tests...').start();
    logger.info('Integration tests started', options);
    
    try {
      const envConfig = await configManager.loadEnvironmentConfig(options.env);
      
      const testRunner = new IntegrationTestRunner({
        environment: options.env,
        apiBaseUrl: envConfig.apiBaseUrl,
        mongoUri: envConfig.database.connectionString,
        parallel: options.parallel
      });
      
      const phases = options.phase === 'all' ? ['all'] : [options.phase];
      
      const results = await testRunner.runTests({ phases });
      
      spinner.succeed('Integration tests completed');
      
      const reporter = new TestReporter();
      
      if (options.reportFormat === 'console') {
        reporter.displayConsole(results);
      } else {
        const report = await reporter.generateReport(results, options.reportFormat);
        const filename = `test-report-${Date.now()}.${options.reportFormat}`;
        await reporter.saveReport(report, filename);
        console.log(chalk.green(`\n✓ Report saved: ${filename}`));
      }
      
      if (results.failed > 0) {
        process.exit(1);
      }
    } catch (error) {
      spinner.fail('Tests failed');
      console.log(chalk.red(`\n❌ Error: ${error.message}`));
      logger.error('Tests failed', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  });

// Coverage command
program
  .command('coverage')
  .description('Show API endpoint coverage')
  .option('-e, --env <environment>', 'Environment', 'development')
  .option('-p, --phase <phase>', 'Filter by feature phase')
  .option('--critical-only', 'Show only critical endpoints')
  .action(async (options) => {
    const spinner = ora('Generating coverage report...').start();
    logger.info('Coverage report started', options);
    
    try {
      // Load previous test results to calculate coverage
      const coverageTracker = new CoverageTracker();
      
      // TODO: Load API call log from previous test runs
      // For now, display empty coverage report
      
      spinner.succeed('Coverage report generated');
      
      const report = coverageTracker.generateReport({
        phase: options.phase,
        criticalOnly: options.criticalOnly
      });
      
      coverageTracker.displayConsoleReport();
      
      // Save detailed report
      const filename = `coverage-report-${Date.now()}.json`;
      await coverageTracker.saveReport(`test-reports/${filename}`);
      console.log(chalk.green(`\n✓ Detailed report saved: test-reports/${filename}`));
    } catch (error) {
      spinner.fail('Coverage report failed');
      console.log(chalk.red(`\n❌ Error: ${error.message}`));
      logger.error('Coverage report failed', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
