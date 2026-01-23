# Product Requirement Document (PRD): Employee Onboarding Workflow

## 1. Overview
The **Employee Onboarding Workflow** is a dedicated module to streamline the process of adding new employees to the CareNest platform. It digitizes the traditional paperwork process, ensures compliance through document collection, and automates initial communication.

## 2. Goals & Objectives
- **Efficiency**: Reduce manual data entry by allowing employees to self-onboard.
- **Compliance**: Ensure all necessary legal and qualification documents (Tax, Super, ID, Certifications) are collected before the employee starts work.
- **Experience**: Provide a professional and smooth welcome experience for new hires.
- **Tracking**: Give admins visibility into the progress of each new hire's onboarding.

## 3. User Stories
- **As an Admin**, I want to invite a new employee via email so they can set up their account.
- **As an Admin**, I want to track the status of each employee's onboarding (e.g., "Pending Documents", "Under Review", "Completed").
- **As a New Employee**, I want to log in and see a checklist of tasks I need to complete (Profile, Tax Info, Documents).
- **As a New Employee**, I want to upload photos/PDFs of my qualifications and ID.
- **As an Admin**, I want to verify uploaded documents and approve or reject them.
- **As an Admin**, I want the system to automatically send a welcome email once onboarding is complete.

## 4. Functional Requirements

### 4.1. Digital Onboarding Forms
- **Personal Information**: Address, Phone, Emergency Contacts.
- **Tax File Declaration (TFN)**: Collection of TFN and tax status (Resident/Non-resident, Tax-free threshold).
- **Superannuation**: Fund name, Member number, USI (or option to stick with default fund).
- **Bank Details**: Already exists, but needs to be part of this flow.

### 4.2. Document Upload
- **Identity Documents**: Driver's License, Passport.
- **Qualifications**: NDIS Worker Screening, First Aid Certificate, Degrees/Diplomas.
- **Validation**:
    - File types: JPG, PNG, PDF.
    - Max size: 5MB per file.
    - Expiry dates: Users must enter expiry dates for certifications.

### 4.3. Onboarding Checklist & Status
- **Progress Tracking**: A progress bar for the employee (e.g., "3 of 5 steps completed").
- **Admin Dashboard**: List of onboarding employees with status indicators.
- **Steps**:
    1.  Account Setup (Password creation)
    2.  Personal Details
    3.  Bank Details
    4.  Tax & Super
    5.  Documents Upload
    6.  Policy Acknowledgment (Optional for now)

### 4.4. Probation Period Tracking
- **Configuration**: Admin sets probation end date (e.g., 3 months, 6 months).
- **Reminders**: Admin gets a reminder 2 weeks before probation ends.

### 4.5. Welcome Email Automation
- Trigger: When Admin clicks "Finalize Onboarding".
- Content: Welcome message, link to download app, first shift info (optional).

## 5. Technical Architecture

### 5.1. Database Schema (MongoDB)

#### New Collection: `onboarding_records`
Stores the state of an onboarding process for a user.
```javascript
{
  userId: ObjectId,
  organizationId: ObjectId,
  status: 'pending' | 'submitted' | 'changes_requested' | 'completed',
  currentStep: Number,
  steps: {
    personalDetails: { status: 'completed', updatedAt: Date },
    bankDetails: { status: 'completed', updatedAt: Date },
    taxDetails: {
      tfn: String, // Encrypted
      taxScale: String,
      updatedAt: Date
    },
    superannuation: {
      fundName: String,
      memberNumber: String,
      usi: String,
      updatedAt: Date
    },
    documents: { status: 'pending', count: Number }
  },
  probation: {
    startDate: Date,
    endDate: Date,
    reviewDate: Date,
    status: 'active' | 'passed' | 'extended' | 'failed'
  },
  createdAt: Date,
  updatedAt: Date
}
```

#### New Collection: `employee_documents`
Stores metadata about uploaded documents.
```javascript
{
  userId: ObjectId,
  organizationId: ObjectId,
  type: 'passport' | 'drivers_license' | 'first_aid' | 'ndis_screening' | 'other',
  documentNumber: String, // e.g. license number
  fileUrl: String,
  expiryDate: Date,
  status: 'pending' | 'verified' | 'rejected',
  rejectionReason: String,
  uploadedAt: Date,
  verifiedAt: Date,
  verifiedBy: ObjectId
}
```

### 5.2. Backend API (Node.js/Express)

#### Routes: `/api/onboarding`
- `GET /status`: Get current user's onboarding status.
- `PUT /step/:stepName`: Update data for a specific step (personal, tax, super).
- `POST /documents`: Upload a document.
- `GET /documents`: List user's documents.
- `PUT /submit`: Submit onboarding for review.

#### Routes: `/api/admin/onboarding`
- `GET /`: List all onboarding employees.
- `GET /:userId`: Get specific employee details.
- `PUT /:userId/verify-document/:docId`: Approve/Reject document.
- `PUT /:userId/finalize`: Complete onboarding and send welcome email.

### 5.3. Frontend (Flutter)

#### Architecture: MVVM + Riverpod

**Providers:**
- `onboardingRepositoryProvider`: Handles API calls.
- `onboardingViewModelProvider`: Manages state (loading, error, current step, form data).
- `documentUploadProvider`: Manages file picking and uploading state.

**Screens:**
- `OnboardingWelcomeView`: Intro screen.
- `OnboardingStepperView`: Main wrapper with StepProgressIndicator.
- `PersonalDetailsForm`: Form widget.
- `TaxSuperForm`: Form widget.
- `DocumentUploadView`: List of required docs + upload functionality.
- `OnboardingSuccessView`: "You're all set!" screen.

## 6. Implementation Plan

### Phase 1: Backend Foundation (Current Task)
1.  Create Mongoose models (`OnboardingRecord`, `EmployeeDocument`).
2.  Implement Controller & Service for Employee side (Save steps, Upload).
3.  Implement Controller & Service for Admin side (View, Verify).
4.  Add Routes.

### Phase 2: Frontend Employee Flow
1.  Create Data Models & Repository.
2.  Create ViewModel.
3.  Build UI Screens for Forms and Uploads.

### Phase 3: Admin Review & Automation
1.  Admin UI to view pending onboardings.
2.  Document verification logic.
3.  Welcome email trigger (using existing email service).
