const mongoose = require('mongoose');

const organizationBrandingSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
  primaryColor: { type: String, default: '#DC143C' },
  secondaryColor: { type: String, default: '#0066CC' },
  logoUrl: String,
  invoiceTemplate: {
    headerText: String,
    footerText: String,
    showLogo: { type: Boolean, default: true },
    customFields: [{
      name: String,
      value: String
    }]
  },
  emailTemplate: {
    headerImage: String,
    signature: String
  }
}, {
  timestamps: true,
  collection: 'organization_branding'
});

module.exports = mongoose.model('OrganizationBranding', organizationBrandingSchema);
