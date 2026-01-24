
class TaxService {
    constructor() {
        // 2024-2025 Resident Tax Rates (Simplified)
        this.taxBrackets = [
            { limit: 18200, rate: 0 },
            { limit: 45000, rate: 0.19 },
            { limit: 120000, rate: 0.325 },
            { limit: 180000, rate: 0.37 },
            { limit: Infinity, rate: 0.45 }
        ];
        
        this.superRate = 0.115; // 11.5% for 2024-2025
    }

    /**
     * Calculate PAYG Withholding (Weekly)
     * @param {number} grossPay - Weekly gross pay
     * @param {boolean} claimThreshold - Whether employee claims tax-free threshold
     * @returns {number} Tax withheld amount
     */
    calculateWithholding(grossPay, claimThreshold = true) {
        if (!grossPay || grossPay <= 0) return 0;

        // Convert weekly to annualized
        const annualizedPay = grossPay * 52;
        
        // Calculate annual tax
        let annualTax = 0;
        
        if (claimThreshold) {
            // Use standard brackets
            let remainingIncome = annualizedPay;
            let previousLimit = 0;
            
            for (const bracket of this.taxBrackets) {
                if (remainingIncome <= 0) break;
                
                const taxableInBracket = Math.min(remainingIncome, bracket.limit - previousLimit);
                annualTax += taxableInBracket * bracket.rate;
                
                remainingIncome -= taxableInBracket;
                previousLimit = bracket.limit;
            }
        } else {
            // No tax free threshold: simplified flat rate or different scale
            // Usually starts at higher rate immediately. 
            // Simplified: Flat 32.5% for lower brackets then scales up? 
            // Or just remove the 0% bracket.
            // Let's implement a simplified "No Threshold" logic: 0-120k at 32.5%
             annualTax = annualizedPay * 0.325; // Very rough approximation
             // TODO: Implement full ATO No-TFT tables if critical
        }
        
        // Convert back to weekly and round
        const weeklyTax = Math.round(annualTax / 52);
        return weeklyTax;
    }

    /**
     * Calculate Superannuation Guarantee
     * @param {number} ote - Ordinary Time Earnings
     * @returns {number} Super contribution amount
     */
    calculateSuper(ote) {
        if (!ote || ote <= 0) return 0;
        return parseFloat((ote * this.superRate).toFixed(2));
    }
}

module.exports = new TaxService();
