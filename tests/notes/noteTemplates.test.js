/**
 * Tests for Phase 2 progress-note templates and structured notes.
 * Models are mocked; the controller methods are exercised directly.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/NoteTemplate', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  findOneAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
  exists: jest.fn(),
}));

jest.mock('../../models/Note', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
}));

const NoteTemplate = require('../../models/NoteTemplate');
const Note = require('../../models/Note');
const noteTemplateController = require('../../controllers/noteTemplateController');
const notesController = require('../../controllers/notesController');

/** Minimal express-like req/res capture. */
function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    res.body = payload;
    return res;
  });
  return res;
}

const sortable = (docs) => ({ sort: () => Promise.resolve(docs) });

/** Let a `catchAsync`-wrapped handler finish before asserting on its res. */
const settleHandler = () => new Promise((resolve) => setImmediate(resolve));

describe('NoteTemplateController', () => {
  const user = { organizationId: 'org1', email: 'admin@org.com' };

  test('listTemplates filters by organization', async () => {
    NoteTemplate.find.mockReturnValue(sortable([{ _id: 't1' }]));
    const req = { user, query: {} };
    const res = mockRes();

    await noteTemplateController.listTemplates(req, res);

    expect(NoteTemplate.find).toHaveBeenCalledWith({ organizationId: 'org1' });
    expect(res.body.success).toBe(true);
    expect(res.body.data.templates).toHaveLength(1);
  });

  test('bootstraps the default template when the organisation has none', async () => {
    // First read sees an empty list (brand-new organisation), so the controller
    // seeds the built-ins and re-reads.
    NoteTemplate.find.mockReturnValueOnce(sortable([]));
    NoteTemplate.countDocuments.mockResolvedValue(0);
    NoteTemplate.exists.mockResolvedValue(null);
    NoteTemplate.findOneAndUpdate.mockResolvedValue({ _id: 'seeded' });
    NoteTemplate.find.mockReturnValue(
      sortable([{ _id: 'seeded', name: 'Daily Support Shift Note' }])
    );

    const req = { user, query: {} };
    const res = mockRes();

    await noteTemplateController.listTemplates(req, res);
    // `catchAsync` does not return the promise it creates, so the awaited call
    // above resolves before the handler's awaits have run. Yield a macrotask so
    // the bootstrap chain (find -> count -> exists -> upsert -> re-find) lands.
    await settleHandler();

    expect(NoteTemplate.countDocuments).toHaveBeenCalledWith({
      organizationId: 'org1',
    });
    expect(NoteTemplate.findOneAndUpdate).toHaveBeenCalled();
    expect(res.body.data.templates).toHaveLength(1);
    expect(res.body.data.templates[0].name).toBe('Daily Support Shift Note');
  });

  test('does not bootstrap when the organisation already has templates', async () => {
    NoteTemplate.find.mockReturnValue(sortable([{ _id: 't1' }]));

    const req = { user, query: {} };
    const res = mockRes();

    await noteTemplateController.listTemplates(req, res);
    await settleHandler();

    expect(NoteTemplate.countDocuments).not.toHaveBeenCalled();
    expect(NoteTemplate.findOneAndUpdate).not.toHaveBeenCalled();
    expect(res.body.data.templates).toHaveLength(1);
  });

  test('createTemplate normalizes and orders sections', async () => {
    NoteTemplate.create.mockImplementation(async (doc) => ({ _id: 't1', ...doc }));
    const req = {
      user,
      body: {
        name: 'Daily shift note',
        sections: [
          { key: 'b', label: 'Mood', type: 'select', options: ['good', 'bad'], order: 2 },
          { key: 'a', label: 'Summary', type: 'longText', order: 1 },
          { label: 'no-key' }, // dropped
        ],
      },
    };
    const res = mockRes();

    await noteTemplateController.createTemplate(req, res);

    expect(res.statusCode).toBe(201);
    const sections = res.body.data.sections;
    expect(sections.map((s) => s.key)).toEqual(['a', 'b']);
    expect(sections[1].options).toEqual(['good', 'bad']);
  });

  test('createTemplate rejects when organization context is missing', async () => {
    const req = { user: {}, body: { name: 'x' } };
    const res = mockRes();
    await noteTemplateController.createTemplate(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('MISSING_ORGANIZATION');
  });

  test('updateTemplate scopes by organization', async () => {
    NoteTemplate.findOneAndUpdate.mockResolvedValue({ _id: 't1', name: 'updated' });
    const req = { user, params: { id: 't1' }, body: { name: 'updated' } };
    const res = mockRes();

    await noteTemplateController.updateTemplate(req, res);

    const [filter] = NoteTemplate.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 't1', organizationId: 'org1' });
    expect(res.body.success).toBe(true);
  });

  test('deleteTemplate soft-deactivates', async () => {
    NoteTemplate.findOneAndUpdate.mockResolvedValue({ _id: 't1', active: false });
    const req = { user, params: { id: 't1' } };
    const res = mockRes();

    await noteTemplateController.deleteTemplate(req, res);

    const [, update] = NoteTemplate.findOneAndUpdate.mock.calls[0];
    expect(update.active).toBe(false);
    expect(res.body.code).toBe('NOTE_TEMPLATE_DELETED');
  });
});

describe('NotesController.addNote — structured + idempotency', () => {
  const user = { organizationId: 'org1', email: 'worker@org.com' };

  test('creates a free-text note when notes is provided', async () => {
    Note.findOne.mockResolvedValue(null);
    Note.create.mockImplementation(async (doc) => ({ _id: 'n1', ...doc }));
    const req = {
      user,
      body: { userEmail: 'worker@org.com', clientEmail: 'c@x.com', notes: 'hello' },
    };
    const res = mockRes();

    await notesController.addNote(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.data.noteType).toBe('free_text');
  });

  test('creates a structured note from templateId + structuredData', async () => {
    Note.findOne.mockResolvedValue(null);
    Note.create.mockImplementation(async (doc) => ({ _id: 'n2', ...doc }));
    const req = {
      user,
      body: {
        userEmail: 'worker@org.com',
        clientEmail: 'c@x.com',
        templateId: '507f1f77bcf86cd799439011',
        structuredData: { summary: 'ok', mood: 'good' },
      },
    };
    const res = mockRes();

    await notesController.addNote(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.data.noteType).toBe('structured');
    expect(res.body.data.structuredData).toEqual({ summary: 'ok', mood: 'good' });
  });

  test('rejects a note with neither text nor structured data', async () => {
    const req = { user, body: { userEmail: 'w@x.com', clientEmail: 'c@x.com' } };
    const res = mockRes();
    await notesController.addNote(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('is idempotent for a repeated clientNoteId', async () => {
    Note.findOne.mockResolvedValue({ _id: 'existing', clientNoteId: 'draft-1' });
    const req = {
      user,
      body: {
        userEmail: 'w@x.com',
        clientEmail: 'c@x.com',
        notes: 'retry',
        clientNoteId: 'draft-1',
      },
    };
    const res = mockRes();

    await notesController.addNote(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.code).toBe('NOTE_ALREADY_EXISTS');
    expect(Note.create).not.toHaveBeenCalled();
  });
});
