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
 * Unlike LOADING_QUIPS these are meant to be read and acted on, not just a
 * joke to skim past — real mechanics a player might not have discovered yet.
 */
export const LOADING_TIPS: readonly string[] = [
  'A survey narrows the odds before you drill — skipping it is a bet, not a shortcut.',
  'Stemming the top of a hole keeps the blast energy pointed at the rock, not the sky.',
  'A free face lets rock break sideways. Without one, energy has nowhere to go but up.',
  'Underloaded holes leave oversize boulders; overloaded ones fling debris past the berm.',
  'Fatigued crew work slower and get hurt more — a bunkhouse pays for itself.',
  'Contracts reward the ore grade you promised, not the grade you hoped for.',
  'A hauler idle at the depot is a hauler not making you money on the muck pile.',
  'Weather changes visibility and footing — check it before committing to a big sequence.',
  'Training a proficiency to the next level shows up in task duration, not just the number.',
  'The union notices skipped breaks long before it notices skipped raises.',
  'A warehouse tier caps how much ore you can stockpile before a sale.',
  'Sequencing charges in the right order controls where the muck pile ends up.',
  'Corruption buys speed today and an inspector tomorrow.',
  'Mixed rock hardness sites hide soft pockets next to hard ones — surveys still lie less than guessing.',
  'A vehicle needs a qualified driver before it needs fuel.',
];

/**
 * A bag that hands out tips without repeating until it is empty — same shape
 * as QuipBag. Kept as its own class in this pass rather than factored into a
 * shared `DrawBag<T>`; that refactor, if any, is implementation-phase work.
 */
export class TipBag {
  private remaining: string[] = [];
  private readonly random: () => number;

  /** `random` is injectable so tests can pin the order. */
  constructor(random: () => number = Math.random) {
    this.random = random;
    this.refill();
  }

  private refill(): void {
    this.remaining = [...LOADING_TIPS];
  }

  /** Draw a tip. Refills once every line has been used. */
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
