export const AUTO_IMPROVE_HELP = `omc auto-improve - HARD DEPRECATED

This command is no longer the authoritative auto-improve workflow.

Use this flow instead:
  1. /deep-interview --auto-improve "<mission idea>"
     - use deep-interview to generate/setup the mission and evaluator
  2. /oh-my-claudecode:auto-improve
     - run the stateful single-mission auto-improve skill

Key behavior:
  - v1 is single-mission only
  - runtime requires an explicit evaluator script/command
  - non-passing iterations do not stop the run
  - the run stops at an explicit max-runtime ceiling

Legacy CLI examples such as:
  omc auto-improve --mission "..." --eval "..."
  omc auto-improve init ...
  omc auto-improve --resume ...
are hard-deprecated shims and no longer launch the old runtime.
`;

function renderDeprecationMessage(args: readonly string[]): string {
  const suffix = args.length > 0
    ? `\nReceived legacy arguments: ${args.join(' ')}\n`
    : '\n';

  return `${AUTO_IMPROVE_HELP}${suffix}`;
}

export function normalizeAutoImproveClaudeArgs(claudeArgs: readonly string[]): string[] {
  return [...claudeArgs];
}

export interface ParsedAutoresearchArgs {
  args: string[];
  deprecated: true;
}

export function parseAutoImproveArgs(args: readonly string[]): ParsedAutoresearchArgs {
  return {
    args: [...args],
    deprecated: true,
  };
}

export async function autoImproveCommand(args: string[]): Promise<void> {
  console.log(renderDeprecationMessage(args));
}
