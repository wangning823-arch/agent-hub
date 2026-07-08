/**
 * Shared utility for locating the mimo CLI binary.
 * Used by both MimoAgent and MimoServerManager.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export function findMimoPath(): string {
  const envPath = process.env.MIMOCODE_BIN_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates: string[] = [
    '/root/.nvm/versions/node/v22.22.3/lib/node_modules/@mimo-ai/cli/bin/.mimocode',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  try {
    const mimoWrapper = execSync('which mimo 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (mimoWrapper) {
      const realWrapper = fs.realpathSync(mimoWrapper);
      const binDir = path.dirname(realWrapper);
      const cached = path.join(binDir, '.mimocode');
      if (fs.existsSync(cached)) return cached;

      const platformMap: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
      const archMap: Record<string, string> = { x64: 'x64', arm64: 'arm64' };
      const platform = platformMap[process.platform] || process.platform;
      const arch = archMap[process.arch] || process.arch;
      const cliRoot = path.resolve(binDir, '..');
      const nodeModules = path.join(cliRoot, 'node_modules');
      const names = [
        `@mimo-ai/mimocode-${platform}-${arch}`,
        `@mimo-ai/mimocode-${platform}-${arch}-baseline`,
        `@mimo-ai/mimocode-${platform}-${arch}-musl`,
        `@mimo-ai/mimocode-${platform}-${arch}-baseline-musl`,
      ];
      for (const name of names) {
        const candidate = path.join(nodeModules, name, 'bin', 'mimo');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch (e) { /* ignore */ }

  return 'mimo';
}
