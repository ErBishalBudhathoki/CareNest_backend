/**
 * OCR Parsing Service
 * Extracts structured data (Merchant, Date, Amount, ABN) from raw OCR text
 */

const logger = require('../config/logger');

class OcrService {
    /**
     * Parse raw text from receipt
     * @param {string} rawText - Raw text extracted by on-device OCR
     * @returns {Object} Structured receipt data
     */
    parseReceiptText(rawText) {
        if (!rawText) {
            return {
                merchant: '',
                date: '',
                totalAmount: 0,
                currency: 'AUD',
                abn: '',
                rawText: ''
            };
        }

        const lines = rawText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        const result = {
            merchant: this._extractMerchant(lines),
            date: this._extractDate(rawText),
            totalAmount: this._extractTotalAmount(lines, rawText),
            currency: 'AUD',
            abn: this._extractABN(rawText),
            rawText: rawText
        };

        logger.debug('OCR parsing completed', { 
            merchant: result.merchant, 
            date: result.date, 
            totalAmount: result.totalAmount 
        });

        return result;
    }

    /**
     * Extract merchant name from lines
     * Usually the first non-noise line
     */
    _extractMerchant(lines) {
        const noiseKeywords = [
            'TAX INVOICE', 'ABN', 'PHONE', 'TEL:', 'ADDRESS', 'WELCOME', 
            'RECEIPT', 'INVOICE #', 'ORDER #', 'SERVER:', 'STATION:',
            'YOUR RECEIPT', 'THANK YOU', 'DATE:', 'TIME:'
        ];

        // Heuristic: Check first 3 lines
        for (let i = 0; i < Math.min(lines.length, 5); i++) {
            const line = lines[i].toUpperCase();
            
            // Skip noise lines
            if (noiseKeywords.some(noise => line.includes(noise))) continue;
            
            // Skip lines that are just dates or times
            if (/\d{2}\/\d{2}\/\d{4}/.test(line)) continue;
            if (/\d{2}:\d{2}/.test(line)) continue;
            
            // If we found a candidate, maybe combine with next line if it looks like a continuation (e.g., ASHFIELD)
            let merchant = lines[i];
            if (i + 1 < lines.length) {
                const nextLine = lines[i+1].toUpperCase();
                if (!noiseKeywords.some(noise => nextLine.includes(noise)) && 
                    !/\d/.test(nextLine) && 
                    nextLine.length > 2) {
                    merchant += ' ' + lines[i+1];
                }
            }
            return merchant.trim();
        }

        return 'Unknown Merchant';
    }

    /**
     * Extract date using regex
     */
    _extractDate(rawText) {
        // DD/MM/YYYY or DD-MM-YYYY
        const dateRegex = /(\d{2})[\/\-](\d{2})[\/\-](\d{4})/;
        const match = rawText.match(dateRegex);
        if (match) {
            // Convert to ISO if possible or return as found
            return match[0];
        }

        // YYYY-MM-DD
        const isoRegex = /(\d{4})-(\d{2})-(\d{2})/;
        const isoMatch = rawText.match(isoRegex);
        if (isoMatch) return isoMatch[0];

        return '';
    }

    /**
     * Extract total amount
     */
    _extractTotalAmount(lines, rawText) {
        const totalKeywords = [
            'INVOICE TOTAL', 'TOTAL AUD', 'AMOUNT DUE', 'TOTAL', 
            'SUBTOTAL', 'BALANCE', 'GRAND TOTAL'
        ];

        // Strategy 1: Look for lines containing total keywords and a currency pattern
        for (const line of lines) {
            const upperLine = line.toUpperCase();
            if (totalKeywords.some(k => upperLine.includes(k))) {
                const amountMatch = line.match(/\$?\s?(\d+[\.,]\d{2})/);
                if (amountMatch) {
                    return parseFloat(amountMatch[1].replace(',', '.'));
                }
            }
        }

        // Strategy 2: Handle parallel lists (Labels followed by Values)
        // Find indices of total keywords and amount patterns
        const labelIndices = [];
        const amountEntries = [];

        for (let i = 0; i < lines.length; i++) {
            const upperLine = lines[i].toUpperCase();
            if (totalKeywords.some(k => upperLine.includes(k))) {
                labelIndices.push({ index: i, text: upperLine });
            }
            
            const amountMatch = lines[i].match(/^\$?\s?(-?\d+[\.,]\d{2})$/);
            if (amountMatch) {
                amountEntries.push({ index: i, value: parseFloat(amountMatch[1].replace(',', '.')) });
            }
        }

        if (labelIndices.length > 0 && amountEntries.length > 0) {
            // For each total label, find the most likely corresponding amount
            // If they are in blocks, the N-th label often corresponds to the N-th amount in the next block
            for (const label of labelIndices) {
                // Find how many other labels (like Rounding, GST, etc.) follow this total label
                const secondaryKeywords = ['ROUNDING', 'GST', 'CASH', 'CHANGE', 'PAID'];
                let followers = 0;
                for (let i = label.index + 1; i < lines.length; i++) {
                    const line = lines[i].toUpperCase();
                    if (secondaryKeywords.some(k => line.includes(k))) followers++;
                    else if (lines[i].match(/\$?\s?\d+[\.,]\d{2}/)) break; // Reached amount block
                }

                // If we found followers, the total should be the first amount in the block
                // (assuming the amounts follow the same order as labels)
                // In our specific case: Invoice Total (label) -> Rounding, GST, Paid CASH, Change (4 followers)
                // Then the amounts: $13.76, -$0.01, $0.00, $50.00, $36.25
                // The total is the 1st amount.
                
                // Find the first amount that appears after all labels
                const firstAmountAfterLabels = amountEntries.find(a => a.index > label.index + followers);
                if (firstAmountAfterLabels) return firstAmountAfterLabels.value;
            }
        }

        // Strategy 3: Fallback to largest amount that isn't clearly change/cash
        const filteredAmounts = amountEntries
            .filter(a => {
                const prevLine = a.index > 0 ? lines[a.index - 1].toUpperCase() : '';
                return !prevLine.includes('CASH') && !prevLine.includes('CHANGE') && !prevLine.includes('PAID');
            })
            .map(a => a.value);

        if (filteredAmounts.length > 0) {
            return Math.max(...filteredAmounts);
        }

        return 0;
    }

    /**
     * Extract ABN
     */
    _extractABN(rawText) {
        const abnRegex = /ABN\s?(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})|(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})/;
        const match = rawText.match(abnRegex);
        if (match) {
            return (match[1] || match[2]).replace(/\s/g, '');
        }
        return '';
    }
}

module.exports = new OcrService();
