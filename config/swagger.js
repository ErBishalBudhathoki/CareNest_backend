/**
 * Swagger/OpenAPI Configuration - Enhanced SaaS Design
 * Serves OpenAPI documentation using swagger-ui-express
 * 
 * @file backend/config/swagger.js
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Read the OpenAPI spec
const openApiPath = path.join(__dirname, '../docs/openapi.json');
let openApiSpec;

try {
  const openApiFile = fs.readFileSync(openApiPath, 'utf8');
  openApiSpec = JSON.parse(openApiFile);
} catch (error) {
  console.error('Error loading OpenAPI spec:', error);
  openApiSpec = {
    openapi: '3.0.0',
    info: {
      title: 'Invoice App API',
      version: '1.0.0',
      description: 'API Documentation (Error loading full spec)'
    },
    paths: {}
  };
}

/**
 * Simple Basic Auth Middleware for Swagger UI
 * Protects documentation from unauthorized public access
 */
const basicAuth = (req, res, next) => {
  // Allow in development without auth if explicitly configured
  if (process.env.NODE_ENV === 'development' && process.env.SWAGGER_NO_AUTH === 'true') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Invoice API Docs"');
    return res.status(401).send('Authentication required');
  }

  const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  const user = auth[0];
  const pass = auth[1];

  // Use environment variables or safe defaults
  // In production, these MUST be set
  const validUser = process.env.SWAGGER_USER || 'admin';
  const validPass = process.env.SWAGGER_PASSWORD || 'admin'; 

  if (user === validUser && pass === validPass) {
    return next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Invoice API Docs"');
    return res.status(401).send('Invalid credentials');
  }
};

/**
 * Custom middleware to serve OpenAPI spec as JSON
 */
router.get('/api-docs/docs.json', basicAuth, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  // Dynamic Server Configuration
  const backendUrl = process.env.BACKEND_URL;
  const isProduction = process.env.NODE_ENV === 'production';

  const servers = [];
  
  // Always add local in dev, or if not in production
  if (!isProduction) {
    servers.push({
      url: 'http://localhost:8080/api',
      description: 'Local Development'
    });
  }

  // Add production/configured URL
  if (backendUrl) {
    // Ensure backendUrl doesn't have /api suffix
    const cleanBackendUrl = backendUrl.replace(/\/api\/?$/, '');
    servers.push({
      url: cleanBackendUrl + '/api',
      description: isProduction ? 'Production Server' : 'Upstream/Production Server'
    });
  }

  // Override servers in spec
  const specWithServers = {
    ...openApiSpec,
    servers: servers.length > 0 ? servers : openApiSpec.servers
  };

  res.send(specWithServers);
});

/**
 * Serve Enhanced Swagger UI
 */
