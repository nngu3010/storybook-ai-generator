import { Project } from 'ts-morph';
import { findTsconfig } from '../utils/typecheck.js';

/**
 * Builds a ts-morph Project for the given set of files.
 *
 * If a tsconfig.json is found at or above rootDir, we use it so that
 * path aliases, baseUrl, lib, and other project-specific compiler options
 * are respected. skipAddingFilesFromTsConfig keeps analysis fast — only
 * the discovered component files are added.
 *
 * Falls back to sensible hardcoded defaults when no tsconfig is found.
 */
export function buildProgram(rootDir: string, filePaths: string[]): Project {
  const tsconfigPath = findTsconfig(rootDir);

  const project = tsconfigPath
    ? new Project({
        tsConfigFilePath: tsconfigPath,
        skipAddingFilesFromTsConfig: true,
        skipFileDependencyResolution: false,
      })
    : new Project({
        compilerOptions: {
          jsx: 2, // React
          strict: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          moduleResolution: 2, // Node
          target: 99, // ESNext
        },
        skipAddingFilesFromTsConfig: true,
        skipFileDependencyResolution: false,
      });

  for (const filePath of filePaths) {
    project.addSourceFileAtPath(filePath);
  }

  return project;
}
