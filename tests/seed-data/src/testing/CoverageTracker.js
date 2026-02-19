import { getAllEndpoints, getCriticalEndpoints, getEndpointsForPhase, getTotalEndpointCount, getEndpointCountByPhase } from './endpointRegistry.js';
import logger from '../utils/logger.js';

/**
 * CoverageTracker - Tracks API endpoint test coverage
 * 
 * Responsibilities:
 * - Track which endpoints are called during tests
 * - Generate coverage reports
 * - Identify untested endpoints
 * - Calculate coverage percentages
 * - Highlight critical untested endpoints
 */
class CoverageTracker {
  constructor() {
    this.testedEndpoints = new Set();
    this.endpointCallCounts = new Map();
    this.allEndpoints = getAllEndpoints();
    this.criticalEndpoints = getCriticalEndpoints();
  }

  /**
   * Record an API call
   * @param {string} method - HTTP method
   * @param {string} path - API path
   */
  recordCall(method, path) {
    // Normalize path (remove query parameters and trailing slashes)
    const normalizedPath = this._normalizePath(path);
    const endpoint = `${method} ${normalizedPath}`;
    
    this.testedEndpoints.add(endpoint);
    
    const currentCount = this.endpointCallCounts.get(endpoint) || 0;
    this.endpointCallCounts.set(endpoint, currentCount + 1);
  }

  /**
   * Record multiple API calls from test results
   * @param {Array} apiCalls - Array of API call objects
   */
  recordCalls(apiCalls) {
    for (const call of apiCalls) {
      this.recordCall(call.method, call.url);
    }
  }

  /**
   * Generate coverage report
   * @param {Object} options - Report options
   * @returns {Object} Coverage report
   */
  generateReport(options = {}) {
    const { phase = null, criticalOnly = false } = options;

    let relevantEndpoints = this.allEndpoints;
    
    if (phase) {
      relevantEndpoints = getEndpointsForPhase(phase).map(ep => ({
        ...ep,
        phase
      }));
    }
    
    if (criticalOnly) {
      relevantEndpoints = relevantEndpoints.filter(ep => ep.critical);
    }

    const testedEndpoints = [];
    const untestedEndpoints = [];
    
    for (const endpoint of relevantEndpoints) {
      const endpointKey = `${endpoint.method} ${endpoint.path}`;
      const callCount = this.endpointCallCounts.get(endpointKey) || 0;
      
      const endpointInfo = {
        method: endpoint.method,
        path: endpoint.path,
        phase: endpoint.phase,
        critical: endpoint.critical,
        callCount
      };
      
      if (this.testedEndpoints.has(endpointKey)) {
        testedEndpoints.push(endpointInfo);
      } else {
        untestedEndpoints.push(endpointInfo);
      }
    }

    const totalEndpoints = relevantEndpoints.length;
    const testedCount = testedEndpoints.length;
    const untestedCount = untestedEndpoints.length;
    const coveragePercentage = totalEndpoints > 0 ? ((testedCount / totalEndpoints) * 100).toFixed(2) : 0;

    // Calculate critical endpoint coverage
    const criticalEndpointsInScope = relevantEndpoints.filter(ep => ep.critical);
    const testedCriticalCount = testedEndpoints.filter(ep => ep.critical).length;
    const criticalCoveragePercentage = criticalEndpointsInScope.length > 0 
      ? ((testedCriticalCount / criticalEndpointsInScope.length) * 100).toFixed(2) 
      : 0;

    return {
      summary: {
        totalEndpoints,
        testedCount,
        untestedCount,
        coveragePercentage: parseFloat(coveragePercentage),
        criticalEndpoints: criticalEndpointsInScope.length,
        testedCriticalCount,
        criticalCoveragePercentage: parseFloat(criticalCoveragePercentage)
      },
      testedEndpoints: testedEndpoints.sort((a, b) => b.callCount - a.callCount),
      untestedEndpoints: untestedEndpoints.sort((a, b) => {
        // Sort critical endpoints first
        if (a.critical && !b.critical) return -1;
        if (!a.critical && b.critical) return 1;
        return a.path.localeCompare(b.path);
      }),
      byPhase: this._getCoverageByPhase()
    };
  }

  /**
   * Get untested endpoints
   * @param {Object} options - Filter options
   * @returns {Array} Array of untested endpoints
   */
  getUntestedEndpoints(options = {}) {
    const { phase = null, criticalOnly = false } = options;
    const report = this.generateReport({ phase, criticalOnly });
    return report.untestedEndpoints;
  }

  /**
   * Get tested endpoints
   * @param {Object} options - Filter options
   * @returns {Array} Array of tested endpoints
   */
  getTestedEndpoints(options = {}) {
    const { phase = null, criticalOnly = false } = options;
    const report = this.generateReport({ phase, criticalOnly });
    return report.testedEndpoints;
  }

  /**
   * Check if an endpoint is tested
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @returns {boolean} True if endpoint is tested
   */
  isEndpointTested(method, path) {
    const normalizedPath = this._normalizePath(path);
    const endpoint = `${method} ${normalizedPath}`;
    return this.testedEndpoints.has(endpoint);
  }