router.get('/api-docs', basicAuth, (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Multi-Tenant Invoice & NDIS API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui.css" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    /* ==========================================
       MODERN SAAS DESIGN SYSTEM
       ========================================== */
    
    :root {
      /* Color Palette - Soft, Modern, Professional */
      --color-primary: #6366f1;
      --color-primary-dark: #4f46e5;
      --color-primary-light: #818cf8;
      --color-secondary: #8b5cf6;
      --color-accent: #ec4899;
      
      /* Neutrals - Warm grays for better readability */
      --color-bg-primary: #fafbfc;
      --color-bg-secondary: #ffffff;
      --color-bg-tertiary: #f3f4f6;
      --color-bg-code: #1f2937;
      
      --color-text-primary: #111827;
      --color-text-secondary: #6b7280;
      --color-text-muted: #9ca3af;
      
      --color-border: #e5e7eb;
      --color-border-light: #f3f4f6;
      
      /* Semantic Colors */
      --color-success: #10b981;
      --color-warning: #f59e0b;
      --color-error: #ef4444;
      --color-info: #3b82f6;
      
      /* Shadows */
      --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      
      /* Border Radius */
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --radius-xl: 16px;
      
      /* Spacing */
      --space-xs: 4px;
      --space-sm: 8px;
      --space-md: 16px;
      --space-lg: 24px;
      --space-xl: 32px;
      --space-2xl: 48px;
      
      /* Typography */
      --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    
    /* ==========================================
       BASE STYLES
       ========================================== */
    
    * {
      box-sizing: border-box;
    }
    
    body {
      margin: 0;
      padding: 0;
      font-family: var(--font-family);
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    
    /* ==========================================
       PROFESSIONAL HEADER SECTION
       ========================================== */
    
    .api-header {
      background: var(--color-bg-secondary);
      border-bottom: 1px solid var(--color-border);
      padding: 0;
      margin: 0;
    }
    
    .api-header-content {
      max-width: 1400px;
      margin: 0 auto;
      padding: var(--space-2xl) var(--space-xl) var(--space-xl) var(--space-xl);
    }
    
    .api-header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: var(--space-lg);
      gap: var(--space-xl);
    }
    
    .api-header-info {
      flex: 1;
      max-width: 800px;
    }
    
    .api-header h1 {
      margin: 0 0 var(--space-sm) 0;
      font-size: 1.875rem;
      font-weight: 600;
      color: var(--color-text-primary);
      letter-spacing: -0.025em;
      line-height: 1.3;
    }
    
    .api-header-version {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      background: var(--color-bg-tertiary);
      color: var(--color-text-secondary);
      padding: 4px 10px;
      border-radius: var(--radius-md);
      font-size: 0.75rem;
      font-weight: 500;
      margin-left: var(--space-sm);
      border: 1px solid var(--color-border);
    }
    
    .api-header p {
      margin: 0;
      font-size: 0.9375rem;
      color: var(--color-text-secondary);
      line-height: 1.6;
      font-weight: 400;
    }
    
    /* Stats Grid */
    .api-stats {
      display: flex;
      gap: var(--space-lg);
      flex-wrap: wrap;
    }
    
    .stat-item {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-sm) 0;
    }
    
    .stat-icon {
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-bg-tertiary);
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
    }
    
    .stat-icon svg {
      width: 20px;
      height: 20px;
      color: var(--color-text-secondary);
    }
    
    .stat-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    
    .stat-number {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--color-text-primary);
      line-height: 1;
    }
    
    .stat-label {
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
      font-weight: 400;
    }
    
    /* Info Banner */
    .api-info-banner {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: var(--radius-md);
      padding: var(--space-md) var(--space-lg);
      display: flex;
      align-items: flex-start;
      gap: var(--space-md);
      margin-top: var(--space-lg);
    }
    
    .api-info-banner svg {
      width: 20px;
      height: 20px;
      color: #3b82f6;
      flex-shrink: 0;
      margin-top: 2px;
    }
    
    .api-info-banner-content {
      flex: 1;
    }
    
    .api-info-banner-content p {
      margin: 0;
      font-size: 0.875rem;
      color: #1e40af;
      line-height: 1.5;
    }
    
    .api-info-banner-content strong {
      font-weight: 600;
    }
    
    /* ==========================================
       SWAGGER UI CONTAINER
       ========================================== */
    
    #swagger-ui {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0;
      background: var(--color-bg-primary);
    }
    
    /* Hide default topbar and info */
    .swagger-ui .topbar {
      display: none !important;
    }
    
    .swagger-ui .info {
      margin: 0 !important;
      padding: 0 !important;
    }
    
    .swagger-ui .info .title,
    .swagger-ui .info .description,
    .swagger-ui .info .version {
      display: none !important;
    }
    
    /* ==========================================
       SERVER SELECTOR
       ========================================== */
    
    .swagger-ui .scheme-container {
      background: var(--color-bg-secondary) !important;
      padding: var(--space-lg) var(--space-xl) !important;
      box-shadow: var(--shadow-sm) !important;
      border-bottom: 1px solid var(--color-border);
      border-radius: 0 !important;
    }
    
    .swagger-ui .scheme-container .schemes {
      margin-top: var(--space-sm);
    }
    
    .swagger-ui .scheme-container label {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-text-primary);
      margin-bottom: var(--space-xs);
    }
    
    .swagger-ui .scheme-container select {
      background: var(--color-bg-tertiary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--space-sm) var(--space-md);
      font-family: var(--font-family);
      font-size: 0.875rem;
      color: var(--color-text-primary);
      transition: all 0.2s ease;
    }
    
    .swagger-ui .scheme-container select:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
    }
    
    /* ==========================================
       TAG SECTIONS
       ========================================== */
    
    .swagger-ui .opblock-tag-section {
      margin: var(--space-lg) var(--space-xl);
    }
    
    .swagger-ui .opblock-tag {
      font-size: 1.25rem !important;
      padding: var(--space-lg) var(--space-xl) !important;
      margin: var(--space-lg) 0 var(--space-md) 0 !important;
      border: none !important;
      border-radius: var(--radius-lg) !important;
      background: var(--color-bg-secondary) !important;
      color: var(--color-text-primary) !important;
      font-weight: 600 !important;
      transition: all 0.2s ease !important;
      box-shadow: var(--shadow-sm) !important;
      border-left: 4px solid var(--color-primary) !important;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    .swagger-ui .opblock-tag:hover {
      background: var(--color-bg-tertiary) !important;
      box-shadow: var(--shadow-md) !important;
      transform: translateX(2px);
    }
    
    .swagger-ui .opblock-tag svg {
      transition: transform 0.2s ease;
    }
    
    .swagger-ui .opblock-tag.is-open svg {
      transform: rotate(180deg);
    }
    
    /* ==========================================
       OPERATION BLOCKS
       ========================================== */
    
    .swagger-ui .opblock {
      margin: var(--space-sm) 0 !important;
      border-radius: var(--radius-lg) !important;
      background: var(--color-bg-secondary) !important;
      box-shadow: var(--shadow-sm) !important;
      border: 1px solid var(--color-border) !important;
      transition: all 0.2s ease !important;
      overflow: hidden;
    }
    
    .swagger-ui .opblock:hover {
      box-shadow: var(--shadow-md) !important;
      border-color: var(--color-border);
    }
    
    .swagger-ui .opblock.is-open {
      box-shadow: var(--shadow-lg) !important;
    }
    
    /* Operation Summary Bar */
    .swagger-ui .opblock-summary {
      padding: var(--space-md) var(--space-lg) !important;
      border-radius: var(--radius-lg) !important;
      background: transparent !important;
      border: none !important;
      align-items: center;
      cursor: pointer;
    }
    
    /* HTTP Method Badges - Modern Pill Design */
    .swagger-ui .opblock-summary-method {
      min-width: 70px !important;
      text-align: center !important;
      font-weight: 600 !important;
      border-radius: var(--radius-lg) !important;
      font-size: 0.75rem !important;
      padding: var(--space-xs) var(--space-md) !important;
      text-transform: uppercase;
      letter-spacing: 0.025em;
      box-shadow: var(--shadow-sm);
    }
    
    .swagger-ui .opblock.opblock-get .opblock-summary-method { 
      background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%) !important; 
      color: #1e40af !important; 
    }
    
    .swagger-ui .opblock.opblock-post .opblock-summary-method { 
      background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%) !important; 
      color: #15803d !important; 
    }
    
    .swagger-ui .opblock.opblock-put .opblock-summary-method { 
      background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%) !important; 
      color: #b45309 !important; 
    }
    
    .swagger-ui .opblock.opblock-delete .opblock-summary-method { 
      background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%) !important; 
      color: #dc2626 !important; 
    }
    
    .swagger-ui .opblock.opblock-patch .opblock-summary-method { 
      background: linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%) !important; 
      color: #7c3aed !important; 
    }
    
    /* Path and Description */
    .swagger-ui .opblock-summary-path {
      font-size: 0.9375rem !important;
      color: var(--color-text-primary) !important;
      font-weight: 500 !important;
      padding: 0 var(--space-md) !important;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    }
    
    .swagger-ui .opblock-summary-description {
      font-size: 0.875rem !important;
      color: var(--color-text-secondary) !important;
      padding-left: var(--space-md) !important;
    }
    
    /* ==========================================
       EXPANDED CONTENT
       ========================================== */
    
    .swagger-ui .opblock-body {
      background: var(--color-bg-tertiary) !important;
      border-top: 1px solid var(--color-border) !important;
      padding: var(--space-lg) !important;
    }
    
    /* Parameters Section */
    .swagger-ui .parameters-container {
      padding: var(--space-lg) !important;
      background: var(--color-bg-secondary);
      border-radius: var(--radius-md);
    }
    
    .swagger-ui table {
      background: var(--color-bg-secondary) !important;
      border-radius: var(--radius-md) !important;
      overflow: hidden;
      border: 1px solid var(--color-border);
    }
    
    .swagger-ui table thead tr {
      background: var(--color-bg-tertiary) !important;
    }
    
    .swagger-ui table th {
      color: var(--color-text-secondary) !important;
      font-weight: 600 !important;
      font-size: 0.75rem !important;
      text-transform: uppercase !important;
      letter-spacing: 0.05em !important;
      padding: var(--space-md) var(--space-lg) !important;
      border-bottom: 1px solid var(--color-border) !important;
    }
    
    .swagger-ui table td {
      color: var(--color-text-primary) !important;
      padding: var(--space-md) var(--space-lg) !important;
      border-color: var(--color-border-light) !important;
    }
    
    /* Response Section */
    .swagger-ui .responses-wrapper {
      padding: var(--space-lg) !important;
      background: var(--color-bg-secondary) !important;
      border-radius: var(--radius-md);
      margin-top: var(--space-md);
    }
    
    .swagger-ui .response-col_status {
      color: var(--color-text-primary) !important;
      font-weight: 600 !important;
    }
    
    /* ==========================================
       BUTTONS
       ========================================== */
    
    .swagger-ui .btn {
      border-radius: var(--radius-md) !important;
      font-family: var(--font-family) !important;
      font-weight: 600 !important;
      transition: all 0.2s ease !important;
      border: none !important;
      box-shadow: var(--shadow-sm) !important;
    }
    
    .swagger-ui .try-out__btn {
      background: var(--color-primary) !important;
      color: white !important;
      padding: var(--space-sm) var(--space-lg) !important;
      font-size: 0.875rem !important;
    }
    
    .swagger-ui .try-out__btn:hover {
      background: var(--color-primary-dark) !important;
      transform: translateY(-1px);
      box-shadow: var(--shadow-md) !important;
    }
    
    .swagger-ui .execute__btn {
      background: var(--color-success) !important;
      color: white !important;
      padding: var(--space-md) var(--space-xl) !important;
      font-size: 0.9375rem !important;
    }
    
    .swagger-ui .execute__btn:hover {
      background: #059669 !important;
      box-shadow: var(--shadow-md) !important;
    }
    
    /* ==========================================
       INPUT FIELDS
       ========================================== */
    
    .swagger-ui input[type="text"],
    .swagger-ui input[type="password"],
    .swagger-ui select,
    .swagger-ui textarea {
      background: var(--color-bg-secondary) !important;
      border: 1px solid var(--color-border) !important;
      border-radius: var(--radius-md) !important;
      color: var(--color-text-primary) !important;
      padding: var(--space-sm) var(--space-md) !important;
      font-size: 0.875rem !important;
      font-family: var(--font-family) !important;
      transition: all 0.2s ease !important;
    }
    
    .swagger-ui input:focus,
    .swagger-ui select:focus,
    .swagger-ui textarea:focus {
      border-color: var(--color-primary) !important;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1) !important;
      outline: none !important;
    }
    
    /* ==========================================
       CODE BLOCKS
       ========================================== */
    
    .swagger-ui code {
      background: var(--color-bg-code) !important;
      color: #e5e7eb !important;
      padding: 2px var(--space-sm) !important;
      border-radius: var(--radius-sm) !important;
      font-size: 0.8125rem !important;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace !important;
    }
    
    .swagger-ui pre {
      background: var(--color-bg-code) !important;
      border-radius: var(--radius-md) !important;
      padding: var(--space-md) !important;
      font-size: 0.8125rem !important;
      line-height: 1.6;
      border: 1px solid #374151;
    }
    
    .swagger-ui pre code {
      background: transparent !important;
      padding: 0 !important;
      color: #e5e7eb !important;
    }
    
    /* ==========================================
       MODELS
       ========================================== */
    
    .swagger-ui .model-box {
      background: var(--color-bg-secondary) !important;
      border-radius: var(--radius-md) !important;
      padding: var(--space-lg) !important;
      border: 1px solid var(--color-border) !important;
      margin: var(--space-md) 0 !important;
    }
    
    .swagger-ui .model-title {
      color: var(--color-text-primary) !important;
      font-weight: 600 !important;
      font-size: 1rem !important;
    }
    
    .swagger-ui .prop-name {
      color: var(--color-primary) !important;
      font-weight: 500 !important;
    }
    
    /* ==========================================
       AUTHORIZATION MODAL
       ========================================== */
    
    .swagger-ui .dialog-ux .modal-ux {
      background: var(--color-bg-secondary) !important;
      border-radius: var(--radius-xl) !important;
      box-shadow: var(--shadow-xl) !important;
      border: 1px solid var(--color-border);
    }
    
    .swagger-ui .modal-ux-header {
      padding: var(--space-xl) var(--space-2xl) !important;
      border-bottom: 1px solid var(--color-border);
      background: var(--color-bg-tertiary);
    }
    
    .swagger-ui .modal-ux-content {
      padding: var(--space-xl) var(--space-2xl) !important;
    }
    
    /* ==========================================
       SCROLLBAR
       ========================================== */
    
    ::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    
    ::-webkit-scrollbar-track {
      background: var(--color-bg-tertiary);
    }
    
    ::-webkit-scrollbar-thumb {
      background: var(--color-border);
      border-radius: 5px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
      background: var(--color-text-muted);
    }
    
    /* ==========================================
       RESPONSIVE DESIGN
       ========================================== */
    
    @media (max-width: 768px) {
      .api-header-content {
        padding: var(--space-xl) var(--space-lg);
      }
      
      .api-header-top {
        flex-direction: column;
        gap: var(--space-lg);
      }
      
      .api-header h1 {
        font-size: 1.5rem;
      }
      
      .api-header-version {
        display: block;
        margin-left: 0;
        margin-top: var(--space-xs);
      }
      
      .api-stats {
        width: 100%;
        justify-content: flex-start;
      }
      
      .swagger-ui .opblock-tag-section {
        margin: var(--space-md) var(--space-lg);
      }
      
      .swagger-ui .opblock-tag {
        padding: var(--space-md) var(--space-lg) !important;
        font-size: 1.125rem !important;
      }
    }
    
    /* ==========================================
       ANIMATIONS
       ========================================== */
    
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .swagger-ui .opblock {
      animation: fadeIn 0.3s ease;
    }
    
    /* ==========================================
       FILTER INPUT
       ========================================== */
    
    .swagger-ui .filter-container {
      padding: var(--space-lg) var(--space-xl) !important;
      background: var(--color-bg-secondary) !important;
      border-bottom: 1px solid var(--color-border);
    }
    
    .swagger-ui .filter input {
      background: var(--color-bg-tertiary) !important;
      border: 1px solid var(--color-border) !important;
      border-radius: var(--radius-md) !important;
      padding: var(--space-sm) var(--space-md) !important;
      font-size: 0.875rem !important;
      width: 100%;
      max-width: 400px;
    }
  </style>
