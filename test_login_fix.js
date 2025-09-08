const { MongoClient } = require('mongodb');
const { verifyPassword } = require('./utils/cryptoHelpers');

const uri = process.env.MONGODB_URI || 'mongodb+srv://bishalkc331:REDACTED_MONGODB_PASSWORD_2@morethaninvoicecluster.xptftb5.mongodb.net/?retryWrites=true&w=majority&appName=morethaninvoiceCluster&tls=true&tlsAllowInvalidCertificates=false';

async function testLogin() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    const db = client.db('Invoice');
    const usersCollection = db.collection('login');
    
    // Find the test user
    const user = await usersCollection.findOne({ email: 'test@tester.com' });
    
    if (!user) {
      console.log('User not found');
      return;
    }
    
    console.log('User found:', {
      email: user.email,
      hasPassword: !!user.password,
      passwordLength: user.password?.length
    });
    
    // Test common passwords
    const testPasswords = ['111111', 'test', 'password', 'test@tester.com', 'tester', '123456'];
    
    for (const testPassword of testPasswords) {
      try {
        const isValid = await verifyPassword(testPassword, user.password);
        console.log(`Password '${testPassword}': ${isValid ? 'VALID' : 'INVALID'}`);
        
        if (isValid) {
          console.log('✅ LOGIN SUCCESS! Password found:', testPassword);
          break;
        }
      } catch (error) {
        console.log(`Password '${testPassword}': ERROR -`, error.message);
      }
    }
    
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await client.close();
  }
}

testLogin();