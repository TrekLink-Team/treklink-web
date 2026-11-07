import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

// A fresh process exercises ConfigModule's real validated-default propagation before route loading.
async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(app);
  app.useLogger(false);
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const results: Record<string, { status: number; isSuccess: boolean; statusCode: number }> = {};
    for (const path of ['/api/demo/status', '/api/demo/quick', '/api/demo/simulation']) {
      const response = await fetch(`${base}${path}`);
      const body = (await response.json()) as { isSuccess: boolean; statusCode: number };
      results[path] = {
        status: response.status,
        isSuccess: body.isSuccess,
        statusCode: body.statusCode,
      };
    }
    process.stdout.write(`DEMO_BOOT_RESULT=${JSON.stringify(results)}\n`);
  } finally {
    await app.close();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
