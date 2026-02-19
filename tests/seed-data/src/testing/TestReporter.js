import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import logger from '../utils/logger.js';

/**
 * TestReporter - Generates test execution reports in multiple formats
 * 
 * Responsibilities:
 * - Generate HTML reports with visualizations
 * - Generate JSON reports for machine parsing
 * - Display console output with color coding
 * - Filter reports by phase or test type
 * - Save reports to disk
 */
class TestReporter {
  constructor(config = {}) {
    this.config = {
      outputDir: config.outputDir || 'test-reports',
      includeApiCalls: config.includeApiCalls !== false,
      includeDbSnapshots: config.includeDbSnapshots !== false,
      ...config
    };
  }

  /**
   * Generate report in specified format
   * @param {Object} results - Test results from IntegrationTestRunner
   * @param {string} format - Report format (html, json, console)
   * @returns {Promise<Object>} Generated report
   */
  async generateReport(results, format = 'console') {
    const metadata = {
      generatedAt: new Date().toISOString(),
      environment: results.environment || 'unknown',
      totalTests: results.totalTests,
      passed: results.passed,
      failed: results.failed,
      skipped: results.skipped,
      duration: results.duration,
      passRate: results.totalTests > 0 ? ((results.passed / results.totalTests) * 100).toFixed(2) : 0
    };

    switch (format) {
      case 'html':
        return await this._generateHTMLReport(results, metadata);
      case 'json':
        return await this._generateJSONReport(results, metadata);
      case 'console':
        return this._generateConsoleReport(results, metadata);
      default:
        throw new Error(`Unsupported report format: ${format}`);
    }
  }

  /**
   * Save report to disk
   * @param {Object} report - Generated report
   * @param {string} filename - Output filename
   * @returns {Promise<string>} Path to saved report
   */
  async saveReport(report, filename) {
    try {
      // Ensure output directory exists
      await fs.mkdir(this.config.outputDir, { recursive: true });

      const filepath = path.join(this.config.outputDir, filename);
      await fs.writeFile(filepath, report.content);

      logger.info(`Report saved to: ${filepath}`);
      return filepath;
    } catch (error) {
      logger.error('Failed to save report:', error);
      throw error;
    }
  }

  /**
   * Display console output with color coding
   * @param {Object} results - Test results
   */
  displayConsole(results) {
    const report = this._generateConsoleReport(results);
    console.log(report.content);
  }

  /**
   * Filter results by phase
   * @param {Object} results - Test results
   * @param {string} phase - Feature phase to filter by
   * @returns {Object} Filtered results
   */
  filterByPhase(results, phase) {
    const filteredTestCases = results.testCases.filter(test => test.phase === phase);
    
    return {
      ...results,
      testCases: filteredTestCases,
      totalTests: filteredTestCases.length,
      passed: filteredTestCases.filter(t => t.status === 'passed').length,
      failed: filteredTestCases.filter(t => t.status === 'failed').length,
      skipped: filteredTestCases.filter(t => t.status === 'skipped').length
    };
  }

  /**
   * Filter results by test type
   * @param {Object} results - Test results
   * @param {string} testType - Test type to filter by
   * @returns {Object} Filtered results
   */
  filterByTestType(results, testType) {
    const filteredTestCases = results.testCases.filter(test => 
      test.suite && test.suite.includes(testType)
    );
    
    return {
      ...results,
      testCases: filteredTestCases,
      totalTests: filteredTestCases.length,
      passed: filteredTestCases.filter(t => t.status === 'passed').length,
      failed: filteredTestCases.filter(t => t.status === 'failed').length,
      skipped: filteredTestCases.filter(t => t.status === 'skipped').length
    };
  }

