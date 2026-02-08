// Mock firebase-admin-config for tests
module.exports = {
  admin: {
    messaging: () => ({
      send: jest.fn().mockResolvedValue({}),
      sendEachForMulticast: jest.fn().mockResolvedValue({ successCount: 1, failureCount: 0 })
    })
  },
  messaging: {
    send: jest.fn().mockResolvedValue({}),
    sendEachForMulticast: jest.fn().mockResolvedValue({ successCount: 1, failureCount: 0 })
  }
};
