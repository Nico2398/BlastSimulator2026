// BlastSimulator2026 — Console command parser and runner
// Reads lines from stdin, dispatches to registered handlers, prints results.

export interface ParsedCommand {
  command: string;
  args: string[];
  namedArgs: Record<string, string>;
}

export interface CommandResult {
  success: boolean;
  output: string;
}

export type CommandHandler = (args: string[], namedArgs: Record<string, string>) => CommandResult;

/**
 * Parse a raw command string into a structured ParsedCommand.
 *
 * Tokens that contain `:` are treated as named args (key:value).
 * All other tokens (after the command name) are positional args.
 *
 * Examples:
 *   "survey 25,30"                  → { command: 'survey', args: ['25,30'], namedArgs: {} }
 *   "charge hole:1 explosive:tnt"   → { command: 'charge', args: [], namedArgs: { hole: '1', ... } }
 */
export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed) {
    return { command: '', args: [], namedArgs: {} };
  }

  const tokens = trimmed.split(/\s+/);
  const command = tokens[0] ?? '';
  const args: string[] = [];
  const namedArgs: Record<string, string> = {};

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    const colonIdx = token.indexOf(':');
    if (colonIdx > 0) {
      const key = token.slice(0, colonIdx);
      const value = token.slice(colonIdx + 1);
      namedArgs[key] = value;
    } else {
      args.push(token);
    }
  }

  return { command, args, namedArgs };
}

/** Registry of command handlers keyed by command name. */
export class ConsoleRunner {
  private readonly handlers = new Map<string, CommandHandler>();
  private readonly descriptions = new Map<string, string>();

  /** Register a command handler. */
  register(name: string, description: string, handler: CommandHandler): void {
    this.handlers.set(name, handler);
    this.descriptions.set(name, description);
  }

  /** Run a raw command string. Returns a CommandResult. */
  run(input: string): CommandResult {
    const parsed = parseCommand(input);

    if (!parsed.command) {
      return { success: true, output: '' };
    }

    if (parsed.command === 'help') {
      return this.handleHelp();
    }

    const handler = this.handlers.get(parsed.command);
    if (!handler) {
      return {
        success: false,
        output: `Unknown command: "${parsed.command}". Type "help" for available commands.`,
      };
    }

    return handler(parsed.args, parsed.namedArgs);
  }

  private handleHelp(): CommandResult {
    const lines = ['Available commands:', ''];
    for (const [name, desc] of this.descriptions) {
      lines.push(`  ${name.padEnd(20)} ${desc}`);
    }
    lines.push('  help                 Show this help message');
    return { success: true, output: lines.join('\n') };
  }
}
