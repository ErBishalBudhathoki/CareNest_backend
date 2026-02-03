require('dotenv').config();
const nodemailer = require('nodemailer');

async function verifySmtp() {
    console.log('Testing SMTP Configuration...');
    console.log('User:', process.env.SMTP_ADMIN_EMAIL);
    // Hide password in logs
    console.log('Pass:', process.env.SMTP_PASSWORD ? '****' + process.env.SMTP_PASSWORD.slice(-3) : 'Missing');

    const transporter = nodemailer.createTransport({
        host: "mail.smtp2go.com",
        port: 587,
        auth: {
            user: process.env.SMTP_ADMIN_EMAIL,
            pass: process.env.SMTP_PASSWORD,
        },
    });

    try {
        console.log('Verifying connection...');
        await transporter.verify();
        console.log('✅ SMTP Connection Successful!');

        // Optional: Send a test email
        /*
        const info = await transporter.sendMail({
            from: `"Test" <${process.env.SMTP_ADMIN_EMAIL}>`,
            to: process.env.ADMIN_EMAIL,
            subject: "SMTP Verification Test",
            text: "If you see this, SMTP is working!",
        });
        console.log('Test email sent:', info.messageId);
        */

    } catch (error) {
        console.error('❌ SMTP Connection Failed:', error);
        if (error.responseCode === 535) {
            console.error('Possible Causes:\n1. Invalid Username/Password\n2. Account blocked\n3. 2FA enabled (unlikely for SMTP2GO)');
        }
        process.exit(1);
    }
}

verifySmtp();
