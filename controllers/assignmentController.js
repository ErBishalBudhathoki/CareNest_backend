const ClientAssignment = require('../models/ClientAssignment');
const User = require('../models/User');
const Client = require('../models/Client');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');
const pricingService = require('../services/pricingService');

class AssignmentController {
    /**
     * Create or Update Assignment
     * POST /api/assignments
     */
    createAssignment = catchAsync(async (req, res) => {
        const { 
            userEmail, 
            clientEmail, 
            dateList, 
            startTimeList, 
            endTimeList, 
            breakList, 
            highIntensityList, 
            ndisItem, 
            customPricing, 
            scheduleWithNdisItems 
        } = req.body;

        // Basic validation
        if (!userEmail || !clientEmail || !dateList || !startTimeList || !endTimeList || !breakList || !highIntensityList) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Validate array lengths
        if (dateList.length !== startTimeList.length || 
            dateList.length !== endTimeList.length ||
            dateList.length !== breakList.length || 
            dateList.length !== highIntensityList.length) {
            return res.status(400).json({
                success: false,
                message: 'Array length mismatch'
            });
        }

        // Verify client
        const clientExists = await Client.findOne({
            clientEmail: clientEmail,
            isActive: true
        });

        if (!clientExists) {
            return res.status(404).json({ success: false, message: 'Client not found or inactive' });
        }

        let organizationId = clientExists.organizationId;
        
        // Fallback organizationId from user if missing on client
        if (!organizationId) {
            const user = await User.findOne({ email: userEmail, isActive: true });
            if (user && user.organizationId) {
                organizationId = user.organizationId;
                // Auto-fix client org ID
                await Client.updateOne({ _id: clientExists._id }, { $set: { organizationId } });
            }
        }

        if (!organizationId) {
             return res.status(400).json({ success: false, message: 'Organization ID could not be determined' });
        }

        // Parse legacy ndisItem if needed
        let parsedNdisItem = ndisItem;
        if (typeof ndisItem === 'string') {
            try { parsedNdisItem = JSON.parse(ndisItem); } catch (e) { }
        }

        // Extract custom pricing from ndisItem (legacy)
        let extractedCustomPricing = customPricing;
        if (parsedNdisItem && parsedNdisItem.customPricing) {
            extractedCustomPricing = parsedNdisItem.customPricing;
            delete parsedNdisItem.customPricing; // Clean up
        }

        // Process schedule
        const scheduleData = dateList.map((date, i) => {
            const entry = {
                date,
                startTime: startTimeList[i],
                endTime: endTimeList[i],
                break: breakList[i],
                highIntensity: highIntensityList[i],
                ndisItem: null
            };

            // Attach NDIS item logic
            if (scheduleWithNdisItems && scheduleWithNdisItems[i] && scheduleWithNdisItems[i].ndisItem) {
                entry.ndisItem = scheduleWithNdisItems[i].ndisItem;
            } else if (parsedNdisItem) {
                entry.ndisItem = parsedNdisItem;
            }

            return entry;
        });

        const assignmentData = {
            userEmail,
            clientEmail,
            clientId: clientExists._id,
            organizationId,
            schedule: scheduleData,
            assignedNdisItemNumber: parsedNdisItem?.itemNumber,
            isActive: true
        };

        // Upsert Assignment
        const existingAssignment = await ClientAssignment.findOne({
            userEmail,
            clientEmail,
            isActive: true
        });

        let finalAssignmentId;

        if (existingAssignment) {
            // Append/Update logic
            const currentSchedule = existingAssignment.schedule || [];
            
            // Merge logic: Update if match, else add
            scheduleData.forEach(newItem => {
                const idx = currentSchedule.findIndex(s => 
                    s.date === newItem.date && 
                    s.startTime === newItem.startTime && 
                    s.endTime === newItem.endTime
                );
                if (idx > -1) {
                    currentSchedule[idx] = newItem;
                } else {
                    currentSchedule.push(newItem);
                }
            });

            await ClientAssignment.updateOne(
                { _id: existingAssignment._id },
                { $set: { schedule: currentSchedule } }
            );
            finalAssignmentId = existingAssignment._id;
        } else {
            const newAssignment = await ClientAssignment.create(assignmentData);
            finalAssignmentId = newAssignment._id;
        }

        // Process Custom Pricing (Async, non-blocking for response but awaited for safety)
        const customPricingPromises = [];
        
        // 1. From scheduleWithNdisItems
        if (scheduleWithNdisItems && Array.isArray(scheduleWithNdisItems)) {
            scheduleWithNdisItems.forEach(item => {
                if (item.ndisItem && item.customPricing && item.customPricing.isCustom) {
                    customPricingPromises.push(pricingService.processCustomPricing(
                        item.customPricing,
                        item.ndisItem,
                        organizationId,
                        clientExists,
                        userEmail
                    ));
                }
            });
        }

        // 2. From legacy global custom pricing
        if (extractedCustomPricing && extractedCustomPricing.isCustom && parsedNdisItem) {
             customPricingPromises.push(pricingService.processCustomPricing(
                extractedCustomPricing,
                parsedNdisItem,
                organizationId,
                clientExists,
                userEmail
            ));
        }

        await Promise.all(customPricingPromises);

        res.status(200).json({
            success: true,
            message: existingAssignment ? 'Assignment updated' : 'Assignment created',
            assignmentId: finalAssignmentId
        });
    });

