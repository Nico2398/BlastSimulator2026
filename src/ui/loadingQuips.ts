// BlastSimulator2026 — Loading screen quips
//
// The load takes a few seconds of blocked main thread, and naming the actual
// work ("Generating terrain", "Building the site") made that wait feel like a
// progress report on somebody else's job. The game is a satire of open-pit
// mining management; the loading screen is free real estate for it.
//
// Drawn without replacement, so a single load never repeats a line, and the
// bag reshuffles once it runs dry.

export const LOADING_QUIPS: readonly string[] = [
  'Bribing the geological survey',
  'Rounding profit margins in our favour',
  'Teaching the interns which end of the drill is which',
  'Losing three clipboards',
  'Negotiating with the union, badly',
  'Burying the environmental impact report',
  'Aging the dynamite to taste',
  'Calculating blast radius, optimistically',
  'Reclassifying the swamp as a feature',
  'Filing the noise complaints under "compliments"',
  'Convincing the accountant it was always like that',
  'Renaming the landslide an "unscheduled bench adjustment"',
  'Painting the safety rails a more reassuring colour',
  'Misplacing the second-safest helmet',
  'Explaining overtime to the night shift',
  'Rustproofing the excavator with hope',
  'Consulting a man who owns a divining rod',
  'Rounding the seismograph down',
  'Approving a budget nobody read',
  'Digging a hole to put the paperwork in',
  'Assuring the neighbours it is only temporary',
  'Locating the foreman, eventually',
  'Adding a zero to the ore estimate',
  'Removing that zero after legal called',
  'Warming up the very large truck',
  'Reticulating the tailings pond',
  'Scheduling the inspection for a convenient decade',
  'Confirming the canary is merely resting',
  'Sharpening things that should not need sharpening',
  'Drafting a press release about synergy',
  'Counting the rocks. Twice. Different answers',
  'Persuading the seam to be somewhere easier',
  'Installing a suggestion box with no slot',
  'Blaming the previous management',
];

/**
 * A bag that hands out quips without repeating until it is empty.
 *
 * Repetition inside one load is what would give the joke away as a fixed
 * list, so the bag is drawn down rather than sampled independently each time.
 */
export class QuipBag {
  private remaining: string[] = [];
  private readonly random: () => number;

  /** `random` is injectable so tests can pin the order. */
  constructor(random: () => number = Math.random) {
    this.random = random;
    this.refill();
  }

  private refill(): void {
    this.remaining = [...LOADING_QUIPS];
  }

  /** Draw a quip. Refills once every line has been used. */
  next(): string {
    if (this.remaining.length === 0) this.refill();
    const i = Math.min(this.remaining.length - 1, Math.floor(this.random() * this.remaining.length));
    return this.remaining.splice(i, 1)[0]!;
  }

  /** Lines still unused in the current pass — exposed for tests. */
  get remainingCount(): number {
    return this.remaining.length;
  }
}

/**
 * Gameplay tips shown in the loading screen's tip block, served by TipBag.
 *
 * Placeholder — test-writer/implementer fill in real copy; do not invent tip
 * text during the skeleton pass.
 */
export const LOADING_TIPS: readonly string[] = [];

/**
 * A bag that hands out tips without repeating until it is empty — same shape
 * as QuipBag. Kept as its own class in this pass rather than factored into a
 * shared `DrawBag<T>`; that refactor, if any, is implementation-phase work.
 */
export class TipBag {
  constructor(random: () => number = Math.random) {
    void random;
    // TODO: implement
  }

  next(): string {
    // TODO: implement
    return '';
  }

  get remainingCount(): number {
    // TODO: implement
    return 0;
  }
}
