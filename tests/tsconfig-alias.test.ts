import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildProgram } from '../src/parser/programBuilder.js';
import { parseComponent } from '../src/parser/componentParser.js';
import { findComponents } from '../src/detector/componentFinder.js';
import { findTsconfig } from '../src/utils/typecheck.js';

/**
 * Sets up a temporary project with a tsconfig that defines a path alias
 * (@tokens -> ./tokens) and a component that imports from that alias.
 * Verifies that buildProgram uses the tsconfig so the alias resolves
 * and props are extracted correctly.
 */

const TMP_DIR = path.resolve('tests/.tmp-alias');
const TSCONFIG = path.join(TMP_DIR, 'tsconfig.json');
const TOKENS_FILE = path.join(TMP_DIR, 'tokens', 'theme.ts');
const COMPONENT_FILE = path.join(TMP_DIR, 'Badge.tsx');

beforeAll(() => {
  fs.mkdirSync(path.join(TMP_DIR, 'tokens'), { recursive: true });

  // Shared type exported via path alias
  fs.writeFileSync(TOKENS_FILE, `export type BadgeVariant = 'info' | 'success' | 'warning' | 'error';`);

  // Component that imports via @tokens alias
  fs.writeFileSync(
    COMPONENT_FILE,
    `import React from 'react';
import type { BadgeVariant } from '@tokens/theme';

export interface BadgeProps {
  /** Display text */
  label: string;
  /** Visual style */
  variant: BadgeVariant;
  /** Whether the badge is dismissible */
  dismissible?: boolean;
}

export default function Badge({ label, variant, dismissible = false }: BadgeProps) {
  return <span>{label}</span>;
}
`,
  );

  // tsconfig with path alias
  fs.writeFileSync(
    TSCONFIG,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          baseUrl: '.',
          paths: {
            '@tokens/*': ['./tokens/*'],
          },
        },
        include: ['**/*.ts', '**/*.tsx'],
      },
      null,
      2,
    ),
  );
});

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('programBuilder: tsconfig path alias resolution', () => {
  it('finds tsconfig.json for the tmp project', () => {
    const found = findTsconfig(TMP_DIR);
    expect(found).toBe(TSCONFIG);
  });

  it('resolves BadgeVariant from path alias — variant prop has string literal union type', async () => {
    const componentFiles = await findComponents(TMP_DIR);
    expect(componentFiles.length).toBeGreaterThanOrEqual(1);

    const project = buildProgram(TMP_DIR, componentFiles);
    const meta = parseComponent(project, COMPONENT_FILE);

    expect(meta.skipReason).toBeUndefined();
    expect(meta.name).toBe('Badge');

    const variant = meta.props.find((p) => p.name === 'variant');
    expect(variant).toBeDefined();

    // With path alias resolution, the type expands to the string literal union
    expect(variant!.typeName).toMatch(/info/);
    expect(variant!.typeName).toMatch(/success/);
    expect(variant!.typeName).toMatch(/warning/);
    expect(variant!.typeName).toMatch(/error/);
  });

  it('extracts all props correctly with alias resolution', async () => {
    const componentFiles = await findComponents(TMP_DIR);
    const project = buildProgram(TMP_DIR, componentFiles);
    const meta = parseComponent(project, COMPONENT_FILE);

    const propNames = meta.props.map((p) => p.name);
    expect(propNames).toContain('label');
    expect(propNames).toContain('variant');
    expect(propNames).toContain('dismissible');

    const label = meta.props.find((p) => p.name === 'label')!;
    expect(label.required).toBe(true);

    const dismissible = meta.props.find((p) => p.name === 'dismissible')!;
    expect(dismissible.required).toBe(false);
    expect(dismissible.defaultValue).toMatch(/false/);
  });

  it('falls back gracefully when no tsconfig exists', async () => {
    const noConfigDir = path.resolve('tests/.tmp-no-tsconfig');
    fs.mkdirSync(noConfigDir, { recursive: true });
    fs.writeFileSync(
      path.join(noConfigDir, 'Simple.tsx'),
      `export default function Simple({ label }: { label: string }) { return <div>{label}</div>; }`,
    );

    try {
      const componentFiles = await findComponents(noConfigDir);
      const project = buildProgram(noConfigDir, componentFiles);
      const meta = parseComponent(project, path.join(noConfigDir, 'Simple.tsx'));

      expect(meta.skipReason).toBeUndefined();
      expect(meta.props[0].name).toBe('label');
    } finally {
      fs.rmSync(noConfigDir, { recursive: true, force: true });
    }
  });
});
