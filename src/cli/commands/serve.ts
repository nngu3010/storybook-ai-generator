import { createRequire } from 'module';
import { startMcpServer } from '../../mcp/server.js';

function readVersion(): string {
  const require = createRequire(import.meta.url);
  try {
    const pkg = require('../../../package.json') as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

export async function runServe(): Promise<void> {
  const version = readVersion();
  await startMcpServer(version);
}
