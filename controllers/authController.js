const authService = require('../services/authService');
const nodemailer = require('nodemailer');
const logger = require('../config/logger');
const { securityMonitor } = require('../utils/securityMonitor');
const catchAsync = require('../utils/catchAsync');

class AuthController {
  /**
   * Check if email exists in the system
   */
  checkEmail = catchAsync(async (req, res) => {
    const email = req.params.email;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const user = await authService.checkEmailExists(email);
    
    if (user) {
      res.json({ exists: true, user: { email: user.email, role: user.role } });
    } else {
      res.json({ exists: false });
    }
  });

  /**
   * Get client details by email
   */
  getClientDetails = catchAsync(async (req, res) => {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const client = await authService.getClientDetails(email);
    
    if (client) {
      res.json({ exists: true, client });
    } else {
      res.json({ exists: false });
    }
  });

  /**
   * User registration
   */
  signup = catchAsync(async (req, res) => {
    const { email } = req.params;
    const { firstName, lastName, password, organizationCode, organizationId, role } = req.body;
    
    // Validate required fields
    if (!email || !firstName || !lastName || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if email already exists
    const existingUser = await authService.checkEmailExists(email);
    if (existingUser) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    
    // Validate organization
    let organization = null;
    if (organizationCode) {
      organization = await authService.validateOrganizationCode(organizationCode);
      if (!organization) {
        return res.status(400).json({ error: 'Invalid organization code' });
      }
    } else if (organizationId) {
      organization = await authService.validateOrganizationId(organizationId);
      if (!organization) {
        return res.status(400).json({ error: 'Invalid organization ID' });
      }
    } else {
      return res.status(400).json({ error: 'Organization code or ID is required' });
    }
    
    // Create user
    const userData = {
      email,
      firstName,
      lastName,
      password,
      organizationCode: organization.organizationCode,
      organizationId: organization._id.toString(),
      role: role || 'user'
    };
    
    const newUser = await authService.createUser(userData);
    
    logger.business('User Registered', {
      event: 'user_registered',
      email: newUser.email,
      organizationId: newUser.organizationId,
      timestamp: new Date().toISOString()
    });
    
    res.status(201).json({
      message: 'User created successfully',
      user: {
        _id: newUser._id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        role: newUser.role,
        organizationId: newUser.organizationId
      }
    });
  });

  /**
   * User login
   */
  login = catchAsync(async (req, res) => {
    const { email, password } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    if (!email || !password) {
      // Record suspicious activity for missing credentials
      securityMonitor.recordSuspiciousActivity({
        type: 'INCOMPLETE_LOGIN_ATTEMPT',
        ip: clientIP,
        details: { missingFields: !email ? 'email' : 'password' },
        severity: 'low'
      });
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Check if IP is blocked
    if (securityMonitor.isIPBlocked(clientIP)) {
      securityMonitor.recordSuspiciousActivity({
        type: 'BLOCKED_IP_ACCESS_ATTEMPT',
        ip: clientIP,
        details: { email, userAgent },
        severity: 'high'
      });
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const authResult = await authService.authenticateUser(email, password);
    
    // Record successful login
    securityMonitor.recordSuccessfulLogin({
      ip: clientIP,
      email,
      userAgent,
      userId: authResult.user._id
    });
    
    logger.business('User Login', {
      event: 'user_login',
      email: authResult.user.email,
      userId: authResult.user._id,
      ip: clientIP,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      message: 'Login successful',
      user: authResult.user,
      organization: authResult.organization
    });
  });

  /**
   * Get user photo (Supports R2 and Legacy)
   */
  getUserPhoto = catchAsync(async (req, res) => {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const photoResult = await authService.getUserPhoto(email);
    
    if (!photoResult) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    if (photoResult.type === 'url') {
      // Return JSON with URL for R2/Cloudflare
      return res.json({ 
        success: true, 
        photoUrl: photoResult.url 
      });
    } else if (photoResult.type === 'buffer') {
      // Return JSON with Base64 for Legacy Buffer (Frontend expects JSON)
      const base64Data = photoResult.data.toString('base64');
      return res.json({
        success: true,
        data: base64Data,
        contentType: photoResult.contentType
      });
    } else {
      return res.status(500).json({ error: 'Unknown photo type' });
    }
  });

  /**
   * Upload user photo (R2 Only)
   */
  uploadPhoto = catchAsync(async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No photo file provided' });
    }

    // Get URL from multer-s3 (R2) or fallback to file path (Disk)
    let photoUrl;
    if (req.file.location) {
      photoUrl = req.file.location; // R2/S3 URL
    } else if (req.file.path) {
      // Local development fallback
      photoUrl = req.file.path; 
    } else {
      return res.status(500).json({ error: 'File upload failed: No location returned' });
    }
    
    await authService.uploadUserPhoto(email, photoUrl, req.file.mimetype);
    
    logger.business('User Photo Uploaded', {
      event: 'user_photo_uploaded',
      email,
      photoUrl,
      timestamp: new Date().toISOString()
    });
    
    res.json({ 
      message: 'Photo uploaded successfully',
      photoUrl: photoUrl 
    });
  });

  /**
   * Get user password salt
   */
  getSalt = catchAsync(async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const salt = await authService.getUserSalt(email);
    
    res.json({ salt });
  });

  /**
   * Send OTP for password reset
   */
  sendOTP = catchAsync(async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const otp = await authService.generateOTP(email);
    
    // Configure email transporter (you may want to move this to a config file)
    const transporter = nodemailer.createTransport({
      service: 'gmail', // or your email service
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    
    // Send OTP email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset OTP',
      html: `
        <h2>Password Reset Request</h2>
        <p>Your OTP for password reset is: <strong>${otp}</strong></p>
        <p>This OTP will expire in 10 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `
    };
    
    await transporter.sendMail(mailOptions);
    
    logger.business('OTP Sent', {
      event: 'otp_sent',
      email,
      timestamp: new Date().toISOString()
    });
    
    res.json({ message: 'OTP sent successfully' });
  });

  /**
   * Verify OTP
   */
  verifyOTP = catchAsync(async (req, res) => {
    const { email, otp } = req.body;
    
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }
    
    const isValid = await authService.verifyOTP(email, otp);
    
    if (isValid) {
      res.json({ message: 'OTP verified successfully', valid: true });
    } else {
      res.status(400).json({ error: 'Invalid OTP', valid: false });
    }
  });

  /**
   * Update user password
   */
  updatePassword = catchAsync(async (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!otp) {
      return res.status(400).json({ error: 'OTP is required' });
    }

    // Verify OTP first (allow already used if verified recently in same flow)
    try {
      await authService.verifyOTP(email, otp, { allowAlreadyUsed: true });
    } catch (error) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const result = await authService.updatePassword(email, newPassword);
    
    logger.business('Password Updated', {
      event: 'password_updated',
      email: email,
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json(result);
  });

  /**
   * Get user init data
   */
  getInitData = catchAsync(async (req, res) => {
    const { email } = req.params;
    
    const result = await authService.getInitData(email);
    
    res.status(200).json(result);
  });
}

module.exports = new AuthController();
