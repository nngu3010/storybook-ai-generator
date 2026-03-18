import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/fixtures/**', 'node_modules/**', 'dist/**'],
    server: {
      deps: {
        // Let Node handle ts-morph's CJS requires natively so that
        // vitest's 'import' condition does not redirect minimatch's
        // require() to the ESM build (dist/esm/index.js).
        external: ['ts-morph', /\/@ts-morph\//],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli/index.ts'],
    },
  },
  resolve: {
    conditions: ['import', 'node'],
  },
});
