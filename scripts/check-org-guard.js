#!/usr/bin/env node
/**
 * CI gate: tenant data must only be read through the validated organization
 * context, never directly from the request. Fails the build if a controller
 * reads req.query.organizationId without first preferring
 * req.organizationContext, or a route file wires authenticated endpoints
 * without requireOrgMembership.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const failures = [];

function walk(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

for (const file of walk(path.join(root, 'controllers'), '.js')) {
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes('req.query.organizationId') && !src.includes('req.organizationContext')) {
    failures.push(`controller reads req.query.organizationId without req.organizationContext: ${path.relative(root, file)}`);
  }
}

for (const file of walk(path.join(root, 'routes'), '.js')) {
  const src = fs.readFileSync(file, 'utf8');
  const hasAuth = src.includes('authenticateUser');
  const hasOrgGuard = src.includes('requireOrgMembership') || src.includes('organizationContextMiddleware');
  const mentionsOrg = /organizationId/i.test(src);
  if (hasAuth && mentionsOrg && !hasOrgGuard && !file.includes('auth')) {
    failures.push(`route file authenticates and references organizationId without requireOrgMembership: ${path.relative(root, file)}`);
  }
}

if (failures.length) {
  console.error('Org-tenancy guard failed:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('Org-tenancy guard passed.');
