import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { join } from 'node:path';
import { DomainException, ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

// The part of `prisma/seed-demo.ts` the runner uses (specs/demo/design.md §4).
export interface DemoSeedPasswords {
  admin: string;
  staff: string;
  manager: string;
  operator: string;
}

export interface DemoSeedModule {
  seedDemo(
    prisma: PrismaClient,
    passwords: DemoSeedPasswords,
    options: { now: Date; bcryptCost: number; apiKey?: string },
  ): Promise<string[]>;
  readPasswords(env: NodeJS.ProcessEnv): DemoSeedPasswords;
}

export const DEMO_SEED_LOADER = Symbol('DEMO_SEED_LOADER');
export type DemoSeedLoader = () => DemoSeedModule;

// The backend root: this file sits three levels below it, in src/modules/demo or dist/modules/demo.
export const BACKEND_ROOT = join(__dirname, '..', '..', '..');

// The build compiles only src/, so the seed is loaded by path at run time. A compiled backend (`nest
// start`) has no loader for .ts files: the first require then fails with MODULE_NOT_FOUND, and ts-node,
// a dev dependency present wherever the demo runs, is registered once and the require repeated. Jest and
// ts-node runs load the file at once.
export const loadSeedModule: DemoSeedLoader = () => {
  const file = join(BACKEND_ROOT, 'prisma', 'seed-demo');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(file) as DemoSeedModule;
  } catch (error) {
    if ((error as { code?: string }).code !== 'MODULE_NOT_FOUND') throw error;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('ts-node') as { register(options: object): void }).register({
      transpileOnly: true,
      project: join(BACKEND_ROOT, 'tsconfig.json'),
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(file) as DemoSeedModule;
  }
};

// Runs the demo seed in-process with the SEED_* variables the CLI reads (ConfigModule has loaded the
// same .env files into process.env).
@Injectable()
export class DemoSeedRunner {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DEMO_SEED_LOADER) private readonly load: DemoSeedLoader,
  ) {}

  // The four passwords, or 409 DEMO_SEED_NOT_CONFIGURED naming the missing variables. Called before the
  // reset, so a missing password changes nothing.
  passwords(env: NodeJS.ProcessEnv = process.env): DemoSeedPasswords {
    try {
      return this.load().readPasswords(env);
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/^missing /, '') : '';
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.DEMO_SEED_NOT_CONFIGURED,
        `Set ${detail || 'the SEED_*_PASSWORD variables'} before staging.`,
      );
    }
  }

  run(passwords: DemoSeedPasswords, now: Date, env: NodeJS.ProcessEnv = process.env) {
    return this.load().seedDemo(this.prisma, passwords, {
      now,
      bcryptCost: Number(env.BCRYPT_COST ?? 12),
      apiKey: env.SEED_ORG_API_KEY || undefined,
    });
  }
}
