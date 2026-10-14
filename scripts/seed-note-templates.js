/**
 * Seed the built-in progress-note templates (Phase 2 — structured shift notes).
 *
 * Idempotent: templates are upserted on { organizationId, name }, so re-running
 * only refreshes the section definitions. Existing notes are never touched, and
 * admin-created templates are left alone.
 *
 * Usage:
 *   node scripts/seed-note-templates.js                 # every organisation
 *   node scripts/seed-note-templates.js --org=<orgId>   # one organisation
 *
 * Never prints MONGODB_URI.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const NoteTemplate = require('../models/NoteTemplate');
const { DEFAULT_NOTE_TEMPLATES } = require('../config/defaultNoteTemplates');

const uri = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || process.env.MONGODB_DATABASE || 'Invoice';
const SEED_ACTOR = 'seed:defaultNoteTemplates';

function parseOrgArg() {
  const arg = process.argv.find((a) => a.startsWith('--org='));
  return arg ? arg.slice('--org='.length).trim() : null;
}

async function main() {
  if (!uri) {
    console.error('MONGODB_URI is not set. Cannot continue.');
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName: DB_NAME });
  console.log(`Connected. Database: ${DB_NAME}`);

  const onlyOrg = parseOrgArg();
  let orgIds;

  if (onlyOrg) {
    orgIds = [onlyOrg];
    console.log(`Seeding for a single organisation: ${onlyOrg}`);
  } else {
    const orgs = await Organization.find({}, '_id name').lean();
    orgIds = orgs.map((o) => String(o._id));
    console.log(
      `Seeding ${DEFAULT_NOTE_TEMPLATES.length} template(s) for ${orgIds.length} organisation(s).`,
    );
  }

  let created = 0;
  let updated = 0;

  for (const organizationId of orgIds) {
    for (const tpl of DEFAULT_NOTE_TEMPLATES) {
      const existing = await NoteTemplate.findOne({ organizationId, name: tpl.name }).lean();

      await NoteTemplate.findOneAndUpdate(
        { organizationId, name: tpl.name },
        {
          $set: {
            description: tpl.description,
            sections: tpl.sections,
            appliesTo: tpl.appliesTo || { serviceTypes: [], clientIds: [] },
            active: true,
            updatedBy: SEED_ACTOR,
          },
          $setOnInsert: {
            organizationId,
            name: tpl.name,
            createdBy: SEED_ACTOR,
          },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );

      if (existing) {
        updated += 1;
      } else {
        created += 1;
      }
      console.log(
        `  ${existing ? 'updated' : 'created'}: "${tpl.name}" (${tpl.sections.length} sections) → org ${organizationId}`,
      );
    }
  }

  console.log(`Done. created=${created} updated=${updated}`);
  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error('Seed failed:', err.message);
  try {
    await mongoose.connection.close();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
