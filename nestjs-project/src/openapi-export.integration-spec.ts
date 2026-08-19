import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportSpec } from './openapi-export';

type OpenApiSchema = Record<string, unknown>;
type OpenApiResponse = {
  content?: Record<string, { schema?: OpenApiSchema }>;
  headers?: Record<string, unknown>;
};
type OpenApiOperation = {
  responses: Record<string, OpenApiResponse>;
  security?: Array<Record<string, unknown>>;
  summary?: string;
};
type OpenApiPaths = Record<string, Record<string, OpenApiOperation>>;

const API_ERROR_ENVELOPE_REF = '#/components/schemas/ApiErrorEnvelope';

function expectApiErrorEnvelope(
  operation: OpenApiOperation,
  status: string,
): void {
  const response = operation.responses[status];
  expect(response).toBeDefined();
  expect(response.content?.['application/json']?.schema).toEqual({
    $ref: API_ERROR_ENVELOPE_REF,
  });
}

function expectProtected(operation: OpenApiOperation): void {
  expect(operation.security).toBeDefined();
  expect(
    operation.security?.some((requirement) => 'access-token' in requirement),
  ).toBe(true);
}

describe('exportSpec (integration)', () => {
  let outputPath: string;
  let document: Record<string, unknown>;

  beforeAll(async () => {
    outputPath = join(tmpdir(), `openapi-test-${Date.now()}.json`);
    await exportSpec(outputPath);
    document = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<
      string,
      unknown
    >;
  }, 30_000);

  it('exports a valid OpenAPI 3.x document', () => {
    expect(document.openapi).toMatch(/^3\./);
  });

  it('sets info.title to "StreamTube API"', () => {
    const info = document.info as Record<string, unknown>;
    expect(info.title).toBe('StreamTube API');
  });

  it('sets info.version to "1.0"', () => {
    const info = document.info as Record<string, unknown>;
    expect(info.version).toBe('1.0');
  });

  it('includes access-token Bearer security scheme', () => {
    const components = document.components as Record<string, unknown>;
    const schemes = components.securitySchemes as Record<
      string,
      Record<string, unknown>
    >;
    expect(schemes['access-token']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('includes non-empty components.schemas from DTO inference', () => {
    const components = document.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    expect(Object.keys(schemas).length).toBeGreaterThan(0);
  });

  it('includes ApiErrorEnvelope schema with expected properties', () => {
    const components = document.components as Record<string, unknown>;
    const schemas = components.schemas as Record<
      string,
      Record<string, unknown>
    >;
    expect(schemas['ApiErrorEnvelope']).toBeDefined();
    const props = schemas['ApiErrorEnvelope'].properties as Record<
      string,
      unknown
    >;
    expect(props).toHaveProperty('statusCode');
    expect(props).toHaveProperty('error');
    expect(props).toHaveProperty('message');
    expect(props).toHaveProperty('code');
  });

  it('has at least one path with a 401 response referencing ApiErrorEnvelope', () => {
    const paths = document.paths as OpenApiPaths;

    const hasRef = Object.values(paths).some((methods) =>
      Object.values(methods).some((operation) => {
        const r401 = operation.responses['401'];
        if (!r401) return false;
        return (
          r401.content?.['application/json']?.schema?.['$ref'] ===
          API_ERROR_ENVELOPE_REF
        );
      }),
    );

    expect(hasRef).toBe(true);
  });

  it('protected auth endpoints include access-token security requirement', () => {
    const paths = document.paths as OpenApiPaths;
    const protectedPaths = [
      { path: '/auth/logout', method: 'post' },
      { path: '/auth/me', method: 'get' },
    ];

    for (const { path, method } of protectedPaths) {
      const operation = paths[path]?.[method];
      expect(operation).toBeDefined();
      expectProtected(operation);
    }
  });

  it('all auth endpoints have a non-empty summary', () => {
    const paths = document.paths as OpenApiPaths;
    const authPaths = Object.entries(paths).filter(([p]) =>
      p.startsWith('/auth/'),
    );

    expect(authPaths.length).toBeGreaterThan(0);

    for (const [, methods] of authPaths) {
      for (const operation of Object.values(methods)) {
        expect(typeof operation.summary).toBe('string');
        expect(operation.summary!.length).toBeGreaterThan(0);
      }
    }
  });

  it('documents every protected video operation with its success and error contract', () => {
    const paths = document.paths as OpenApiPaths;
    const operations = [
      {
        path: '/channels/{channelId}/videos/uploads',
        method: 'post',
        successes: ['201'],
        errors: ['400', '401', '403', '404', '413', '415', '503'],
      },
      {
        path: '/channels/{channelId}/videos/{videoId}/upload-parts',
        method: 'post',
        successes: ['200'],
        errors: ['400', '401', '403', '404', '409', '410', '503'],
      },
      {
        path: '/channels/{channelId}/videos/{videoId}/complete-upload',
        method: 'post',
        successes: ['202'],
        errors: ['400', '401', '403', '404', '409', '410', '413', '422', '503'],
      },
      {
        path: '/channels/{channelId}/videos/{videoId}/upload',
        method: 'delete',
        successes: ['204'],
        errors: ['401', '403', '404', '409', '503'],
      },
      {
        path: '/videos/{publicId}/stream',
        method: 'get',
        successes: ['200', '206'],
        errors: ['400', '401', '403', '404', '409', '416'],
      },
      {
        path: '/videos/{publicId}/download',
        method: 'get',
        successes: ['200'],
        errors: ['400', '401', '403', '404', '409'],
      },
    ];

    for (const definition of operations) {
      const operation = paths[definition.path]?.[definition.method];
      expect(operation).toBeDefined();
      expectProtected(operation);

      for (const status of definition.successes) {
        expect(operation.responses[status]).toBeDefined();
      }
      for (const status of definition.errors) {
        expectApiErrorEnvelope(operation, status);
      }
    }
  });

  it('documents binary range and attachment response headers without storage internals', () => {
    const paths = document.paths as OpenApiPaths;
    const stream = paths['/videos/{publicId}/stream']?.get;
    const download = paths['/videos/{publicId}/download']?.get;

    expect(stream?.responses['200'].content).toHaveProperty(
      'application/octet-stream',
    );
    expect(stream?.responses['206'].content).toHaveProperty(
      'application/octet-stream',
    );
    expect(stream?.responses['206'].headers).toEqual(
      expect.objectContaining({
        'Accept-Ranges': expect.any(Object),
        'Content-Length': expect.any(Object),
        'Content-Range': expect.any(Object),
        'Content-Type': expect.any(Object),
      }),
    );
    expect(download?.responses['200'].content).toHaveProperty(
      'application/octet-stream',
    );
    expect(download?.responses['200'].headers).toEqual(
      expect.objectContaining({
        'Content-Disposition': expect.any(Object),
        'Content-Length': expect.any(Object),
        'Content-Type': expect.any(Object),
      }),
    );
  });
});
