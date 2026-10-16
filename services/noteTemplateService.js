const NoteTemplate = require('../models/NoteTemplate');
const { DEFAULT_NOTE_TEMPLATES } = require('../config/defaultNoteTemplates');
const logger = require('../config/logger');

/**
 * Progress-note template bootstrap (Phase 2).
 *
 * A brand-new organisation used to start with zero templates, so the note
 * composer's "Choose a note template" sheet was empty until somebody either ran
 * `scripts/seed-note-templates.js` by hand or built a template in the admin
 * screen. `ensureDefaultTemplates` closes that gap: every organisation gets the
 * built-in templates the first time its templates are touched.
 *
 * Idempotency and safety:
 *  - `$setOnInsert` only. A template an admin has since edited is never
 *    overwritten by a later bootstrap run — unlike the manual seed script,
 *    which deliberately refreshes built-in definitions.
 *  - The "has templates" probe ignores `active`, so an admin who deactivates
 *    or deletes every template is not handed a new one behind their back.
 */

const SEED_ACTOR = 'system:defaultNoteTemplates';

class NoteTemplateService {
  /**
   * Create the built-in templates for an organisation that has none.
   *
   * @param {string} organizationId
   * @param {{ force?: boolean }} [options] - `force` skips the "already has
   *   templates" probe. It still only inserts, never overwrites.
   * @returns {Promise<{ created: number, skipped: boolean }>}
   */
  async ensureDefaultTemplates(organizationId, { force = false } = {}) {
    if (!organizationId) return { created: 0, skipped: true };

    if (!force) {
      const existingCount = await NoteTemplate.countDocuments({ organizationId });
      if (existingCount > 0) return { created: 0, skipped: true };
    }

    let created = 0;
    for (const template of DEFAULT_NOTE_TEMPLATES) {
      const alreadyThere = await NoteTemplate.exists({
        organizationId,
        name: template.name,
      });

      await NoteTemplate.findOneAndUpdate(
        { organizationId, name: template.name },
        {
          $setOnInsert: {
            organizationId,
            name: template.name,
            description: template.description,
            sections: template.sections,
            appliesTo: template.appliesTo || { serviceTypes: [], clientIds: [] },
            active: true,
            createdBy: SEED_ACTOR,
            updatedBy: SEED_ACTOR,
          },
        },
        { upsert: true, runValidators: true, setDefaultsOnInsert: true },
      );

      if (!alreadyThere) created += 1;
    }

    if (created > 0) {
      logger.business('Default note templates created', {
        event: 'note_templates_bootstrapped',
        organizationId,
        created,
      });
    }

    return { created, skipped: false };
  }
}

module.exports = new NoteTemplateService();
module.exports.SEED_ACTOR = SEED_ACTOR;
