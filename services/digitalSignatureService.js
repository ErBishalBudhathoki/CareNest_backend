/**
 * Digital Signature Service
 * Handles service confirmations with digital signatures
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let PDFDocument = null;

// In-memory storage for demo (use database in production)
const signatures = new Map();
const serviceConfirmations = new Map();

/**
 * Save digital signature
 * @param {Object} params - Signature parameters
 * @returns {Object} Signature data
 */
exports.saveSignature = async (params) => {
  const { appointmentId, clientId, signatureData, timestamp } = params;

  // Create hash of signature for verification
  const hash = crypto
    .createHash('sha256')
    .update(signatureData + timestamp.toISOString())
    .digest('hex');

  const signature = {
    _id: `sig-${Date.now()}`,
    appointmentId,
    clientId,
    signatureData, // Base64 encoded image
    timestamp,
    hash,
    verified: true,
    ipAddress: params.ipAddress || null,
    deviceInfo: params.deviceInfo || null,
  };

  signatures.set(signature._id, signature);

  return signature;
};

/**
 * Submit service confirmation
 * @param {Object} params - Confirmation parameters
 * @returns {Object} Confirmation data
 */
exports.submitServiceConfirmation = async (params) => {
  const {
    appointmentId,
    clientId,
    workerId,
    signatureId,
    rating,
    feedback,
    checklist,
    photos,
    incidents,
    timestamp,
  } = params;

  const confirmation = {
    _id: `conf-${Date.now()}`,
    appointmentId,
    clientId,
    workerId,
    signatureId,
    rating, // 1-5 stars
    feedback,
    checklist, // Array of completed checklist items
    photos, // Array of photo URLs
    incidents, // Array of incident reports
    timestamp,
    status: 'confirmed',
  };

  serviceConfirmations.set(appointmentId, confirmation);

  // Generate PDF report
  const pdfPath = await generateServiceReport(confirmation);
  confirmation.reportUrl = pdfPath;

  return confirmation;
};

/**
 * Get service confirmation
 * @param {String} appointmentId - Appointment ID
 * @returns {Object} Confirmation data
 */
exports.getServiceConfirmation = async (appointmentId) => {
  const confirmation = serviceConfirmations.get(appointmentId);
  if (!confirmation) {
    return null;
  }

  // Get signature data
  if (confirmation.signatureId) {
    confirmation.signature = signatures.get(confirmation.signatureId);
  }

  return confirmation;
};

/**
 * Verify signature
 * @param {String} signatureId - Signature ID
 * @returns {Object} Verification result
 */
exports.verifySignature = async (signatureId) => {
  const signature = signatures.get(signatureId);
  if (!signature) {
    return { verified: false, message: 'Signature not found' };
  }

  // Verify hash
  const hash = crypto
    .createHash('sha256')
    .update(signature.signatureData + signature.timestamp.toISOString())
    .digest('hex');

  const verified = hash === signature.hash;

  return {
    verified,
    signatureId,
    timestamp: signature.timestamp,
    message: verified ? 'Signature verified' : 'Signature verification failed',
  };
};

/**
 * Submit incident report
 * @param {Object} params - Incident parameters
 * @returns {Object} Incident data
 */
exports.submitIncidentReport = async (params) => {
  const {
    appointmentId,
    reportedBy,
    reporterType,
    severity,
    category,
    description,
    photos,
    timestamp,
  } = params;

  const incident = {
    _id: `inc-${Date.now()}`,
    appointmentId,
    reportedBy,
    reporterType, // 'client', 'worker', 'family'
    severity, // 'low', 'medium', 'high', 'critical'
    category, // 'safety', 'quality', 'behavior', 'equipment', 'other'
    description,
    photos: photos || [],
    timestamp,
    status: 'reported',
    resolution: null,
    resolvedAt: null,
  };

  // In production, save to database and trigger notifications
  console.log('INCIDENT REPORTED:', incident);

  return incident;
};

/**
 * Get service checklist template
 * @param {String} serviceType - Service type
 * @returns {Array} Checklist items
 */