    /**
     * Get assignments for an organization
     * GET /api/assignments?organizationId=...
     */
    getOrganizationAssignments = catchAsync(async (req, res) => {
        const { organizationId } = req.query; // Changed from params to query to match frontend call

        if (!organizationId) {
            return res.status(400).json({ success: false, message: 'Organization ID is required' });
        }

        // logger.info(`Getting assignments for organization: ${organizationId}`);

        const assignments = await ClientAssignment.aggregate([
            {
                $match: {
                    organizationId: organizationId,
                    isActive: true
                }
            },
            {
                $lookup: {
                    from: "clients",
                    localField: "clientEmail",
                    foreignField: "clientEmail",
                    as: "clientDetails"
                }
            },
            {
                $unwind: "$clientDetails"
            },
            {
                $lookup: {
                    from: "login",
                    localField: "userEmail",
                    foreignField: "email",
                    as: "userDetails"
                }
            },
            {
                $unwind: {
                    path: "$userDetails",
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $project: {
                    _id: 1,
                    userEmail: 1,
                    clientEmail: 1,
                    organizationId: 1,
                    schedule: 1,
                    createdAt: 1,
                    isActive: 1,
                    // Legacy format for compatibility with Frontend
                    dateList: {
                        $map: {
                            input: "$schedule",
                            as: "item",
                            in: "$item.date"
                        }
                    },
                    startTimeList: {
                        $map: {
                            input: "$schedule",
                            as: "item",
                            in: "$item.startTime"
                        }
                    },
                    endTimeList: {
                        $map: {
                            input: "$schedule",
                            as: "item",
                            in: "$item.endTime"
                        }
                    },
                    breakList: {
                        $map: {
                            input: "$schedule",
                            as: "item",
                            in: "$item.break"
                        }
                    },
                    clientDetails: 1,
                    userDetails: {
                         firstName: 1,
                         lastName: 1,
                         email: 1,
                         profileImage: 1,
                         photoData: 1,
                         filename: 1
                    }
                }
            },
            {
                $sort: {
                    createdAt: -1
                }
            }
        ]);

        // Transform _id to id to match Mongoose toJSON behavior manually for aggregation results
        const transformedAssignments = assignments.map(a => ({
            ...a,
            id: a._id.toString()
        }));

        res.status(200).json({
            success: true,
            assignments: transformedAssignments
        });
    });

    /**
     * Delete assignment
     * DELETE /api/assignments/:id
     */
    deleteAssignment = catchAsync(async (req, res) => {
        const { id } = req.params;
        const assignment = await ClientAssignment.findByIdAndUpdate(id, { isActive: false }, { new: true });
        if (!assignment) {
            return res.status(404).json({ success: false, message: 'Assignment not found' });
        }
        res.json({ success: true, data: assignment });
    });
}

module.exports = new AssignmentController();
