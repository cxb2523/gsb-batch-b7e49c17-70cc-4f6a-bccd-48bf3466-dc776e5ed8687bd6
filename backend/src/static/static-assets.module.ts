import { Module, type DynamicModule } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import path from 'path';
import type { EnvConfig } from '../config/env.schema.js';

export function resolveStaticDirectory(customDir?: string): string | null {
  // 1. Explicit override via config/param
  if (customDir && existsSync(customDir)) {
    return customDir;
  }
  // 2. Production container layout: /app/public
  const appPublic = path.resolve(process.cwd(), 'public');
  if (existsSync(appPublic)) {
    return appPublic;
  }
  // 3. Alternate production layout: dist/public
  const distPublic = path.resolve(process.cwd(), 'dist', 'public');
  if (existsSync(distPublic)) {
    return distPublic;
  }
  // 4. Monorepo dev fallback: ../frontend/dist
  const frontendDist = path.resolve(process.cwd(), '../frontend/dist');
  if (existsSync(frontendDist)) {
    return frontendDist;
  }
  return null;
}

@Module({})
export class StaticAssetsModule {
  static forRootAsync(): DynamicModule {
    return {
      module: StaticAssetsModule,
      imports: [
        ServeStaticModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (configService: ConfigService<EnvConfig, true>) => {
            const staticDir = configService.get('STATIC_DIR', { infer: true });
            const targetDir = resolveStaticDirectory(staticDir);
            if (!targetDir) {
              return [];
            }
            return [
              {
                rootPath: targetDir,
                exclude: ['/api/{*path}'],
                serveStaticOptions: {
                  index: 'index.html',
                  fallthrough: true,
                },
              },
            ];
          },
        }),
      ],
    };
  }
}
