import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  STORAGE_ENDPOINT: 'http://minio:9000',
  STORAGE_REGION: 'us-east-1',
  STORAGE_ACCESS_KEY: 'minioadmin',
  STORAGE_SECRET_KEY: 'minioadmin',
  STORAGE_BUCKET: 'streamtube-media',
  REDIS_HOST: 'redis',
  REDIS_PORT: '6379',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema storage and queue', () => {
  it.each([
    ['STORAGE_ENDPOINT', ''],
    ['STORAGE_BUCKET', ''],
    ['REDIS_HOST', ''],
  ])('should reject a missing %s', (key, value) => {
    const { error } = validate({ [key]: value });

    expect(error).toBeDefined();
    expect(error!.message).toContain(key);
  });

  it.each([
    ['STORAGE_ENDPOINT', 'not-a-url'],
    ['REDIS_PORT', '0'],
  ])('should reject an invalid %s', (key, value) => {
    const { error } = validate({ [key]: value });

    expect(error).toBeDefined();
    expect(error!.message).toContain(key);
  });

  it('should accept the complete local storage and queue configuration', () => {
    const { error, value } = validate({});

    expect(error).toBeUndefined();
    expect(value.STORAGE_ENDPOINT).toBe('http://minio:9000');
    expect(value.STORAGE_BUCKET).toBe('streamtube-media');
    expect(value.REDIS_HOST).toBe('redis');
    expect(value.REDIS_PORT).toBe(6379);
  });
});
