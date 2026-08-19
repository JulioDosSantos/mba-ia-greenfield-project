import * as Joi from 'joi';
import {
  DEFAULT_MULTIPART_PART_SIZE_BYTES,
  DEFAULT_VIDEO_MIME_TYPES,
} from './storage.config';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CONFIRMATION_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  PASSWORD_RESET_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  MAIL_HOST: Joi.string().default('mailpit'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_FROM: Joi.string().default('"StreamTube" <noreply@streamtube.com>'),
  STORAGE_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  STORAGE_REGION: Joi.string().required(),
  STORAGE_ACCESS_KEY: Joi.string().required(),
  STORAGE_SECRET_KEY: Joi.string().required(),
  STORAGE_BUCKET: Joi.string().required(),
  STORAGE_ALLOWED_VIDEO_MIME_TYPES: Joi.string()
    .pattern(/[^\s,]/)
    .default(DEFAULT_VIDEO_MIME_TYPES.join(',')),
  STORAGE_MULTIPART_URL_EXPIRATION_SECONDS: Joi.number()
    .integer()
    .positive()
    .default(900),
  STORAGE_MULTIPART_PART_SIZE_BYTES: Joi.number()
    .integer()
    .min(DEFAULT_MULTIPART_PART_SIZE_BYTES)
    .default(DEFAULT_MULTIPART_PART_SIZE_BYTES),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().integer().min(1).max(65535).required(),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),
});
