/**
 * Audit Script: Find All User Creation Points
 * 
 * This script audits all places in the codebase where users are created
 * and checks if UserOrganization records are being created properly.
 */

const fs = require('fs');
const path = require('path');

const findings = {
  userCreationWithUserOrg: [],
  userCreationWithoutUserOrg: [],
  potentialIssues: []
};

// Files to audit
const filesToCheck = [
  'services/authService.js',
  'services/authService_v2.js',
  'services/clientAuthService.js',
  'controllers/secureAuthController.js',
  'controllers/authController.js',
  'services/organizationService.js'
];

console.log('🔍 Auditing User Creation Points...\n');

filesToCheck.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File not found: ${file}`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Check for user creation patterns
  const userCreationPattern = /(new User\(|User\.create\(|\.save\(\))/;
  const userOrgPattern = /UserOrganization/;
  
  const hasUserCreation = userCreationPattern.test(content);
  const hasUserOrgHandling = userOrgPattern.test(content);

  if (hasUserCreation) {
    // Find specific lines with user creation
    lines.forEach((line, index) => {
      if (/new User\(|User\.create\(/.test(line)) {
        const lineNumber = index + 1;
        const context = lines.slice(Math.max(0, index - 5), Math.min(lines.length, index + 20)).join('\n');
        
        const hasOrgIdInContext = /organizationId/.test(context);
        const hasUserOrgInContext = /UserOrganization/.test(context);

        const finding = {
          file,
          lineNumber,
          line: line.trim(),
          hasOrgId: hasOrgIdInContext,
          hasUserOrg: hasUserOrgInContext,
          context: context.substring(0, 500)
        };

        if (hasOrgIdInContext && !hasUserOrgInContext) {
          findings.userCreationWithoutUserOrg.push(finding);
        } else if (hasOrgIdInContext && hasUserOrgInContext) {
          findings.userCreationWithUserOrg.push(finding);
        }
      }
    });
  }

  console.log(`\n📄 ${file}`);
  console.log(`   User Creation: ${hasUserCreation ? '✅ YES' : '❌ NO'}`);
  console.log(`   UserOrganization Handling: ${hasUserOrgHandling ? '✅ YES' : '⚠️  NO'}`);
  
  if (hasUserCreation && !hasUserOrgHandling) {
    findings.potentialIssues.push({
      file,
      issue: 'Creates users but does not handle UserOrganization records'
    });
  }
});

console.log('\n\n' + '='.repeat(80));
console.log('📊 AUDIT SUMMARY');
console.log('='.repeat(80));

console.log(`\n✅ User Creation WITH UserOrganization: ${findings.userCreationWithUserOrg.length}`);
findings.userCreationWithUserOrg.forEach(f => {
  console.log(`   - ${f.file}:${f.lineNumber}`);
});

console.log(`\n⚠️  User Creation WITHOUT UserOrganization: ${findings.userCreationWithoutUserOrg.length}`);
findings.userCreationWithoutUserOrg.forEach(f => {
  console.log(`   - ${f.file}:${f.lineNumber} - ${f.line}`);
});

console.log(`\n🚨 Potential Issues: ${findings.potentialIssues.length}`);
findings.potentialIssues.forEach(f => {
  console.log(`   - ${f.file}: ${f.issue}`);
});

console.log('\n\n' + '='.repeat(80));
console.log('🔧 RECOMMENDED FIXES');
console.log('='.repeat(80));

if (findings.userCreationWithoutUserOrg.length > 0) {
  console.log('\nThe following files create users with organizationId but do NOT create UserOrganization records:');
  findings.userCreationWithoutUserOrg.forEach(f => {
    console.log(`\n📍 ${f.file}:${f.lineNumber}`);
    console.log('   Add after user creation:');
    console.log('   ```javascript');
    console.log('   if (organizationId) {');
    console.log('     await UserOrganization.create({');
    console.log('       userId: savedUser._id.toString(),');
    console.log('       organizationId: organizationId,');
    console.log('       role: role || "user",');
    console.log('       permissions: role === "admin" ? ["*"] : ["read", "write"],');
    console.log('       isActive: true,');
    console.log('       joinedAt: new Date()');
    console.log('     });');
    console.log('   }');
    console.log('   ```');
  });
}

console.log('\n✅ Audit Complete!\n');

// Write detailed report to file
const report = {
  timestamp: new Date().toISOString(),
  summary: {
    totalWithUserOrg: findings.userCreationWithUserOrg.length,
    totalWithoutUserOrg: findings.userCreationWithoutUserOrg.length,
    totalIssues: findings.potentialIssues.length
  },
  findings
};

fs.writeFileSync(
  path.join(__dirname, 'audit_user_creation_report.json'),
  JSON.stringify(report, null, 2)
);

console.log('📄 Detailed report saved to: scripts/audit_user_creation_report.json\n');
