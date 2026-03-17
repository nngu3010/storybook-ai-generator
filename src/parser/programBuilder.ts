import { Project } from 'ts-morph';

/**
 * Builds a ts-morph Project for the given set of files.
 * We skip adding files from tsconfig so that we control exactly
 * which files are analysed — keeping things fast and deterministic.
 */
export function buildProgram(rootDir: string, filePaths: string[]): Project {
  const project = new Project({
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
