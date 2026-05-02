import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

type RunCommandOptions = {
  shouldThrow?: boolean;
  silent?: boolean;
};

export async function runCommand(
  command: string,
  description: string,
  options: RunCommandOptions = {}
): Promise<string> {
  const { shouldThrow = true, silent = false } = options;

  if (!silent) console.info(`\n${description}...`);

  try {
    const { stdout, stderr } = await execAsync(command);
    if (!silent) {
      if (stderr) console.error(stderr);
      console.info(stdout);
    }
    return stdout.trim();
  } catch (error) {
    if (!silent) {
      console.error(
        `${description} failed:`,
        error instanceof Error ? error.message : String(error)
      );
    }
    if (shouldThrow) throw error;
    return '';
  }
}
