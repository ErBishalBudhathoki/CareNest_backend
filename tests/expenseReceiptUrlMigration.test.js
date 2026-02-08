const {
  isIPv4Literal,
  isLikelyLocalHost,
  rewriteUrlOrPath,
  rewriteReceiptFields,
} = require('../migration_scripts/migrate_expense_receipt_urls');

describe('expense receipt URL migration', () => {
  test('detects local hosts', () => {
    expect(isLikelyLocalHost('localhost')).toBe(true);
    expect(isLikelyLocalHost('127.0.0.1')).toBe(true);
    expect(isLikelyLocalHost('10.0.2.2')).toBe(true);
    expect(isLikelyLocalHost('192.168.0.5')).toBe(true);
    expect(isLikelyLocalHost('172.16.0.1')).toBe(true);
    expect(isLikelyLocalHost('172.32.0.1')).toBe(false);
    expect(isLikelyLocalHost('192.170.30.7')).toBe(true);
    expect(isLikelyLocalHost('8.8.8.8')).toBe(false);
    expect(isLikelyLocalHost('example.com')).toBe(false);
  });

  test('detects IPv4 literal', () => {
    expect(isIPv4Literal('192.170.30.7')).toBe(true);
    expect(isIPv4Literal('8.8.8.8')).toBe(true);
    expect(isIPv4Literal('api.example.com')).toBe(false);
  });

  test('rewrites local absolute URLs to new base origin', () => {
    const { value, changed } = rewriteUrlOrPath(
      'http://192.168.1.10:8080/uploads/receipt.png',
      'https://api.example.com/'
    );
    expect(changed).toBe(true);
    expect(value).toBe('https://api.example.com/uploads/receipt.png');
  });

  test('resolves /uploads paths against new base', () => {
    const { value, changed } = rewriteUrlOrPath(
      '/uploads/receipt.png',
      'https://api.example.com/'
    );
    expect(changed).toBe(true);
    expect(value).toBe('https://api.example.com/uploads/receipt.png');
  });

  test('does not rewrite non-local absolute URLs', () => {
    const input = 'https://cdn.example.com/uploads/receipt.png';
    const { value, changed } = rewriteUrlOrPath(input, 'https://api.example.com/');
    expect(changed).toBe(false);
    expect(value).toBe(input);
  });

  test('cleans backticks in URLs', () => {
    const { value } = rewriteUrlOrPath(
      '`/uploads/receipt.png`',
      'https://api.example.com/'
    );
    expect(value).toBe('https://api.example.com/uploads/receipt.png');
  });

  test('rewrites receipt fields in an expense document', () => {
    const doc = {
      receiptUrl: 'http://10.0.2.2:8080/uploads/a.png',
      receiptFiles: [
        'http://127.0.0.1:8080/uploads/b.pdf',
        'https://cdn.example.com/uploads/c.pdf',
      ],
      receiptPhotos: ['/uploads/d.jpg'],
    };

    const { update, changedCount } = rewriteReceiptFields(doc, 'https://api.example.com/');
    expect(changedCount).toBe(3);
    expect(update.receiptUrl).toBe('https://api.example.com/uploads/a.png');
    expect(update.receiptFiles).toEqual([
      'https://api.example.com/uploads/b.pdf',
      'https://cdn.example.com/uploads/c.pdf',
    ]);
    expect(update.receiptPhotos).toEqual(['https://api.example.com/uploads/d.jpg']);
  });
});
