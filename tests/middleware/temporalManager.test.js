/**
 * TemporalManager task-queue alignment: every starter must land on the
 * env-aware queue workers actually poll — never the bare 'default' queue.
 */
const TemporalManager = require('../../core/TemporalManager');

describe('TemporalManager.getTaskQueue', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('resolves dev queue by default', () => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.NODE_ENV;
    expect(TemporalManager.getTaskQueue()).toBe('default-dev');
  });

  test('resolves prod queue for production env', () => {
    process.env.NODE_ENV = 'production';
    expect(TemporalManager.getTaskQueue()).toBe('default-prod');
  });

  test('resolves prod queue for prod project id', () => {
    process.env.FIREBASE_PROJECT_ID = 'carenest-prods';
    expect(TemporalManager.getTaskQueue()).toBe('default-prod');
  });
});

describe('TemporalManager.startWorkflow defaults', () => {
  test('uses the env-aware queue when none is given', async () => {
    const started = {};
    const fakeClient = {
      workflow: {
        start: jest.fn(async (name, opts) => {
          Object.assign(started, { name, ...opts });
          return { workflowId: opts.workflowId };
        }),
      },
    };
    // Inject the fake client by stubbing getClient on the class.
    const spy = jest
      .spyOn(TemporalManager, 'getClient')
      .mockResolvedValue(fakeClient);
    try {
      delete process.env.FIREBASE_PROJECT_ID;
      delete process.env.NODE_ENV;
      await TemporalManager.startWorkflow('SomeWorkflow', {
        workflowId: 'wf-1',
        args: [{ a: 1 }],
      });
      expect(started.taskQueue).toBe('default-dev');
      expect(started.workflowId).toBe('wf-1');
      expect(started.args).toEqual([{ a: 1 }]);

      await TemporalManager.startWorkflow('SomeWorkflow', {
        workflowId: 'wf-2',
        taskQueue: 'custom-queue',
        args: [],
      });
      expect(started.taskQueue).toBe('custom-queue');
    } finally {
      spy.mockRestore();
    }
  });
});
