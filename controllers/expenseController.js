const expenseService = require('../services/expenseService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

class ExpenseController {
  createExpense = catchAsync(async (req, res) => {
    const result = await expenseService.createExpense(req.body);
    res.status(201).json(result);
  });

  getExpenseCategories = catchAsync(async (req, res) => {
    const categories = await expenseService.getExpenseCategories();
    res.json(categories);
  });

  getOrganizationExpenses = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    const { page = 1, limit = 50, status, category, startDate, endDate } = req.query;

    const result = await expenseService.getOrganizationExpenses(organizationId, {
      page: parseInt(page),
      limit: parseInt(limit),
      status,
      category,
      startDate,
      endDate
    });

    res.json(result);
  });

  getExpenseById = catchAsync(async (req, res) => {
    const { expenseId } = req.params;
    const expense = await expenseService.getExpenseById(expenseId);

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json(expense);
  });

  updateExpense = catchAsync(async (req, res) => {
    const { expenseId } = req.params;
    const result = await expenseService.updateExpense(expenseId, req.body);
    res.json(result);
  });

  deleteExpense = catchAsync(async (req, res) => {
    const { expenseId } = req.params;
    const result = await expenseService.deleteExpense(expenseId);
    res.json(result);
  });

  updateExpenseApproval = catchAsync(async (req, res) => {
    const { expenseId } = req.params;
    const { status, approvedBy, approvalNotes } = req.body;

    const result = await expenseService.updateExpenseApproval(expenseId, {
      status,
      approvedBy,
      approvalNotes
    });

    res.json(result);
  });

  bulkImportExpenses = catchAsync(async (req, res) => {
    const { expenses, organizationId } = req.body;
    const result = await expenseService.bulkImportExpenses(expenses, organizationId);
    res.json(result);
  });
}

module.exports = new ExpenseController();
