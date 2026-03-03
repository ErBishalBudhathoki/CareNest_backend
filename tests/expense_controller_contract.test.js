const expenseController = require('../controllers/expenseController');
const expenseService = require('../services/expenseService');

jest.mock('../services/expenseService', () => ({
  createExpense: jest.fn(),
  getExpenseCategories: jest.fn(),
  getOrganizationExpenses: jest.fn(),
  getExpenseById: jest.fn(),
  updateExpense: jest.fn(),
  deleteExpense: jest.fn(),
  updateExpenseApproval: jest.fn(),
  bulkImportExpenses: jest.fn()
}));

jest.mock('../utils/catchAsync', () => (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
});

describe('Expense Controller Contract', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { body: {}, params: {}, query: {}, user: { email: 'admin@test.com' } };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  test('getExpenseCategories returns normalized payload with categories and data', async () => {
    expenseService.getExpenseCategories.mockResolvedValue({
      statusCode: 200,
      data: {
        travel: { name: 'Travel' }
      }
    });

    await expenseController.getExpenseCategories(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      statusCode: 200,
      categories: { travel: { name: 'Travel' } },
      data: { travel: { name: 'Travel' } }
    });
  });

  test('getExpenseById returns wrapped service result', async () => {
    req.params.expenseId = '507f1f77bcf86cd799439011';
    expenseService.getExpenseById.mockResolvedValue({
      statusCode: 200,
      data: { id: req.params.expenseId, amount: 10 }
    });

    await expenseController.getExpenseById(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      statusCode: 200,
      data: { id: req.params.expenseId, amount: 10 }
    });
  });

  test('deleteExpense passes authenticated user email to service', async () => {
    req.params.expenseId = '507f1f77bcf86cd799439011';
    req.body.deleteReason = 'duplicate';
    expenseService.deleteExpense.mockResolvedValue({
      statusCode: 200,
      message: 'Expense record deleted successfully'
    });

    await expenseController.deleteExpense(req, res, next);

    expect(expenseService.deleteExpense).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      'admin@test.com',
      'duplicate'
    );
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 200,
      message: 'Expense record deleted successfully'
    });
  });

  test('updateExpenseApproval supports legacy status and maps identity', async () => {
    req.params.expenseId = '507f1f77bcf86cd799439011';
    req.body = {
      status: 'approved',
      approvedBy: 'approver@test.com',
      approvalNotes: 'ok'
    };
    expenseService.updateExpenseApproval.mockResolvedValue({
      statusCode: 200,
      approvalStatus: 'approved'
    });

    await expenseController.updateExpenseApproval(req, res, next);

    expect(expenseService.updateExpenseApproval).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      {
        approvalStatus: 'approved',
        userEmail: 'approver@test.com',
        approvalNotes: 'ok'
      }
    );
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 200,
      approvalStatus: 'approved'
    });
  });

  test('bulkImportExpenses sends full payload object to service', async () => {
    req.body = {
      organizationId: '507f1f77bcf86cd799439012',
      userEmail: 'importer@test.com',
      importNotes: 'seed',
      expenses: [{ amount: 5, category: 'Travel', description: 'Taxi', expenseDate: '2026-03-01' }]
    };
    expenseService.bulkImportExpenses.mockResolvedValue({
      statusCode: 200,
      message: 'Bulk import completed'
    });

    await expenseController.bulkImportExpenses(req, res, next);

    expect(expenseService.bulkImportExpenses).toHaveBeenCalledWith({
      organizationId: '507f1f77bcf86cd799439012',
      userEmail: 'importer@test.com',
      importNotes: 'seed',
      expenses: [{ amount: 5, category: 'Travel', description: 'Taxi', expenseDate: '2026-03-01' }]
    });
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 200,
      message: 'Bulk import completed'
    });
  });
});
