import path from 'path';
import fs from 'fs';
import { detectProviders, type DetectedProvider } from '../../decorators/providerDetector.js';
import { generatePreviewContent } from '../../decorators/previewGenerator.js';
import { logger } from '../../utils/logger.js';

export interface DecoratorOptions {
  force?: boolean;
}

export async function runDecorators(dir: string, opts: DecoratorOptions = {}): Promise<void> {
  const resolvedDir = path.resolve(dir);
  logger.info(`Scanning ${resolvedDir}/package.json for state management libraries...`);

  // Step 1: Detect providers
  const providers = detectProviders(resolvedDir);

  if (providers.length === 0) {
    logger.info('No state management or provider-requiring libraries detected.');
    logger.info('If your project uses providers, you can manually configure .storybook/preview.ts');
    return;
  }

  logger.info(`Detected ${providers.length} provider(s):`);
  for (const p of providers) {
    logger.success(`  ${p.label} (${p.library})`);
  }
  console.log('');

  // Step 2: Locate or create .storybook directory
  const storybookDir = path.join(resolvedDir, '.storybook');
  if (!fs.existsSync(storybookDir)) {
    logger.warn('.storybook/ directory not found — creating it');
    fs.mkdirSync(storybookDir, { recursive: true });
  }

  // Step 3: Generate preview.ts
  const previewPath = path.join(storybookDir, 'preview.ts');
  if (fs.existsSync(previewPath) && !opts.force) {
    logger.warn(`${previewPath} already exists. Use --force to overwrite.`);
    logManualInstructions(providers);
    return;
  }

  const content = generatePreviewContent(providers);
  fs.writeFileSync(previewPath, content, 'utf-8');
  logger.success(`Generated .storybook/preview.ts with ${providers.length} decorator(s)`);

  // Step 4: Write companion files (mock stores, themes, etc.)
  let companionCount = 0;
  for (const provider of providers) {
    if (!provider.companionFile) continue;

    const companionPath = path.join(storybookDir, provider.companionFile.filename);
    if (fs.existsSync(companionPath) && !opts.force) {
      logger.skip(`${provider.companionFile.filename} already exists — skipping`);
      continue;
    }

    fs.writeFileSync(companionPath, provider.companionFile.content, 'utf-8');
    logger.success(`Generated .storybook/${provider.companionFile.filename}`);
    companionCount++;
  }

  // Step 5: Summary
  console.log('');
  logger.info('Next steps:');

  const hasCompanion = providers.some((p) => p.companionFile);
  if (hasCompanion) {
    logger.info('  1. Update the mock store / theme files in .storybook/ with your real configuration');
  }
  logger.info(`  ${hasCompanion ? '2' : '1'}. Run \`sbook-ai generate\` to generate stories — they will now work with your providers`);
  logger.info(`  ${hasCompanion ? '3' : '2'}. Start Storybook to verify everything renders correctly`);
}

function logManualInstructions(providers: DetectedProvider[]): void {
  console.log('');
  logger.info('Add these decorators manually to your existing .storybook/preview.ts:');
  console.log('');
  console.log('  import React from \'react\';');
  for (const p of providers) {
    for (const line of p.importStatement.split('\n')) {
      if (line.trim()) console.log(`  ${line}`);
    }
  }
  console.log('');
  console.log('  // Add to your preview config:');
  console.log('  decorators: [');
  console.log('    (Story) => (');
  for (const p of providers) {
    const open = p.wrapper.replace('{children}', '');
    const closeMatch = open.match(/<\/\w+>/g);
    const closeTag = closeMatch ? closeMatch[closeMatch.length - 1] : '';
    console.log(`      ${open.replace(closeTag, '').trimEnd()}`);
  }
  console.log('        <Story />');
  for (const p of [...providers].reverse()) {
    const open = p.wrapper.replace('{children}', '');
    const closeMatch = open.match(/<\/\w+>/g);
    if (closeMatch) console.log(`      ${closeMatch[closeMatch.length - 1]}`);
  }
  console.log('    ),');
  console.log('  ],');
  console.log('');
}
