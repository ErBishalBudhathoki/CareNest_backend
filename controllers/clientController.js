const clientService = require('../services/clientService');
const logger = require('../config/logger');
const clientAuthService = require('../services/clientAuthService');
const catchAsync = require('../utils/catchAsync');

class ClientController {
  activateClient = catchAsync(async (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ statusCode: 400, message: "Client email is required" });
    }

    const result = await clientAuthService.activateClientByAdmin(email);
    
    res.status(200).json({
      statusCode: 200,
      message: "Client activated successfully",
      data: result
    });
  });

  addClient = catchAsync(async (req, res) => {
    const result = await clientService.addClient(req.body);
    res.status(201).json({
      statusCode: 201,
      ...result
    });
  });

  getClients = catchAsync(async (req, res) => {
    const { organizationId } = req.query;
    const { userEmail } = req.body;
    
    const result = await clientService.getClients(organizationId, userEmail);
    res.status(200).json({
      statusCode: 200,
      ...result
    });
  });

  getClientById = catchAsync(async (req, res) => {
    const { clientId } = req.params;
    const { organizationId } = req.query;
    const { userEmail } = req.body;
    
    const result = await clientService.getClientById(clientId, organizationId, userEmail);
    res.status(200).json({
      statusCode: 200,
      ...result
    });
  });

  updateCareNotes = catchAsync(async (req, res) => {
    const { clientId } = req.params;
    const { organizationId, userEmail, careNotes } = req.body;
    
    const result = await clientService.updateCareNotes(clientId, careNotes, organizationId, userEmail);
    res.status(200).json({
      statusCode: 200,
      ...result
    });
  });

  updateClient = catchAsync(async (req, res) => {
    const { clientId } = req.params;
    const { organizationId, userEmail, ...updateData } = req.body;
    
    const result = await clientService.updateClient(clientId, updateData, organizationId, userEmail);
    res.status(200).json({
      statusCode: 200,
      ...result
    });
  });

  deleteClient = catchAsync(async (req, res) => {
    const { clientId } = req.params;
    const { organizationId, userEmail } = req.body;
    
    const result = await clientService.deleteClient(clientId, organizationId, userEmail);
    res.status(200).json({
      statusCode: 200,
      ...result
    });
  });

  getClientPricing = catchAsync(async (req, res) => {
    const { clientId } = req.params;
    const { organizationId } = req.query;
    const { userEmail } = req.body;
    
    const result = await clientService.getClientPricing(clientId, organizationId, userEmail);
    res.status(200).json({
      statusCode: 200,
      ...result
    });
  });

  updateClientPricing = catchAsync(async (req, res) => {
    const { clientId } = req.params;
    const { organizationId, userEmail, ...pricingData } = req.body;
    
    const result = await clientService.updateClientPricing(clientId, pricingData, organizationId, userEmail);
    res.status(200).json({
      statusCode: 200,
      ...result
    });
  });

  getMultipleClients = catchAsync(async (req, res) => {
    const { emails } = req.params;
    
    const clients = await clientService.getMultipleClients(emails);
    
    res.status(200).json(clients);
  });

  assignClientToUser = catchAsync(async (req, res) => {
    const { 
      userEmail, 
      clientEmail, 
      dateList, 
      startTimeList, 
      endTimeList, 
      breakList, 
      highIntensityList 
    } = req.body;
    
    // Basic validation
    if (!userEmail || !clientEmail || !dateList) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userEmail, clientEmail, dateList'
      });
    }
    
    const result = await clientService.assignClientToUser(req.body);
    
    res.status(200).json(result);
  });

  getUserAssignments = catchAsync(async (req, res) => {
    const { userEmail } = req.params;
    
    const assignments = await clientService.getUserAssignments(userEmail);
    
    res.status(200).json({
      success: true,
      assignments: assignments
    });
  });
}

module.exports = new ClientController();
