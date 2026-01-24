const { MongoClient, ObjectId } = require('mongodb');
const axios = require('axios');

async function runTest() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/invoice-app';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();
    console.log('Connected to DB');

    // 1. Create a dummy client
    const clientEmail = `test.client.${Date.now()}@example.com`;
    const clientId = new ObjectId();
    
    await db.collection('clients').insertOne({
      _id: clientId,
      clientEmail: clientEmail,
      clientFirstName: 'Test',
      clientLastName: 'Client',
      organizationId: 'ORG123'
    });
    console.log('Created dummy client:', clientEmail);

    // 2. Activate Account (Set Password)
    const baseUrl = 'http://localhost:5000/api/client-portal';
    try {
        const activateRes = await axios.post(`${baseUrl}/auth/activate`, {
            email: clientEmail,
            password: 'password123'
        });
        console.log('Activation Success:', activateRes.data.success);
    } catch (e) {
        console.error('Activation Failed:', e.response?.data || e.message);
        return;
    }

    // 3. Login
    let token;
    try {
        const loginRes = await axios.post(`${baseUrl}/auth/login`, {
            email: clientEmail,
            password: 'password123'
        });
        console.log('Login Success:', loginRes.data.success);
        token = loginRes.data.token;
    } catch (e) {
        console.error('Login Failed:', e.response?.data || e.message);
        return;
    }

    // 4. Create dummy invoice
    const invoiceId = new ObjectId();
    await db.collection('invoices').insertOne({
        _id: invoiceId,
        clientId: clientId.toString(), // String or ObjectId? Service uses string for match usually
        clientEmail: clientEmail,
        invoiceNumber: 'INV-TEST-001',
        organizationId: 'ORG123',
        financialSummary: { totalAmount: 100, dueDate: '2023-12-31' },
        workflow: { status: 'pending_approval' },
        payment: { status: 'pending' },
        lineItems: [{ description: 'Test Item', quantity: 1, unitPrice: 100, total: 100 }],
        deletion: { isDeleted: false },
        createdAt: new Date()
    });
    console.log('Created dummy invoice');

    // 5. Get Invoices
    try {
        const invoicesRes = await axios.get(`${baseUrl}/invoices`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Get Invoices Success:', invoicesRes.data.data.invoices.length === 1);
    } catch (e) {
        console.error('Get Invoices Failed:', e.response?.data || e.message);
    }

    // 6. Approve Invoice
    try {
        const approveRes = await axios.post(`${baseUrl}/invoices/${invoiceId}/approve`, {}, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Approve Invoice Success:', approveRes.data.success);
    } catch (e) {
        console.error('Approve Invoice Failed:', e.response?.data || e.message);
    }

    // Cleanup
    await db.collection('clients').deleteOne({ _id: clientId });
    await db.collection('login').deleteOne({ email: clientEmail });
    await db.collection('invoices').deleteOne({ _id: invoiceId });
    console.log('Cleanup Done');

  } catch (error) {
    console.error('Test Error:', error);
  } finally {
    await client.close();
  }
}

runTest();