  /**
   * Get call count for an endpoint
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @returns {number} Number of times endpoint was called
   */
  getCallCount(method, path) {
    const normalizedPath = this._normalizePath(path);
    const endpoint = `${method} ${normalizedPath}`;
    return this.endpointCallCounts.get(endpoint) || 0;
  }

  /**
   * Get coverage statistics
   * @returns {Object} Coverage statistics
   */
  getStatistics() {
    const report = this.generateReport();
    return report.summary;
  }

  /**
   * Display coverage report in console
   */
  displayConsoleReport() {
    const report = this.generateReport();
    
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('           API ENDPOINT COVERAGE REPORT');
    console.log('═══════════════════════════════════════════════════════\n');
    
    console.log('Summary:');
    console.log(`  Total Endpoints: ${report.summary.totalEndpoints}`);
    console.log(`  Tested: ${report.summary.testedCount} (${report.summary.coveragePercentage}%)`);
    console.log(`  Untested: ${report.summary.untestedCount}`);
    console.log(`  Critical Endpoints: ${report.summary.criticalEndpoints}`);
    console.log(`  Tested Critical: ${report.summary.testedCriticalCount} (${report.summary.criticalCoveragePercentage}%)`);
    console.log('');
    
    if (report.untestedEndpoints.length > 0) {
      console.log('Untested Endpoints:');
      const criticalUntested = report.untestedEndpoints.filter(ep => ep.critical);
      const nonCriticalUntested = report.untestedEndpoints.filter(ep => !ep.critical);
      
      if (criticalUntested.length > 0) {
        console.log('\n  CRITICAL:');
        for (const endpoint of criticalUntested) {
          console.log(`    ⚠️  ${endpoint.method} ${endpoint.path} [${endpoint.phase}]`);
        }
      }
      
      if (nonCriticalUntested.length > 0) {
        console.log('\n  Non-Critical:');
        for (const endpoint of nonCriticalUntested.slice(0, 10)) {
          console.log(`    ○  ${endpoint.method} ${endpoint.path} [${endpoint.phase}]`);
        }
        if (nonCriticalUntested.length > 10) {
          console.log(`    ... and ${nonCriticalUntested.length - 10} more`);
        }
      }
    }
    
    console.log('\nCoverage by Phase:');
    for (const [phase, stats] of Object.entries(report.byPhase)) {
      const percentage = stats.total > 0 ? ((stats.tested / stats.total) * 100).toFixed(1) : 0;
      console.log(`  ${phase}: ${stats.tested}/${stats.total} (${percentage}%)`);
    }
    
    console.log('\n═══════════════════════════════════════════════════════\n');
  }

  /**
   * Save coverage report to file
   * @param {string} filepath - Output file path
   * @returns {Promise<void>}
   */
  async saveReport(filepath) {
    const fs = await import('fs/promises');
    const report = this.generateReport();
    
    const reportData = {
      generatedAt: new Date().toISOString(),
      ...report
    };
    
    await fs.writeFile(filepath, JSON.stringify(reportData, null, 2));
    logger.info(`Coverage report saved to: ${filepath}`);
  }

  /**
   * Reset coverage tracking
   */
  reset() {
    this.testedEndpoints.clear();
    this.endpointCallCounts.clear();
  }

  /**
   * Get coverage by phase
   * @private
   * @returns {Object} Coverage statistics by phase
   */
  _getCoverageByPhase() {
    const phaseStats = {};
    const endpointCountByPhase = getEndpointCountByPhase();
    
    for (const [phase, totalCount] of Object.entries(endpointCountByPhase)) {
      const phaseEndpoints = getEndpointsForPhase(phase);
      let testedCount = 0;
      
      for (const endpoint of phaseEndpoints) {
        const endpointKey = `${endpoint.method} ${endpoint.path}`;
        if (this.testedEndpoints.has(endpointKey)) {
          testedCount++;
        }
      }
      
      phaseStats[phase] = {
        total: totalCount,
        tested: testedCount,
        untested: totalCount - testedCount,
        percentage: totalCount > 0 ? ((testedCount / totalCount) * 100).toFixed(2) : 0
      };
    }
    
    return phaseStats;
  }

  /**
   * Normalize API path for comparison
   * @private
   * @param {string} path - API path
   * @returns {string} Normalized path
   */
  _normalizePath(path) {
    // Remove query parameters
    let normalized = path.split('?')[0];
    
    // Remove trailing slash
    if (normalized.endsWith('/') && normalized.length > 1) {
      normalized = normalized.slice(0, -1);
    }
    
    // Replace actual IDs with :id parameter
    // This is a simple heuristic - matches UUIDs and MongoDB ObjectIds
    normalized = normalized.replace(/\/[0-9a-f]{24}\b/gi, '/:id');
    normalized = normalized.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '/:id');
    
    return normalized;
  }
}

export default CoverageTracker;
