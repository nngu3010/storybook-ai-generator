import chalk from 'chalk';

const PREFIX = '[storybook-gen]';

export const logger = {
  info(message: string): void {
    console.log(`${chalk.blue(PREFIX)} ${message}`);
  },

  success(message: string): void {
    console.log(`${chalk.green(PREFIX)} ${chalk.green('✓')} ${message}`);
  },

  warn(message: string): void {
    console.warn(`${chalk.yellow(PREFIX)} ${chalk.yellow('⚠')} ${message}`);
  },

  error(message: string): void {
    console.error(`${chalk.red(PREFIX)} ${chalk.red('✗')} ${message}`);
  },

  skip(message: string): void {
    console.log(`${chalk.gray(PREFIX)} ${chalk.gray('–')} ${message}`);
  },
};
