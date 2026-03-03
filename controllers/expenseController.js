const expenseService = require('../services/expenseService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

class ExpenseController {
  createExpense = catchAsync(async (req, res) => {
    const result = await expenseService.createExpense(req.body);
    res.status(201).json(result);
  });

  getExpenseCategories = catchAsync(async (req, res) => {
    const result = await expenseService.getExpenseCategories();
    const categories = result?.data ?? {};
    res.json({
      success: true,
      statusCode: result?.statusCode ?? 200,
      categories,
      data: categories
    });
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
    const result = await expenseService.getExpenseById(expenseId);
    const expense = result?.data;

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json(result);
  });

  updateExpense = catchAsync(async (req, res) => {
    const { expenseId } = req.params;
    const result = await expenseService.updateExpense(expenseId, req.body);
    res.json(result);
  });

  deleteExpense = catchAsync(async (req, res) => {
    const { expenseId } = req.params;
    const userEmail = req.user?.email || req.body?.userEmail;
    const deleteReason = req.body?.deleteReason;
    const result = await expenseService.deleteExpense(
      expenseId,
      userEmail,
      deleteReason
    );
    res.json(result);
  });

  updateExpenseApproval = catchAsync(async (req, res) => {
    const { expenseId } = req.params;
    const { status, approvalStatus, approvedBy, userEmail, approvalNotes } = req.body;

    const result = await expenseService.updateExpenseApproval(expenseId, {
      approvalStatus: approvalStatus || status,
      userEmail: userEmail || approvedBy || req.user?.email,
      approvalNotes
    });

    res.json(result);
  });

  bulkImportExpenses = catchAsync(async (req, res) => {
    const result = await expenseService.bulkImportExpenses({
      expenses: req.body?.expenses,
      organizationId: req.body?.organizationId,
      userEmail: req.body?.userEmail || req.user?.email,
      importNotes: req.body?.importNotes
    });
    res.json(result);
  });
}

module.exports = new ExpenseController();
