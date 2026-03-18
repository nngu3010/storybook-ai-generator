import fs from 'fs';
import path from 'path';

export interface TypeErrorInfo {
  file: string;
  message: string;
}

/**
 * Searches dir and two levels up for tsconfig.json.
 */
export function findTsconfig(dir: string): string | undefined {
  const candidates = [
    path.join(dir, 'tsconfig.json'),
    path.join(dir, '..', 'tsconfig.json'),
    path.join(dir, '..', '..', 'tsconfig.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Parses tsc stderr/stdout and returns errors from *.stories.ts files only.
 */
export function parseTscOutput(output: string): TypeErrorInfo[] {
  const errors: TypeErrorInfo[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(/([^\s]+\.stories\.ts)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/);
    if (match) {
      errors.push({
        file: path.basename(match[1]),
        message: `${match[4]}: ${match[5]} (line ${match[2]})`,
      });
    }
  }
  return errors;
}
