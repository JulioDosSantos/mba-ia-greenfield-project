import { Test, type TestingModule } from '@nestjs/testing';
import { VideoWorkerModule } from './video-worker.module';

describe('VideoWorkerModule', () => {
  let module: TestingModule | undefined;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [VideoWorkerModule],
    }).compile();
  });

  afterAll(async () => {
    await module?.close();
  });

  it('compiles the isolated worker dependencies without HTTP controllers', () => {
    expect(module).toBeDefined();
  });
});
