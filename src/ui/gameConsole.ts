// BlastSimulator2026 — The UI's handle on the game console.
//
// Every panel, modal and shortcut binding that dispatches a command holds the
// same one-line function type. It lived seventeen times over, once per file
// that needed it, until each copy was replaced by this import.

import type { CommandResult } from '../console/ConsoleRunner.js';

/** Runs a console command string and reports what the console made of it. */
export type GameConsoleFn = (cmd: string) => CommandResult;