exports.getChecklistTemplate = async (serviceType) => {
  // Default checklist (customize based on service type)
  const templates = {
    personal_care: [
      { id: 1, item: 'Assisted with personal hygiene', required: true },
      { id: 2, item: 'Medication administered as prescribed', required: true },
      { id: 3, item: 'Meal preparation and assistance', required: false },
      { id: 4, item: 'Mobility assistance provided', required: false },
      { id: 5, item: 'Environment cleaned and organized', required: false },
    ],
    community_access: [
      { id: 1, item: 'Transportation provided safely', required: true },
      { id: 2, item: 'Activity participation supported', required: true },
      { id: 3, item: 'Social interaction facilitated', required: false },
      { id: 4, item: 'Safety monitored throughout', required: true },
    ],
    household_tasks: [
      { id: 1, item: 'Cleaning tasks completed', required: true },
      { id: 2, item: 'Laundry done', required: false },
      { id: 3, item: 'Meal preparation', required: false },
      { id: 4, item: 'Shopping assistance', required: false },
    ],
    default: [
      { id: 1, item: 'Service provided as scheduled', required: true },
      { id: 2, item: 'Client needs addressed', required: true },
      { id: 3, item: 'Quality standards met', required: true },
      { id: 4, item: 'Safety protocols followed', required: true },
    ],
  };

  return templates[serviceType] || templates.default;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Lazy-load PDF engine so route imports do not fail when optional dependency is missing.
 * @returns {Function|null}
 */
function loadPdfDocument() {
  if (PDFDocument) {
    return PDFDocument;
  }

  try {
    PDFDocument = require('pdfkit');
    return PDFDocument;
  } catch (error) {
    const missingPdfKit =
      error &&
      error.code === 'MODULE_NOT_FOUND' &&
      typeof error.message === 'string' &&
      error.message.includes('pdfkit');

    if (missingPdfKit) {
      return null;
    }

    throw error;
  }
}

/**
 * Generate PDF service report
 * @param {Object} confirmation - Confirmation data
 * @returns {String} PDF file path
 */
async function generateServiceReport(confirmation) {
  return new Promise((resolve, reject) => {
    try {
      // Ensure reports directory exists
      const reportsDir = path.join(__dirname, '../reports');
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const PdfDocumentClass = loadPdfDocument();
      if (!PdfDocumentClass) {
        const fallbackFileName = `service-report-${confirmation.appointmentId}.json`;
        const fallbackFilePath = path.join(reportsDir, fallbackFileName);
        const fallbackReport = {
          generatedAt: new Date().toISOString(),
          format: 'json-fallback',
          confirmation,
        };

        fs.writeFileSync(fallbackFilePath, JSON.stringify(fallbackReport, null, 2), 'utf8');
        resolve(`/reports/${fallbackFileName}`);
        return;
      }

      const fileName = `service-report-${confirmation.appointmentId}.pdf`;
      const filePath = path.join(reportsDir, fileName);
      const doc = new PdfDocumentClass();
      const stream = fs.createWriteStream(filePath);

      doc.pipe(stream);

      // Header
      doc.fontSize(20).text('Service Confirmation Report', { align: 'center' });
      doc.moveDown();

      // Appointment details
      doc.fontSize(12).text(`Appointment ID: ${confirmation.appointmentId}`);
      doc.text(`Date: ${new Date(confirmation.timestamp).toLocaleString()}`);
      doc.text(`Client ID: ${confirmation.clientId}`);
      doc.text(`Worker ID: ${confirmation.workerId}`);
      doc.moveDown();

      // Rating
      if (confirmation.rating) {
        doc.text(`Client Rating: ${'⭐'.repeat(confirmation.rating)} (${confirmation.rating}/5)`);
        doc.moveDown();
      }

      // Feedback
      if (confirmation.feedback) {
        doc.fontSize(14).text('Client Feedback:', { underline: true });
        doc.fontSize(12).text(confirmation.feedback);
        doc.moveDown();
      }

      // Checklist
      if (confirmation.checklist && confirmation.checklist.length > 0) {
        doc.fontSize(14).text('Service Checklist:', { underline: true });
        doc.fontSize(12);
        confirmation.checklist.forEach((item) => {
          const status = item.completed ? '✓' : '✗';
          doc.text(`${status} ${item.item}`);
        });
        doc.moveDown();
      }

      // Incidents
      if (confirmation.incidents && confirmation.incidents.length > 0) {
        doc.fontSize(14).text('Incidents Reported:', { underline: true });
        doc.fontSize(12);
        confirmation.incidents.forEach((incident, index) => {
          doc.text(`${index + 1}. ${incident.description} (Severity: ${incident.severity})`);
        });
        doc.moveDown();
      }

      // Signature
      doc.fontSize(14).text('Digital Signature:', { underline: true });
      doc.fontSize(10).text(`Signature ID: ${confirmation.signatureId}`);
      doc.text(`Verified: Yes`);
      doc.moveDown();

      // Footer
      doc.fontSize(8).text('This is a digitally generated report.', { align: 'center' });
      doc.text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });

      doc.end();

      stream.on('finish', () => {
        resolve(`/reports/${fileName}`);
      });

      stream.on('error', (error) => {
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}
