const Note = require('../models/Note');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

class NotesController {
  /**
   * Add a note for a client
   * POST /api/notes
   */
  addNote = catchAsync(async (req, res) => {
    const { userEmail, clientEmail, notes } = req.body;
    const organizationId = req.user?.organizationId;

    if (!userEmail || !clientEmail || !notes) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'userEmail, clientEmail, and notes are required fields.'
      });
    }

    const note = await Note.create({
      userEmail,
      clientEmail,
      notes,
      organizationId
    });

    logger.business('Note Added', {
      event: 'note_added',
      userEmail,
      clientEmail,
      organizationId,
      noteId: note._id.toString(),
      timestamp: new Date().toISOString()
    });

    res.status(201).json({
      success: true,
      code: 'NOTE_ADDED',
      message: 'Note added successfully.',
      data: {
        id: note._id.toString(),
        userEmail: note.userEmail,
        clientEmail: note.clientEmail,
        notes: note.notes,
        organizationId: note.organizationId,
        createdAt: note.createdAt
      }
    });
  });

  /**
   * Get notes for a client
   * GET /api/notes/:clientEmail
   */
  getNotes = catchAsync(async (req, res) => {
    const { clientEmail } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const userEmail = req.user?.email;

    if (!clientEmail) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'clientEmail is required.'
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const notes = await Note.find({
      clientEmail,
      userEmail
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Note.countDocuments({ clientEmail, userEmail });

    logger.business('Notes Retrieved', {
      event: 'notes_retrieved',
      userEmail,
      clientEmail,
      count: notes.length,
      page,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      code: 'NOTES_RETRIEVED',
      data: {
        notes,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  });

  /**
   * Update a note
   * PUT /api/notes/:id
   */
  updateNote = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { notes } = req.body;
    const userEmail = req.user?.email;

    if (!notes) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'notes content is required.'
      });
    }

    const note = await Note.findOneAndUpdate(
      { _id: id, userEmail },
      { notes, updatedAt: new Date() },
      { new: true }
    );

    if (!note) {
      return res.status(404).json({
        success: false,
        code: 'NOTE_NOT_FOUND',
        message: 'Note not found or you do not have permission to update it.'
      });
    }

    logger.business('Note Updated', {
      event: 'note_updated',
      userEmail,
      noteId: id,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      code: 'NOTE_UPDATED',
      message: 'Note updated successfully.',
      data: note
    });
  });

  /**
   * Delete a note
   * DELETE /api/notes/:id
   */
  deleteNote = catchAsync(async (req, res) => {
    const { id } = req.params;
    const userEmail = req.user?.email;

    const note = await Note.findOneAndDelete({ _id: id, userEmail });

    if (!note) {
      return res.status(404).json({
        success: false,
        code: 'NOTE_NOT_FOUND',
        message: 'Note not found or you do not have permission to delete it.'
      });
    }

    logger.business('Note Deleted', {
      event: 'note_deleted',
      userEmail,
      noteId: id,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      code: 'NOTE_DELETED',
      message: 'Note deleted successfully.'
    });
  });
}

module.exports = new NotesController();
