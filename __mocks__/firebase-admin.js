const mockMessaging = {
  send: jest.fn().mockResolvedValue('msg-id'),
  sendEachForMulticast: jest.fn().mockResolvedValue({ successCount: 1, failureCount: 0 }),
};

module.exports = {
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn().mockReturnValue('mock-cert'),
  },
  auth: () => ({
    verifyIdToken: jest.fn().mockResolvedValue({ uid: 'test-uid' }),
  }),
  messaging: () => mockMessaging,
};
