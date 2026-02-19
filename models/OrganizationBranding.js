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
  collection: 'organization_branding',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      if (ret.organizationId) ret.organizationId = ret.organizationId.toString();
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      
      if (ret.invoiceTemplate && ret.invoiceTemplate.customFields) {
        ret.invoiceTemplate.customFields.forEach(f => delete f._id);
      }
      
      return ret;
    }
  }
});

module.exports = mongoose.model('OrganizationBranding', organizationBrandingSchema);
