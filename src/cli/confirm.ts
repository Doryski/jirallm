import { confirm, text, isCancel } from '@clack/prompts';

type ConfirmOptions = { yes?: boolean };

export async function confirmOrAbort(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  if (opts.yes) return true;
  if (!process.stdin.isTTY) {
    throw new Error('Confirmation required but no interactive terminal available. Pass --yes to proceed.');
  }
  const answer = await confirm({ message, initialValue: false });
  if (isCancel(answer)) return false;
  return answer === true;
}

export async function typedNameConfirm(expected: string, opts: ConfirmOptions = {}): Promise<boolean> {
  if (opts.yes) return true;
  if (!process.stdin.isTTY) {
    throw new Error(
      `Confirmation required but no interactive terminal available. Pass --yes to proceed.`
    );
  }
  const answer = await text({
    message: `Type "${expected}" to confirm:`,
    validate: (v) => (v === expected ? undefined : 'Does not match — aborting if left empty.'),
  });
  if (isCancel(answer)) return false;
  return answer === expected;
}
