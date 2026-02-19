const fs = require('fs');
const os = require('os');
const path = require('path');

describe('SecretLoader', () => {
  test('loads development secrets from LOCAL_SECRETS_FILE when not in Cloud Run', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-loader-'));
    const secretsPath = path.join(tmpDir, 'secrets.json');

    fs.writeFileSync(
      secretsPath,
      JSON.stringify(
        {
          development: {
            TEST_KEY: 'test-value'
          }
        },
        null,
        2
      )
    );

    jest.resetModules();
    delete process.env.K_SERVICE;
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_SECRETS_FILE = secretsPath;
    delete process.env.TEST_KEY;

    const { SecretLoader } = require('../../config/secretLoader');

    const loader = new SecretLoader();
    await loader.load();

    expect(process.env.TEST_KEY).toBe('test-value');
    expect(loader.get('TEST_KEY')).toBe('test-value');
  });
});

