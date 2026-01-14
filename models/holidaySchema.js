class HolidaySchema {
  static validate(data) {
    const { Holiday, Date, Day, organizationId } = data;
    const errors = [];

    // Required fields
    if (!Holiday || typeof Holiday !== 'string' || Holiday.trim() === '') {
      errors.push('Holiday name is required');
    }

    if (!Date || typeof Date !== 'string') {
      errors.push('Date is required');
    } else {
      // Validate format DD-MM-YYYY
      const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
      if (!dateRegex.test(Date)) {
        errors.push('Invalid date format. Use DD-MM-YYYY');
      }
    }

    if (!Day || typeof Day !== 'string') {
      errors.push('Day is required');
    }

    // Optional: organizationId should be string if present
    if (organizationId && typeof organizationId !== 'string') {
      errors.push('Invalid organizationId format');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = HolidaySchema;