</head>
<body>
  <!-- Professional Header -->
  <div class="api-header">
    <div class="api-header-content">
      <div class="api-header-top">
        <div class="api-header-info">
          <h1>
            Multi-Tenant Invoice & NDIS API
            <span class="api-header-version" id="version-badge">v2.0.0</span>
          </h1>
          <p>Complete REST API for managing invoices, organizations, clients, employees, and NDIS support operations with enterprise-grade features.</p>
        </div>
        
        <div class="api-stats">
          <div class="stat-item">
            <div class="stat-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
              </svg>
            </div>
            <div class="stat-content">
              <span class="stat-number" id="endpoint-count">—</span>
              <span class="stat-label">Endpoints</span>
            </div>
          </div>
          
          <div class="stat-item">
            <div class="stat-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path>
              </svg>
            </div>
            <div class="stat-content">
              <span class="stat-number" id="tag-count">—</span>
              <span class="stat-label">Categories</span>
            </div>
          </div>
        </div>
      </div>
      
      <div class="api-info-banner">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <div class="api-info-banner-content">
          <p>Use the <strong>Servers</strong> dropdown below to switch between Local and Production environments.</p>
        </div>
      </div>
    </div>
  </div>
  
  <div id="swagger-ui"></div>
  
  <script src="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui-standalone-preset.js"></script>
  
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: '/api-docs/docs.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        
        // Enhanced defaults
        docExpansion: 'list',
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 3,
        displayRequestDuration: true,
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        tryItOutEnabled: true,
        
        // Sorting
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        
        // Security
        validatorUrl: null,
        supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
        
        onComplete: () => {
          console.log('✅ Swagger UI loaded successfully');
          
          // Update stats in header section
          try {
            const spec = window.ui.specSelectors.specJson().toJSON();
            const info = window.ui.specSelectors.info().toJS();
            
            const endpointCount = Object.keys(spec.paths || {}).length;
            const tagCount = (spec.tags || []).length;
            const version = info.version || '2.0.0';
            
            document.getElementById('endpoint-count').textContent = endpointCount;
            document.getElementById('tag-count').textContent = tagCount;
            document.getElementById('version-badge').textContent = 'v' + version;
          } catch (e) {
            console.log('Could not update stats:', e.message);
          }
        },
        
        onFailure: (error) => {
          console.error('❌ Swagger UI failed to load:', error);
        }
      });
    };
  </script>
</body>
</html>
  `;
  
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/**
 * Serve Redoc Documentation
 */
router.get('/api-redoc', (req, res) => {
  const html = `
<!DOCTYPE html>
<html>
  <head>
    <title>Multi-Tenant Invoice & NDIS API - Redoc</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
    <style>
      body {
        margin: 0;
        padding: 0;
      }
    </style>
  </head>
  <body>
    <redoc spec-url='/api-docs/docs.json'></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"> </script>
  </body>
</html>
  `;
  
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

module.exports = router;
