// BlastSimulator2026 — Who voices a click: the generic control sound or the command it ran
// A button that issues a game command is voiced twice otherwise: the delegated click, then the command's own
// cue (hire, order_queued, purchase, ui_denied). The command path marks this object when it plays a cue, and
// the delegated click, which waits one macrotask for the target's handlers to run, stays out of it when the
// count moved. One instance is created at startup and shared by installUiSounds and commandCue.

export class CommandClaim {
  private count = 0;

  /** How many command cues have been played so far. Compare two readings to learn whether one played in between. */
  get marks(): number {
    return this.count;
  }

  /** A command played its own cue. Silent commands (information, scripted, no cue for the outcome) never call this. */
  mark(): void {
    this.count += 1;
  }
}
