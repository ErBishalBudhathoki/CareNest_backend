/**
 * Predictive Service
 * Generates forecasts based on historical data
 * 
 * @file backend/services/predictiveService.js
 */

const Invoice = require('../models/Invoice');

class PredictiveService {
    /**
     * Forecast revenue for the next 3 months
     * Uses simple linear regression on past 6 months
     */
    async forecastRevenue(organizationId) {
        try {
            const today = new Date();
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(today.getMonth() - 6);

            // Get monthly revenue for past 6 months
            const monthlyRevenue = await Invoice.aggregate([
                {
                    $match: {
                        organizationId: organizationId,
                        status: 'paid',
                        issueDate: { $gte: sixMonthsAgo }
                    }
                },
                {
                    $group: {
                        _id: { 
                            year: { $year: "$issueDate" }, 
                            month: { $month: "$issueDate" } 
                        },
                        revenue: { $sum: "$totalAmount" }
                    }
                },
                { $sort: { "_id.year": 1, "_id.month": 1 } }
            ]);

            if (monthlyRevenue.length < 2) {
                return { forecast: [], trend: 'insufficient_data' };
            }

            // Simple Linear Regression (y = mx + c)
            // x = month index (0, 1, 2...), y = revenue
            let n = monthlyRevenue.length;
            let sumX = 0;
            let sumY = 0;
            let sumXY = 0;
            let sumXX = 0;

            monthlyRevenue.forEach((d, index) => {
                const y = d.revenue;
                const x = index;
                sumX += x;
                sumY += y;
                sumXY += x * y;
                sumXX += x * x;
            });

            const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
            const intercept = (sumY - slope * sumX) / n;

            // Forecast next 3 months
            const forecast = [];
            const lastDate = new Date();
            
            for (let i = 1; i <= 3; i++) {
                const nextX = n - 1 + i;
                const predictedRevenue = slope * nextX + intercept;
                
                const futureDate = new Date();
                futureDate.setMonth(lastDate.getMonth() + i);
                
                forecast.push({
                    month: futureDate.toLocaleString('default', { month: 'long', year: 'numeric' }),
                    revenue: Math.max(0, predictedRevenue) // No negative revenue
                });
            }

            return {
                forecast,
                trend: slope > 0 ? 'up' : 'down',
                growthRate: slope / (sumY / n) // Normalized slope
            };

        } catch (error) {
            throw error;
        }
    }
}

module.exports = new PredictiveService();
