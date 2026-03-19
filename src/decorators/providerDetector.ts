import fs from 'fs';
import path from 'path';

export interface DetectedProvider {
  /** Library name that triggered detection (e.g. "react-redux") */
  library: string;
  /** Human-readable label (e.g. "Redux") */
  label: string;
  /** Import statement for the decorator */
  importStatement: string;
  /** JSX wrapper code — uses `{children}` placeholder */
  wrapper: string;
  /** Optional companion file content (e.g. mock store setup) */
  companionFile?: { filename: string; content: string };
}

/** All supported provider configurations keyed by npm package name. */
const PROVIDER_CONFIGS: Record<string, Omit<DetectedProvider, 'library'>> = {
  'react-redux': {
    label: 'Redux',
    importStatement: `import { Provider as ReduxProvider } from 'react-redux';\nimport { mockStore } from './mockStore';`,
    wrapper: '<ReduxProvider store={mockStore}>{children}</ReduxProvider>',
    companionFile: {
      filename: 'mockStore.ts',
      content: `import { configureStore } from '@reduxjs/toolkit';

/**
 * Mock Redux store for Storybook.
 * Add your slices / initial state here.
 */
export const mockStore = configureStore({
  reducer: {
    // example: exampleReducer,
  },
});

export type MockRootState = ReturnType<typeof mockStore.getState>;
`,
    },
  },
  '@reduxjs/toolkit': {
    label: 'Redux',
    importStatement: `import { Provider as ReduxProvider } from 'react-redux';\nimport { mockStore } from './mockStore';`,
    wrapper: '<ReduxProvider store={mockStore}>{children}</ReduxProvider>',
    companionFile: {
      filename: 'mockStore.ts',
      content: `import { configureStore } from '@reduxjs/toolkit';

/**
 * Mock Redux store for Storybook.
 * Add your slices / initial state here.
 */
export const mockStore = configureStore({
  reducer: {
    // example: exampleReducer,
  },
});

export type MockRootState = ReturnType<typeof mockStore.getState>;
`,
    },
  },
  'zustand': {
    label: 'Zustand',
    importStatement: '',
    wrapper: '',
  },
  jotai: {
    label: 'Jotai',
    importStatement: `import { Provider as JotaiProvider } from 'jotai';`,
    wrapper: '<JotaiProvider>{children}</JotaiProvider>',
  },
  recoil: {
    label: 'Recoil',
    importStatement: `import { RecoilRoot } from 'recoil';`,
    wrapper: '<RecoilRoot>{children}</RecoilRoot>',
  },
  '@tanstack/react-query': {
    label: 'React Query',
    importStatement: `import { QueryClient, QueryClientProvider } from '@tanstack/react-query';`,
    wrapper: '<QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>',
  },
  'react-router-dom': {
    label: 'React Router',
    importStatement: `import { MemoryRouter } from 'react-router-dom';`,
    wrapper: '<MemoryRouter>{children}</MemoryRouter>',
  },
  'styled-components': {
    label: 'styled-components',
    importStatement: `import { ThemeProvider } from 'styled-components';\nimport { theme } from './theme';`,
    wrapper: '<ThemeProvider theme={theme}>{children}</ThemeProvider>',
    companionFile: {
      filename: 'theme.ts',
      content: `/**
 * Storybook theme stub for styled-components.
 * Replace with your real theme import.
 */
export const theme = {
  colors: {
    primary: '#0070f3',
    background: '#ffffff',
    text: '#111111',
  },
  spacing: (n: number) => \`\${n * 4}px\`,
};
`,
    },
  },
  '@emotion/react': {
    label: 'Emotion',
    importStatement: `import { ThemeProvider } from '@emotion/react';\nimport { theme } from './theme';`,
    wrapper: '<ThemeProvider theme={theme}>{children}</ThemeProvider>',
    companionFile: {
      filename: 'theme.ts',
      content: `/**
 * Storybook theme stub for Emotion.
 * Replace with your real theme import.
 */
export const theme = {
  colors: {
    primary: '#0070f3',
    background: '#ffffff',
    text: '#111111',
  },
  spacing: (n: number) => \`\${n * 4}px\`,
};
`,
    },
  },
  '@mui/material': {
    label: 'MUI',
    importStatement: `import { ThemeProvider, createTheme } from '@mui/material/styles';\nimport CssBaseline from '@mui/material/CssBaseline';`,
    wrapper: '<ThemeProvider theme={createTheme()}><CssBaseline />{children}</ThemeProvider>',
  },
  'react-intl': {
    label: 'React Intl',
    importStatement: `import { IntlProvider } from 'react-intl';`,
    wrapper: `<IntlProvider locale="en" messages={{}}>{children}</IntlProvider>`,
  },
  'next-intl': {
    label: 'next-intl',
    importStatement: `import { NextIntlClientProvider } from 'next-intl';`,
    wrapper: `<NextIntlClientProvider locale="en" messages={{}}>{children}</NextIntlClientProvider>`,
  },
};

/**
 * Reads the target project's package.json and detects which libraries
 * need provider wrappers in Storybook.
 */
export function detectProviders(projectDir: string): DetectedProvider[] {
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };

  const detected: DetectedProvider[] = [];
  const seen = new Set<string>();

  for (const [depName, config] of Object.entries(PROVIDER_CONFIGS)) {
    if (!(depName in allDeps)) continue;

    // Deduplicate by label (react-redux and @reduxjs/toolkit both map to Redux)
    if (seen.has(config.label)) continue;
    seen.add(config.label);

    // Skip providers that need no wrapper (e.g. Zustand)
    if (!config.wrapper) continue;

    detected.push({ library: depName, ...config });
  }

  return detected;
}
