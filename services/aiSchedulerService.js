/**
 * AI Scheduler Service
 * Integrates Google Cloud Vertex AI for intelligent employee recommendations
 * Uses Application Default Credentials (ADC) for authentication
 * 
 * @file backend/services/aiSchedulerService.js
 */

const { VertexAI } = require('@google-cloud/vertexai');
const NodeCache = require('node-cache');
const logger = require('../config/logger');

// Initialize cache with 5-minute TTL
const cache = new NodeCache({ stdTTL: 300 });

// Vertex AI Configuration
const PROJECT_ID = process.env.GCP_PROJECT_ID;
const LOCATION = process.env.GCP_LOCATION || 'us-central1';
const MODEL_NAME = 'gemini-1.5-flash-001';

class AISchedulerService {
    constructor() {
        if (!PROJECT_ID) {
            logger.warn('GCP_PROJECT_ID not found. AI features will run in fallback mode.');
            this.model = null;
        } else {
            try {
                this.vertexAI = new VertexAI({
                    project: PROJECT_ID,
                    location: LOCATION
                });
                this.model = this.vertexAI.getGenerativeModel({ model: MODEL_NAME });
                logger.info(`Vertex AI initialized for project ${PROJECT_ID} in ${LOCATION}`);
            } catch (error) {
                logger.error('Failed to initialize Vertex AI', { error: error.message });
                this.model = null;
            }
        }
    }

    /**
     * Get AI-powered recommendations for a shift
     * 
     * @param {Object} shiftDetails - Shift requirements
     * @param {Array} candidates - List of eligible candidates with their heuristic scores
     * @returns {Promise<Array>} Re-ranked candidates with AI reasoning
     */
    async getAIRecommendations(shiftDetails, candidates) {
        if (!this.model) {
            return this._fallbackRecommendations(candidates);
        }

        const cacheKey = `rec_${JSON.stringify(shiftDetails)}_${candidates.length}`;
        const cachedResult = cache.get(cacheKey);
        if (cachedResult) {
            return cachedResult;
        }

        try {
            // Prepare context for Gemini
            const candidatesContext = candidates.map(c => ({
                id: c.employeeId,
                skills: c.skills,
                heuristicScore: c.matchScore,
                distanceKm: c.distanceKm,
                skillScore: c.skillScore,
                availabilityScore: c.availabilityScore
            })).slice(0, 10); // Limit to top 10 for performance

            const prompt = `
                You are an expert workforce scheduler. Analyze these candidates for a shift.
                
                Shift Details:
                - Time: ${shiftDetails.startTime} to ${shiftDetails.endTime}
                - Required Skills: ${shiftDetails.requiredSkills?.join(', ') || 'None'}
                - Client Location: ${shiftDetails.location ? 'Provided' : 'Not Provided'}

                Candidates (Pre-ranked by heuristic):
                ${JSON.stringify(candidatesContext, null, 2)}

                Task:
                1. Re-rank these candidates based on the best fit. Consider that closer distance is better, high skill match is critical, and high heuristic score is a strong baseline.
                2. Provide a brief, natural language "reasoning" for the top 3 choices (e.g., "Best overall match with 95% skill alignment and close proximity").
                3. Return JSON ONLY. Format:
                [
                    { "employeeId": "...", "aiScore": 95, "reasoning": "..." }
                ]
            `;

            const result = await this.model.generateContent(prompt);
            const response = result.response;
            const text = response.candidates[0].content.parts[0].text;
            
            // Clean markdown if present
            const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const aiResults = JSON.parse(jsonStr);

            // Merge AI results with original candidates
            const enhancedCandidates = candidates.map(c => {
                const aiMatch = aiResults.find(r => r.employeeId === c.employeeId);
                return {
                    ...c,
                    aiScore: aiMatch ? aiMatch.aiScore : c.matchScore, // Fallback to heuristic if AI skipped
                    reasoning: aiMatch ? aiMatch.reasoning : 'Recommended based on availability and skills.'
                };
            });

            // Sort by AI score
            enhancedCandidates.sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0));

            cache.set(cacheKey, enhancedCandidates);
            return enhancedCandidates;

        } catch (error) {
            logger.error('Error in AI recommendations', { error: error.message });
            return this._fallbackRecommendations(candidates);
        }
    }

    /**
     * Fallback method if AI fails or key is missing
     */
    _fallbackRecommendations(candidates) {
        return candidates.map(c => ({
            ...c,
            aiScore: c.matchScore,
            reasoning: `Matched based on ${c.skillScore}% skill alignment and availability.`
        }));
    }

    /**
     * Analyze conflicts and suggest resolutions
     * 
     * @param {Array} conflicts - List of conflicts
     * @returns {Promise<Object>} Suggestions
     */
    async analyzeConflicts(conflicts) {
        if (!this.model || conflicts.length === 0) {
            return { message: 'Please resolve manual conflicts.', strategies: [] };
        }

        try {
            const prompt = `
                Analyze these scheduling conflicts and suggest 2-3 brief resolution strategies.
                Conflicts: ${JSON.stringify(conflicts)}
                
                Return JSON: { "message": "Summary...", "strategies": ["Strategy 1", "Strategy 2"] }
            `;

            const result = await this.model.generateContent(prompt);
            const text = result.response.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(text);

        } catch (error) {
            logger.error('Error in conflict analysis', { error: error.message });
            return { message: 'Multiple conflicts detected.', strategies: ['Manually adjust shift times', 'Choose a different employee'] };
        }
    }
}

module.exports = new AISchedulerService();
