/**
 * Built-in progress-note templates (Phase 2 — structured shift notes).
 *
 * These are seeded per organisation so structured shift notes are usable
 * immediately, without an admin having to build a template by hand first.
 *
 * Section `type` must stay within the NoteTemplate enum:
 *   text | longText | select | checkbox | number | voice
 *
 * The content follows common Australian NDIS support-worker practice: a shift
 * summary, mood/wellbeing, personal care, continence, medication, nutrition,
 * community access, progress against plan goals, incidents & hazards,
 * restrictive practice, handover and a worker declaration.
 *
 * See docs/NDIS_DEPTH_ROADMAP.md §2 and docs/SIL_MANAGEMENT_SPEC.md.
 */

const DAILY_SUPPORT_SHIFT_NOTE = {
  name: 'Daily Support Shift Note',
  description:
    'Standard daily shift note for community and in-home supports — personal care, ' +
    'medication, wellbeing, community access, progress towards plan goals, incidents ' +
    'and handover.',
  appliesTo: { serviceTypes: [], clientIds: [] },
  sections: [
    {
      key: 'shift_summary',
      label: 'Shift summary',
      type: 'longText',
      required: true,
      options: [],
      helpText: 'A short overview of the shift: what happened, where, and who was present.',
      order: 1,
    },
    {
      key: 'mood_wellbeing',
      label: 'Mood & wellbeing',
      type: 'select',
      required: true,
      options: [
        'Happy and settled',
        'Engaged and sociable',
        'Anxious',
        'Low mood',
        'Agitated',
        'Distressed',
      ],
      helpText: 'How the participant presented across the shift.',
      order: 2,
    },
    {
      key: 'personal_care',
      label: 'Personal care & hygiene',
      type: 'select',
      required: true,
      options: [
        'Not required',
        'Prompted only',
        'Partial assistance',
        'Full assistance',
        'Refused',
      ],
      helpText: 'Level of assistance provided with showering, dressing and grooming.',
      order: 3,
    },
    {
      key: 'continence',
      label: 'Continence support',
      type: 'select',
      required: false,
      options: ['Not required', 'Prompted', 'Assisted', 'Pad change', 'Catheter care'],
      helpText: 'Record any changes to routine or concerns in the handover notes.',
      order: 4,
    },
    {
      key: 'medication',
      label: 'Medication support',
      type: 'select',
      required: true,
      options: [
        'Not required',
        'Prompted',
        'Administered as per MAR',
        'PRN administered',
        'Refused',
        'Missed dose',
      ],
      helpText:
        'For a PRN dose or a refused/missed dose, record the time and reason in the handover notes.',
      order: 5,
    },
    {
      key: 'nutrition_hydration',
      label: 'Meals, nutrition & hydration',
      type: 'select',
      required: false,
      options: [
        'Prepared and eaten well',
        'Prompted to eat/drink',
        'Partially eaten',
        'Refused',
        'Nil by mouth',
      ],
      helpText: 'Meals prepared and how well the participant ate and drank.',
      order: 6,
    },
    {
      key: 'community_access',
      label: 'Community access & activities',
      type: 'longText',
      required: false,
      options: [],
      helpText: 'Where the participant went, what they did, and the transport used.',
      order: 7,
    },
    {
      key: 'goal_progress',
      label: 'Progress towards goals',
      type: 'longText',
      required: false,
      options: [],
      helpText: "Link your observations to the participant's NDIS plan goals.",
      order: 8,
    },
    {
      key: 'incidents_hazards',
      label: 'Incidents, injuries & hazards',
      type: 'select',
      required: true,
      options: [
        'None',
        'Minor – first aid given',
        'Injury – medical attention required',
        'Reportable incident',
        'Hazard identified',
      ],
      helpText:
        'Reportable incidents must also be lodged in the incident register within 24 hours.',
      order: 9,
    },
    {
      key: 'restrictive_practice',
      label: 'Restrictive practice used',
      type: 'checkbox',
      required: false,
      options: [],
      helpText:
        'Tick only if a regulated restrictive practice was used and it is authorised in the behaviour support plan.',
      order: 10,
    },
    {
      key: 'handover',
      label: 'Handover & follow-up',
      type: 'longText',
      required: false,
      options: [],
      helpText: 'Anything the next worker, support coordinator or plan manager needs to know.',
      order: 11,
    },
    {
      key: 'worker_declaration',
      label: 'Worker declaration',
      type: 'checkbox',
      required: true,
      options: [],
      helpText: 'I confirm this note is a true and accurate record of the supports provided.',
      order: 12,
    },
  ],
};

const DEFAULT_NOTE_TEMPLATES = [DAILY_SUPPORT_SHIFT_NOTE];

module.exports = {
  DAILY_SUPPORT_SHIFT_NOTE,
  DEFAULT_NOTE_TEMPLATES,
};
