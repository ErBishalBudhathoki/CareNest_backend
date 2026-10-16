/* eslint-disable no-console */
/**
 * Two-tenant authorization probe (dev only).
 *
 * The admin-surface audit (docs/ADMIN_SURFACE_AUTHORIZATION_AUDIT.md) listed its
 * findings from reading middleware chains and said the missing step was to
 * reproduce them with two live tenants. This script does that against a running
 * development backend, using tokens minted locally with the same JWT_SECRET the
 * service verifies with (so the probes exercise the real authorization stack).
 *
 * A probe is PASS when the call is REFUSED (401/403) and FAIL when it succeeds:
 * a success means the data was handed to a caller who should not have it.
 *
 * Usage:
 *   node scripts/verify-tenant-isolation.js --seed        # create the probe tenant
 *   node scripts/verify-tenant-isolation.js               # run the probes
 *   node scripts/verify-tenant-isolation.js --base-url http://localhost:8080/api
 *
 * Flags:
 *   --seed             create/ensure the probe organisation, its users, and the
 *                      victim payroll record in the existing organisation
 *   --base-url <url>   backend base (default: DEVELOPMENT_URL from ../.env)
 *   --json             print the raw results as JSON at the end
 *
 * Notes:
 *   * Requests send `X-Platform: ios`, which the app-check middleware exempts
 *     (App Attest is not configured for iOS). Without it the deployed dev
 *     backend rejects every call with 401 MISSING_APP_CHECK_TOKEN.
 *   * The probe organisation is named so it is obviously test data and is safe
 *     to delete; `--seed` is idempotent.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const Organization = require('../models/Organization');
const User = require('../models/User');
const UserOrganization = require('../models/UserOrganization');
const PayrollRecord = require('../models/PayrollRecord');

const PROBE_ORG_NAME = 'ZZ Isolation Probe Co (dev test data)';
const PROBE_OWNER_EMAIL = 'probe.owner@mailinator.com';
const PROBE_MEMBER_EMAIL = 'probe.member@mailinator.com';
// An employee in the pre-existing organisation who is NOT an admin, and the
// colleague whose payroll record the probes try to read.
const VICTIM_EMAIL = 'employee.seed.1@mailinator.com';
const BYSTANDER_EMAIL = 'employee.seed.3@mailinator.com';
const PAY_PERIOD = '2026-09';
const PAY_PERIOD_START = new Date('2026-09-01T00:00:00Z');
const PAY_PERIOD_END = new Date('2026-09-14T23:59:59Z');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function mintToken(user, extra = {}) {
  return jwt.sign(
    {
      userId: String(user._id),
      email: user.email,
      role: user.role,
      organizationId: user.organizationId ? String(user.organizationId) : undefined,
      ...extra,
    },
    requireEnv('JWT_SECRET'),
    {
      expiresIn: '2h',
      issuer: 'invoice-app',
      audience: 'invoice-app-users',
    }
  );
}

async function ensureUser({ email, firstName, lastName, role, organizationId }) {
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      email,
      firstName,
      lastName,
      // The model hashes this in a pre-save hook.
      password: process.env.APP_PASSWORD || 'ProbePassword123!',
      role,
      organizationId,
      isActive: true,
      emailVerified: true,
    });
    console.log(`  + user ${email} (${user._id})`);
  } else {
    console.log(`  = user ${email} (${user._id})`);
  }
  return user;
}

async function ensureMembership(userId, organizationId, role) {
  const existing = await UserOrganization.findOne({ userId, organizationId });
  if (existing) {
    if (existing.role !== role || !existing.isActive) {
      existing.role = role;
      existing.isActive = true;
      await existing.save();
      console.log(`  ~ membership ${userId} -> ${role}`);
    }
    return existing;
  }
  const membership = await UserOrganization.create({
    userId,
    organizationId,
    role,
    permissions: ['read'],
    isActive: true,
  });
  console.log(`  + membership ${userId} -> ${role}`);
  return membership;
}

async function seed() {
  console.log('\nSeeding probe tenant (dev)...');

  const existingOrg = await Organization.findOne({ name: { $ne: PROBE_ORG_NAME } });
  if (!existingOrg) {
    throw new Error('No organisation exists to probe against; create one in the app first.');
  }
  console.log(`  victim organisation: ${existingOrg.name} (${existingOrg._id})`);

  let probeOrg = await Organization.findOne({ name: PROBE_ORG_NAME });
  if (!probeOrg) {
    probeOrg = await Organization.create({
      name: PROBE_ORG_NAME,
      organizationCode: 'ZZPROBE',
      ownerEmail: PROBE_OWNER_EMAIL,
      contactDetails: { email: PROBE_OWNER_EMAIL },
      isActive: true,
    });
    console.log(`  + organisation ${PROBE_ORG_NAME} (${probeOrg._id})`);
  } else {
    console.log(`  = organisation ${PROBE_ORG_NAME} (${probeOrg._id})`);
  }

  // The global subscriptionGate (ENTITLEMENT_GATE=true on dev) returns 402 for
  // paid route groups when the caller's org is not subscribed. Without this the
  // probes never reach the authorization layer they are testing, so an
  // unsubscribed probe org would report everything as "refused" for the wrong
  // reason.
  if (probeOrg.subscription?.status !== 'active') {
    await Organization.updateOne(
      { _id: probeOrg._id },
      {
        $set: {
          'subscription.plan': 'professional',
          'subscription.status': 'active',
          'subscription.source': 'manual',
        },
      }
    );
    console.log('  ~ probe organisation marked subscribed (dev entitlement gate)');
  }
  if (!existingOrg.subscription?.status || existingOrg.subscription.status === 'none') {
    await Organization.updateOne(
      { _id: existingOrg._id },
      {
        $set: {
          'subscription.plan': 'professional',
          'subscription.status': 'active',
          'subscription.source': 'manual',
        },
      }
    );
    console.log('  ~ victim organisation marked subscribed (dev entitlement gate)');
  }

  const owner = await ensureUser({
    email: PROBE_OWNER_EMAIL,
    firstName: 'Probe',
    lastName: 'Owner',
    role: 'admin',
    organizationId: probeOrg._id,
  });
  const member = await ensureUser({
    email: PROBE_MEMBER_EMAIL,
    firstName: 'Probe',
    lastName: 'Member',
    role: 'employee',
    organizationId: probeOrg._id,
  });
  await ensureMembership(owner._id, probeOrg._id, 'owner');
  await ensureMembership(member._id, probeOrg._id, 'employee');

  const victim = await User.findOne({ email: VICTIM_EMAIL });
  if (!victim) throw new Error(`Victim user ${VICTIM_EMAIL} not found`);
  const bystander = await User.findOne({ email: BYSTANDER_EMAIL });
  if (!bystander) throw new Error(`Bystander user ${BYSTANDER_EMAIL} not found`);
  await ensureMembership(victim._id, existingOrg._id, 'employee');
  await ensureMembership(bystander._id, existingOrg._id, 'employee');

  // A salary record for the victim, so "read someone else's payslip" has
  // something to leak.
  const existingRecord = await PayrollRecord.findOne({
    employeeId: victim._id,
    periodStart: PAY_PERIOD_START,
  });
  if (!existingRecord) {
    await PayrollRecord.create({
      employeeId: victim._id,
      employeeName: `${victim.firstName} ${victim.lastName}`,
      organizationId: String(existingOrg._id),
      periodStart: PAY_PERIOD_START,
      periodEnd: PAY_PERIOD_END,
      grossPay: 4820.5,
      taxWithheld: 912.3,
      superContribution: 553.15,
      netPay: 3908.2,
      totalHours: 76,
      status: 'approved',
    });
    console.log(`  + payroll record for ${VICTIM_EMAIL} (${PAY_PERIOD})`);
  } else {
    console.log(`  = payroll record for ${VICTIM_EMAIL} (${PAY_PERIOD})`);
  }

  // An admin invoice profile carrying bank details, so "can a non-admin read the
  // org's payment details" has something to leak (without it the probe just
  // gets a 404 and proves nothing).
  const profiles = mongoose.connection.db.collection('adminInvoiceProfiles');
  const existingProfile = await profiles.findOne({
    organizationId: String(existingOrg._id),
    isActive: true,
  });
  if (!existingProfile) {
    await profiles.insertOne({
      _id: new mongoose.Types.ObjectId(),
      organizationId: String(existingOrg._id),
      businessName: existingOrg.name,
      businessAddress: '1 Probe St, Sydney NSW 2000',
      contactEmail: 'billing@probe.test',
      contactPhone: '0400000000',
      taxIdentifiers: { abn: '53004085616' },
      bankDetails: {
        accountName: 'Pari Care Services Pty Ltd',
        bsb: '062000',
        accountNumber: '12345678',
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log('  + admin invoice profile (with bank details) for the victim org');
  } else {
    console.log('  = admin invoice profile for the victim org');
  }

  return {
    victimOrgId: String(existingOrg._id),
    probeOrgId: String(probeOrg._id),
    ownerId: String(owner._id),
    memberId: String(member._id),
    victimId: String(victim._id),
    bystanderId: String(bystander._id),
  };
}

async function loadActors(ids) {
  const [owner, member, victim, bystander] = await Promise.all([
    User.findById(ids.ownerId),
    User.findById(ids.memberId),
    User.findById(ids.victimId),
    User.findById(ids.bystanderId),
  ]);
  return {
    probeOwner: { user: owner, token: mintToken(owner) },
    probeMember: { user: member, token: mintToken(member) },
    victim: { user: victim, token: mintToken(victim) },
    bystander: { user: bystander, token: mintToken(bystander) },
  };
}

async function call(baseUrl, token, method, route, { body, query } = {}) {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${route}`);
  for (const [key, value] of Object.entries(query || {})) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // App Check is exempted for iOS (no App Attest in dev).
      'X-Platform': 'ios',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  const text = await response.text();
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text.slice(0, 200);
  }
  return { status: response.status, payload };
}

function buildProbes(ids) {
  const {
    victimOrgId,
    probeOrgId,
    victimId,
    memberId,
    ownerId,
  } = ids;

  return [
    // --- controls: the same tokens against surfaces that are already gated ---
    {
      id: 'control/admin-can-read-own-sil',
      actor: 'probeOwner',
      expect: 'allowed',
      method: 'GET',
      route: '/sil/properties',
      note: 'Probe-org owner reading its own SIL properties — proves the owner token works.',
    },
    {
      id: 'control/member-cannot-read-sil',
      actor: 'probeMember',
      expect: 'refused',
      method: 'GET',
      route: '/sil/properties',
      note: 'Same route, non-admin member — proves role gating works where it exists.',
    },
    // --- A1: financial intelligence ---
    {
      id: 'A1/cross-tenant-revenue-trends',
      actor: 'probeMember',
      expect: 'refused',
      method: 'GET',
      route: `/financial-intelligence/revenue/trends/${victimOrgId}`,
      note: 'Org-B member reading org-A revenue trends.',
    },
    {
      id: 'A1/cross-tenant-revenue-forecast',
      actor: 'probeMember',
      expect: 'refused',
      method: 'POST',
      route: '/financial-intelligence/revenue/forecast',
      body: { organizationId: victimOrgId, horizon: 3 },
      note: 'Org-B member forecasting org-A revenue.',
    },
    // --- A2: workforce optimization ---
    {
      id: 'A2/cross-tenant-workforce-analytics',
      actor: 'probeMember',
      expect: 'refused',
      method: 'GET',
      route: '/workforce/performance/analytics',
      query: { organizationId: victimOrgId },
      note: 'Org-B member reading org-A workforce analytics.',
    },
    // --- A3: payslip ---
    {
      id: 'A3/cross-tenant-payslip',
      actor: 'probeMember',
      expect: 'refused',
      method: 'GET',
      route: `/payroll-advanced/payslip/${victimId}/${PAY_PERIOD}`,
      note: "Org-B member reading org-A employee's payslip.",
    },
    {
      id: 'A3/same-tenant-colleague-payslip',
      actor: 'bystander',
      expect: 'refused',
      method: 'GET',
      route: `/payroll-advanced/payslip/${victimId}/${PAY_PERIOD}`,
      note: "Org-A non-admin reading a colleague's payslip.",
    },
    {
      id: 'A3/control-own-payslip',
      actor: 'victim',
      expect: 'allowed',
      method: 'GET',
      route: `/payroll-advanced/payslip/${victimId}/${PAY_PERIOD}`,
      note: 'The employee reading their own payslip — must stay allowed.',
      // The endpoint returns an empty payslip placeholder with 200 when it
      // finds no record, so a bare status check would pass even if the fix had
      // simply broken the lookup. Require the actual salary to come back.
      requireData: (payload) =>
        Number(payload?.data?.earnings?.total || 0) > 0 &&
        Number(payload?.data?.netPay || 0) > 0,
      requireDataNote: 'payslip carries the seeded gross/net figures',
    },
    {
      id: 'control/admin-payslip-read-target',
      actor: 'probeOwner',
      expect: 'allowed',
      method: 'GET',
      route: `/payroll-advanced/payslip/${victimId}/${PAY_PERIOD}`,
      // An admin naming a foreign employee: allowed past the role gate, then
      // scoped to the ADMIN's own organisation, so no salary comes back. This
      // is what proves the tenant scope, not just the role gate.
      requireNoData: (payload) =>
        Number(payload?.data?.earnings?.total || 0) === 0,
      requireDataNote: 'an admin of another tenant gets no salary figures',
    },
    // --- A4: payroll summary / export -------------------------------------------------
    {
      id: 'A4/member-reads-org-payroll-summary',
      actor: 'bystander',
      expect: 'refused',
      method: 'GET',
      route: `/payroll-advanced/summary/${victimOrgId}/${PAY_PERIOD}`,
      note: 'Non-admin reading the organisation-wide payroll summary.',
    },
    {
      id: 'A4/member-exports-org-payroll',
      actor: 'bystander',
      expect: 'refused',
      method: 'POST',
      route: '/payroll-advanced/export',
      body: { organizationId: victimOrgId, period: PAY_PERIOD },
      note: 'Non-admin exporting the whole payroll.',
    },
    // --- A5: admin invoice profile (bank account) ---
    {
      id: 'A5/member-reads-invoice-bank-details',
      actor: 'bystander',
      expect: 'refused',
      method: 'GET',
      route: `/admin-invoice-profile/api/admin-invoice-profile/${victimOrgId}`,
      note: 'Non-admin reading the organisation invoice profile (ABN + bank account).',
    },
    // --- A9: bulk actions ---
    {
      id: 'A9/member-approves-all-timesheets',
      actor: 'bystander',
      expect: 'refused',
      method: 'POST',
      route: '/bulk/approve-timesheets',
      // A well-formed id that matches nothing: if the call is not refused the
      // route is reachable, and no real timesheet changes state.
      body: { organizationId: victimOrgId, timesheetIds: ['507f1f77bcf86cd799439099'] },
      note: 'Non-admin running the org-wide timesheet approval.',
    },
    // --- unknown caller cannot reach any of it ---
    {
      id: 'control/forged-token-rejected',
      actor: 'forged',
      expect: 'refused',
      method: 'GET',
      route: `/financial-intelligence/revenue/trends/${victimOrgId}`,
      note: 'Token signed with the wrong secret must be rejected everywhere.',
    },
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const seedRequested = args.includes('--seed');
  const jsonOut = args.includes('--json');
  const baseUrlArg = args.includes('--base-url')
    ? args[args.indexOf('--base-url') + 1]
    : null;

  const baseUrl = (
    baseUrlArg ||
    process.env.DEVELOPMENT_URL ||
    'http://localhost:8080/api'
  ).replace(/\/$/, '');

  const dbName = process.env.DB_NAME || 'Invoice';
  await mongoose.connect(requireEnv('MONGODB_URI'), { dbName });

  const ids = await (async () => {
    if (seedRequested) return seed();
    const probeOrg = await Organization.findOne({ name: PROBE_ORG_NAME });
    if (!probeOrg) {
      throw new Error('Probe tenant missing — run with --seed first.');
    }
    const existingOrg = await Organization.findOne({ _id: { $ne: probeOrg._id } });
    const [owner, member, victim, bystander] = await Promise.all([
      User.findOne({ email: PROBE_OWNER_EMAIL }),
      User.findOne({ email: PROBE_MEMBER_EMAIL }),
      User.findOne({ email: VICTIM_EMAIL }),
      User.findOne({ email: BYSTANDER_EMAIL }),
    ]);
    return {
      victimOrgId: String(existingOrg._id),
      probeOrgId: String(probeOrg._id),
      ownerId: String(owner._id),
      memberId: String(member._id),
      victimId: String(victim._id),
      bystanderId: String(bystander._id),
    };
  })();

  const actors = await loadActors(ids);
  const forgedToken = jwt.sign(
    { userId: ids.memberId, email: PROBE_MEMBER_EMAIL },
    'not-the-real-secret',
    { expiresIn: '2h', issuer: 'invoice-app', audience: 'invoice-app-users' }
  );

  const probes = buildProbes(ids);
  const results = [];

  console.log(`\nBackend: ${baseUrl}`);
  console.log(`Probe org: ${ids.probeOrgId}   Victim org: ${ids.victimOrgId}\n`);
  console.log('id'.padEnd(46), 'actor'.padEnd(14), 'HTTP', 'verdict');

  for (const probe of probes) {
    const token = probe.actor === 'forged' ? forgedToken : actors[probe.actor].token;
    let outcome;
    try {
      const { status, payload } = await call(baseUrl, token, probe.method, probe.route, {
        body: probe.body,
        query: probe.query,
      });
      outcome = { status, payload };
    } catch (error) {
      outcome = { status: 0, payload: { message: error.message } };
    }

    const refused = outcome.status === 401 || outcome.status === 403;
    let ok = probe.expect === 'refused' ? refused : outcome.status === 200;
    let dataNote = '';
    if (ok && probe.requireData) {
      const hasData = probe.requireData(outcome.payload);
      if (!hasData) {
        ok = false;
        dataNote = ` [empty response: expected ${probe.requireDataNote}]`;
      }
    }
    if (ok && probe.requireNoData) {
      const stillEmpty = probe.requireNoData(outcome.payload);
      if (!stillEmpty) {
        ok = false;
        dataNote = ` [LEAKED data: ${probe.requireDataNote}]`;
      }
    }
    const verdict = ok ? 'PASS' : 'FAIL';
    const detail =
      outcome.status === 0
        ? `network: ${outcome.payload.message}`
        : `(${outcome.payload?.message || outcome.payload?.errorCode || 'no message'})${dataNote}`;

    console.log(
      probe.id.padEnd(46),
      probe.actor.padEnd(14),
      String(outcome.status).padEnd(4),
      verdict,
      detail
    );

    results.push({
      id: probe.id,
      expect: probe.expect,
      actor: probe.actor,
      status: outcome.status,
      verdict,
      message: outcome.payload?.message || null,
      note: probe.note,
    });
  }

  const failed = results.filter((r) => r.verdict === 'FAIL');
  const exposed = failed.filter((r) => r.expect === 'refused');
  const regressed = failed.filter((r) => r.expect === 'allowed');

  console.log(
    `\n${results.length - failed.length}/${results.length} probes behaved correctly.`
  );
  if (exposed.length) {
    console.log(`EXPOSED (should have been refused): ${exposed.map((r) => r.id).join(', ')}`);
  }
  if (regressed.length) {
    console.log(`REGRESSED (should have been allowed): ${regressed.map((r) => r.id).join(', ')}`);
  }

  if (jsonOut) console.log(JSON.stringify(results, null, 2));

  await mongoose.disconnect();
  // Non-zero exit when something is exposed, so this can gate CI or a script.
  process.exit(exposed.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error('verify-tenant-isolation failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(2);
});
