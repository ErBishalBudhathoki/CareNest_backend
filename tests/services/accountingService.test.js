const accountingService = require('../../services/accountingService');

describe('AccountingService', () => {
    describe('initiateConnection', () => {
        test('should return Xero auth URL', async () => {
            const result = await accountingService.initiateConnection('xero', 'org123');
            expect(result.url).toContain('login.xero.com');
            expect(result.status).toBe('pending');
        });

        test('should return MYOB auth URL', async () => {
            const result = await accountingService.initiateConnection('myob', 'org123');
            expect(result.url).toContain('secure.myob.com');
        });

        test('should throw error for unsupported provider', async () => {
            await expect(accountingService.initiateConnection('unknown', 'org123'))
                .rejects.toThrow('Unsupported provider');
        });
    });

    describe('syncInvoices', () => {
        test('should return sync stats', async () => {
            const invoiceIds = ['inv1', 'inv2'];
            const result = await accountingService.syncInvoices('org123', invoiceIds);
            expect(result.synced).toBe(2);
            expect(result.failed).toBe(0);
        });
    });
});