  /**
   * Generate HTML report
   * @private
   */
  async _generateHTMLReport(results, metadata) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>E2E Test Report - ${metadata.generatedAt}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
    .header h1 { font-size: 28px; margin-bottom: 10px; }
    .header .meta { opacity: 0.9; font-size: 14px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; padding: 30px; }
    .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
    .stat-card .value { font-size: 36px; font-weight: bold; margin-bottom: 5px; }
    .stat-card .label { color: #666; font-size: 14px; text-transform: uppercase; }
    .stat-card.passed .value { color: #28a745; }
    .stat-card.failed .value { color: #dc3545; }
    .stat-card.skipped .value { color: #ffc107; }
    .stat-card.total .value { color: #007bff; }
    .stat-card.duration .value { font-size: 24px; }
    .tests { padding: 30px; }
    .test-case { border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 15px; overflow: hidden; }
    .test-header { padding: 15px 20px; background: #f8f9fa; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
    .test-header:hover { background: #e9ecef; }
    .test-name { font-weight: 600; font-size: 16px; }
    .test-status { padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .test-status.passed { background: #d4edda; color: #155724; }
    .test-status.failed { background: #f8d7da; color: #721c24; }
    .test-status.skipped { background: #fff3cd; color: #856404; }
    .test-details { padding: 20px; background: white; display: none; }
    .test-details.expanded { display: block; }
    .test-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px; }
    .test-meta-item { font-size: 14px; }
    .test-meta-item .label { color: #666; margin-bottom: 5px; }
    .test-meta-item .value { font-weight: 600; }
    .error-box { background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; padding: 15px; margin-top: 15px; }
    .error-box .error-message { color: #721c24; font-family: monospace; font-size: 13px; white-space: pre-wrap; }
    .api-calls { margin-top: 20px; }
    .api-call { background: #f8f9fa; border-left: 3px solid #007bff; padding: 10px 15px; margin-bottom: 10px; font-size: 13px; }
    .api-call .method { font-weight: 600; color: #007bff; }
    .api-call .url { color: #666; }
    .api-call .status { float: right; }
    .api-call .status.success { color: #28a745; }
    .api-call .status.error { color: #dc3545; }
    h2 { margin-bottom: 20px; color: #333; }
    h3 { margin-bottom: 15px; color: #555; font-size: 16px; }
  </style>
  <script>
    function toggleDetails(id) {
      const details = document.getElementById('details-' + id);
      details.classList.toggle('expanded');
    }
  </script>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>E2E Test Report</h1>
      <div class="meta">
        Generated: ${metadata.generatedAt} | Environment: ${metadata.environment || 'unknown'}
      </div>
    </div>
    
    <div class="summary">
      <div class="stat-card total">
        <div class="value">${metadata.totalTests}</div>
        <div class="label">Total Tests</div>
      </div>
      <div class="stat-card passed">
        <div class="value">${metadata.passed}</div>
        <div class="label">Passed</div>
      </div>
      <div class="stat-card failed">
        <div class="value">${metadata.failed}</div>
        <div class="label">Failed</div>
      </div>
      <div class="stat-card skipped">
        <div class="value">${metadata.skipped}</div>
        <div class="label">Skipped</div>
      </div>
      <div class="stat-card duration">
        <div class="value">${(metadata.duration / 1000).toFixed(2)}s</div>
        <div class="label">Duration</div>
      </div>
      <div class="stat-card">
        <div class="value">${metadata.passRate}%</div>
        <div class="label">Pass Rate</div>
      </div>
    </div>
    
    <div class="tests">
      <h2>Test Cases</h2>
      ${results.testCases.map((test, index) => this._generateTestCaseHTML(test, index)).join('')}
    </div>
  </div>
</body>
</html>
    `;

    return {
      format: 'html',
      content: html,
      metadata
    };
  }

  /**
   * Generate HTML for a single test case
   * @private
   */
  _generateTestCaseHTML(test, index) {
    const apiCallsHTML = this.config.includeApiCalls && test.apiCalls && test.apiCalls.length > 0
      ? `
        <div class="api-calls">
          <h3>API Calls (${test.apiCalls.length})</h3>
          ${test.apiCalls.map(call => `
            <div class="api-call">
              <span class="method">${call.method}</span>
              <span class="url">${call.url}</span>
              <span class="status ${call.error ? 'error' : 'success'}">
                ${call.status || 'N/A'} (${call.duration}ms)
              </span>
            </div>
          `).join('')}
        </div>
      `
      : '';

    const errorHTML = test.error
      ? `
        <div class="error-box">
          <h3>Error Details</h3>
          <div class="error-message">${test.error.message}</div>
        </div>
      `
      : '';

    const dbSnapshotHTML = this.config.includeDbSnapshots && test.databaseSnapshot
      ? `
        <div class="api-calls">
          <h3>Database Snapshot</h3>
          <pre style="background: #f8f9fa; padding: 10px; border-radius: 4px; font-size: 12px;">${JSON.stringify(test.databaseSnapshot, null, 2)}</pre>
        </div>
      `
      : '';

    return `
      <div class="test-case">
        <div class="test-header" onclick="toggleDetails(${index})">
          <div class="test-name">${test.name}</div>
          <div>
            <span class="test-status ${test.status}">${test.status}</span>
          </div>
        </div>
        <div class="test-details" id="details-${index}">
          <div class="test-meta">
            <div class="test-meta-item">
              <div class="label">Suite</div>
              <div class="value">${test.suite || 'N/A'}</div>
            </div>
            <div class="test-meta-item">
              <div class="label">Phase</div>
              <div class="value">${test.phase || 'N/A'}</div>
            </div>
            <div class="test-meta-item">
              <div class="label">Duration</div>
              <div class="value">${test.duration}ms</div>
            </div>
          </div>
          ${errorHTML}
          ${apiCallsHTML}
          ${dbSnapshotHTML}
        </div>
      </div>
    `;
  }

  /**
   * Generate JSON report
   * @private
   */
  async _generateJSONReport(results, metadata) {
    const report = {
      metadata,
      summary: {
        totalTests: metadata.totalTests,
        passed: metadata.passed,
        failed: metadata.failed,
        skipped: metadata.skipped,
        duration: metadata.duration,
        passRate: metadata.passRate
      },
      testCases: results.testCases.map(test => ({
        name: test.name,
        suite: test.suite,
        phase: test.phase,
        status: test.status,
        duration: test.duration,
        ...(test.error && { error: test.error }),
        ...(this.config.includeApiCalls && test.apiCalls && { apiCalls: test.apiCalls }),
        ...(this.config.includeDbSnapshots && test.databaseSnapshot && { databaseSnapshot: test.databaseSnapshot })
      })),
      coverage: results.coverage
    };

    return {
      format: 'json',
      content: JSON.stringify(report, null, 2),
      metadata
    };
  }

  /**
   * Generate console report
   * @private
   */
  _generateConsoleReport(results, metadata) {
    const lines = [];
    
    lines.push('');
    lines.push(chalk.bold.cyan('═══════════════════════════════════════════════════════'));
    lines.push(chalk.bold.cyan('              E2E TEST REPORT'));
    lines.push(chalk.bold.cyan('═══════════════════════════════════════════════════════'));
    lines.push('');
    
    lines.push(chalk.gray(`Generated: ${metadata?.generatedAt || new Date().toISOString()}`));
    lines.push(chalk.gray(`Environment: ${metadata?.environment || results.environment || 'unknown'}`));
    lines.push('');
    
    lines.push(chalk.bold('Summary:'));
    lines.push(`  Total Tests: ${chalk.bold(results.totalTests)}`);
    lines.push(`  ${chalk.green('✓ Passed:')} ${chalk.bold.green(results.passed)}`);
    lines.push(`  ${chalk.red('✗ Failed:')} ${chalk.bold.red(results.failed)}`);
    lines.push(`  ${chalk.yellow('○ Skipped:')} ${chalk.bold.yellow(results.skipped)}`);
    lines.push(`  Duration: ${chalk.bold((results.duration / 1000).toFixed(2))}s`);
    
    const passRate = results.totalTests > 0 ? ((results.passed / results.totalTests) * 100).toFixed(2) : 0;
    const passRateColor = passRate >= 80 ? chalk.green : passRate >= 50 ? chalk.yellow : chalk.red;
    lines.push(`  Pass Rate: ${passRateColor.bold(passRate + '%')}`);
    lines.push('');
    
    if (results.testCases && results.testCases.length > 0) {
      lines.push(chalk.bold('Test Cases:'));
      lines.push('');
      
      for (const test of results.testCases) {
        const statusIcon = test.status === 'passed' ? chalk.green('✓') : 
                          test.status === 'failed' ? chalk.red('✗') : 
                          chalk.yellow('○');
        const statusText = test.status === 'passed' ? chalk.green(test.status) :
                          test.status === 'failed' ? chalk.red(test.status) :
                          chalk.yellow(test.status);
        
        lines.push(`  ${statusIcon} ${test.name} ${chalk.gray(`(${test.duration}ms)`)}`);
        lines.push(`    Suite: ${chalk.cyan(test.suite || 'N/A')} | Phase: ${chalk.cyan(test.phase || 'N/A')} | Status: ${statusText}`);
        
        if (test.error) {
          lines.push(chalk.red(`    Error: ${test.error.message}`));
        }
        
        if (this.config.includeApiCalls && test.apiCalls && test.apiCalls.length > 0) {
          lines.push(chalk.gray(`    API Calls: ${test.apiCalls.length}`));
        }
        
        lines.push('');
      }
    }
    
    if (results.coverage) {
      lines.push(chalk.bold('Coverage:'));
      lines.push(`  Unique Endpoints Tested: ${chalk.bold(results.coverage.uniqueEndpoints)}`);
      lines.push(`  Total API Calls: ${chalk.bold(results.coverage.totalCalls)}`);
      lines.push('');
    }
    
    lines.push(chalk.bold.cyan('═══════════════════════════════════════════════════════'));
    lines.push('');

    return {
      format: 'console',
      content: lines.join('\n'),
      metadata
    };
  }
}

export default TestReporter;
