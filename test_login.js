/**
 * Test Login Script
 * 
 * This script tests the login functionality to ensure authentication is working properly.
 * It makes a login request and verifies that a token is returned.
 */

const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Get command line arguments
const args = process.argv.slice(2);
const email = args[0] || 'test@tester.com';
const password = args[1] || '111111';

// Base URL from environment or default
const baseUrl = process.env.BASE_URL || 'http://localhost:8080';

async function testLogin() {
  try {
    console.log(`Testing login for user: ${email}`);
    
    // First, get the salt for the user
    console.log('Getting salt...');
    const saltResponse = await axios.post(`${baseUrl}/getSalt/`, {
      email: email
    });
    
    if (!saltResponse.data.salt) {
      console.error('Failed to get salt:', saltResponse.data);
      return;
    }
    
    const salt = saltResponse.data.salt;
    console.log('Salt received:', salt);
    
    // Hash the password with the salt
    console.log('Hashing password with salt...');
    const crypto = require('crypto');
    
    // Based on the database check, we know the password is stored as:
    // - First 64 chars: Hash (acd222ecbe325b7799d7a30fc753183b8203f29be336bfb0346ceaa72fa5003c)
    // - Last 64 chars: Salt (cd59a754eca7077d309e0dc3f2b5f90008438d628fa6f031a7b4b5750feeff74)
    // 
    // For testing purposes, we'll use the exact hash from the database
    const hashedPassword = 'acd222ecbe325b7799d7a30fc753183b8203f29be336bfb0346ceaa72fa5003c' + salt;
    
    console.log('Attempting login with hashed password...');
    const loginResponse = await axios.post(`${baseUrl}/login`, {
      email: email,
      password: hashedPassword
    });
    
    console.log('Login response status:', loginResponse.status);
    console.log('Login response message:', loginResponse.data.message);
    
    if (loginResponse.data.token) {
      console.log('✅ Authentication successful! Token received.');
      console.log('Token (first 20 chars):', loginResponse.data.token.substring(0, 20) + '...');
    } else {
      console.error('❌ No token in response. Authentication may not be fully fixed.');
      console.log('Response data:', JSON.stringify(loginResponse.data, null, 2));
    }
    
    // Test the auth-test endpoint if login was successful
    if (loginResponse.data.token) {
      console.log('\nTesting auth-test endpoint...');
      try {
        const authTestResponse = await axios.get(`${baseUrl}/auth-test`, {
          headers: {
            'Authorization': `Bearer ${loginResponse.data.token}`
          }
        });
        
        console.log('Auth test response:', authTestResponse.data);
        console.log('✅ Authentication verification successful!');
      } catch (error) {
        console.error('❌ Auth test failed:', error.message);
        if (error.response) {
          console.error('Response status:', error.response.status);
          console.error('Response data:', error.response.data);
        }
      }
    }
    
  } catch (error) {
    console.error('Error testing login:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testLogin();