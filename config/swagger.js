/**
 * Swagger/OpenAPI Configuration
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
 * Custom middleware to serve OpenAPI spec as JSON
 */
router.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(openApiSpec);
});

/**
 * Serve Swagger UI
 * This uses a CDN version of Swagger UI for simplicity
 */
router.get('/api-docs', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice App API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui.css" />
  <style>
    body {
      margin: 0;
      padding: 0;
    }
    #swagger-ui {
      max-width: 1460px;
      margin: 0 auto;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  
  <script src="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui-standalone-preset.js"></script>
  
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: '/api-docs.json',
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
        validatorUrl: null,
        supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
        onComplete: () => {
          console.log('Swagger UI loaded successfully');
        },
        onFailure: (error) => {
          console.error('Swagger UI failed to load:', error);
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

module.exports = router;
