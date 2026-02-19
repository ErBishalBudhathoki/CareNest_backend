/**
 * CarePlanFactory - Factory for generating care plan entities
 * 
 * Creates care plans with goals, medications, and risk assessments
 */

import EntityFactory from './EntityFactory.js';
import validationRules from '../validation/validationRules.js';

class CarePlanFactory extends EntityFactory {
  constructor() {
    super('carePlan', validationRules.carePlan);
  }

  /**
   * Create a care plan with optional overrides
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated care plan
   */
  create(overrides = {}) {
    const startDate = this._randomPastDate(1);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + this._randomInt(3, 12)); // 3-12 months duration

    const reviewDate = new Date(startDate);
    reviewDate.setMonth(reviewDate.getMonth() + this._randomInt(1, 6)); // Review in 1-6 months

    const carePlan = {
      clientId: null, // To be set by relationship builder
      organizationId: null, // To be set by relationship builder
      assignedWorkerId: null, // Primary care worker
      startDate,
      endDate,
      reviewDate,
      status: this._randomPick(['active', 'inactive', 'under-review', 'completed']),
      goals: this._generateGoals(),
      medications: this._generateMedications(),
      riskAssessments: this._generateRiskAssessments(),
      supportNeeds: {
        personal: this._randomPickMultiple(
          ['bathing', 'dressing', 'grooming', 'toileting', 'mobility'],
          this._randomInt(1, 4)
        ),
        domestic: this._randomPickMultiple(
          ['cleaning', 'laundry', 'shopping', 'meal-prep'],
          this._randomInt(1, 3)
        ),
        social: this._randomPickMultiple(
          ['community-access', 'social-activities', 'companionship'],
          this._randomInt(0, 3)
        ),
        health: this._randomPickMultiple(
          ['medication-management', 'appointments', 'exercise', 'nutrition'],
          this._randomInt(1, 4)
        )
      },
      behaviorSupport: {
        required: this._randomBoolean(0.3),
        strategies: this._randomBoolean(0.3) ? [
          this.faker.lorem.sentence(),
          this.faker.lorem.sentence()
        ] : [],
        triggers: this._randomBoolean(0.3) ? [
          this.faker.lorem.word(),
          this.faker.lorem.word()
        ] : []
      },
      notes: this.faker.lorem.paragraph(),
      createdBy: null, // To be set by relationship builder
      lastReviewedBy: null,
      lastReviewedAt: this._randomBoolean(0.5) ? this._randomPastDate(0.5) : null,
      createdAt: startDate,
      updatedAt: new Date()
    };

    const merged = this._mergeOverrides(carePlan, overrides);
    return this._markAsSeedData(merged);
  }

  /**
   * Generate care goals
   * @private
   * @returns {Array} Array of goals
   */
  _generateGoals() {
    const goalCount = this._randomInt(2, 5);
    const goals = [];

    const goalTemplates = [
      'Improve mobility and independence',
      'Maintain social connections',
      'Manage chronic health conditions',
      'Develop daily living skills',
      'Increase community participation',
      'Improve nutrition and meal planning',
      'Enhance communication skills',
      'Maintain personal hygiene independently'
    ];

    for (let i = 0; i < goalCount; i++) {
      goals.push({
        description: this._randomPick(goalTemplates),
        targetDate: this._randomFutureDate(1),
        status: this._randomPick(['not-started', 'in-progress', 'achieved', 'on-hold']),
        progress: this._randomInt(0, 100),
        notes: this.faker.lorem.sentence()
      });
    }

    return goals;
  }

  /**
   * Generate medications list
   * @private
   * @returns {Array} Array of medications
   */
  _generateMedications() {
    const medCount = this._randomInt(0, 5);
    const medications = [];

    const medNames = [
      'Paracetamol', 'Ibuprofen', 'Metformin', 'Atorvastatin',
      'Amlodipine', 'Omeprazole', 'Sertraline', 'Levothyroxine'
    ];

    for (let i = 0; i < medCount; i++) {
      medications.push({
        name: this._randomPick(medNames),
        dosage: `${this._randomPick([5, 10, 20, 50, 100])}mg`,
        frequency: this._randomPick(['once daily', 'twice daily', 'three times daily', 'as needed']),
        route: this._randomPick(['oral', 'topical', 'injection']),
        startDate: this._randomPastDate(2),
        endDate: this._randomBoolean(0.3) ? this._randomFutureDate(1) : null,
        prescribedBy: this.faker.person.fullName(),
        notes: this.faker.lorem.sentence()
      });
    }

    return medications;
  }

  /**
   * Generate risk assessments
   * @private
   * @returns {Array} Array of risk assessments
   */
  _generateRiskAssessments() {
    const riskTypes = ['falls', 'medication', 'behavioral', 'medical', 'environmental'];
    const assessments = [];

    for (const riskType of riskTypes) {
      if (this._randomBoolean(0.6)) { // 60% chance of each risk type
        assessments.push({
          type: riskType,
          level: this._randomPick(['low', 'medium', 'high']),
          description: this.faker.lorem.sentence(),
          mitigationStrategies: [
            this.faker.lorem.sentence(),
            this.faker.lorem.sentence()
          ],
          assessedBy: this.faker.person.fullName(),
          assessedAt: this._randomPastDate(0.5),
          nextReviewDate: this._randomFutureDate(0.5)
        });
      }
    }

    return assessments;
  }
}

export default CarePlanFactory;
