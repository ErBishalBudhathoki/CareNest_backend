const EventBus = require('../../core/EventBus');

jest.mock('../../config/redis', () => {
  const Redis = require('ioredis-mock');
  const client = new Redis();
  client.isConfigured = true;
  client.status = 'ready';
  return client;
});
jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('EventBus', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should publish and subscribe locally', (done) => {
    const eventName = 'test.event';
    const payload = { data: 'test' };

    EventBus.subscribe(eventName, (data) => {
      expect(data).toEqual(payload);
      done();
    });

    EventBus.publish(eventName, payload);
  });

  test('should support distributed publishing (mocked)', (done) => {
    const eventName = 'test.distributed';
    const payload = { data: 'distributed' };
    
    EventBus.subscribe(eventName, (data, metadata) => {
      // Ignore remote echo (since we are both publisher and subscriber in this test)
      if (metadata && metadata.remote) return;

      try {
        expect(data).toEqual(payload);
        expect(metadata).toEqual(expect.objectContaining({ source: 'local' }));
        done();
      } catch (error) {
        done(error);
      }
    });
    
    EventBus.publish(eventName, payload);
  });
});
