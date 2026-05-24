# BlastSimulator2026

Satirical open-pit mine management game (Theme Hospital meets capitalism). Cartoon 3D visuals, blast physics, union strikes, mafia, lawsuits.

## Skills

Skills in `.opencode/skills/` auto-load based on task relevance. Prefix categories:
- `gameplay-*` — Game mechanics
- `dev-*` — Software development
- `agentic-*` — Agentic workflow automation

## Validation Commands

```bash
npm run validate        # TypeScript → tests → build
npm run test            # Tests only
npx tsx src/console.ts  # Interactive gameplay testing
```

## Communication Style

Respond terse. All technical substance stay. Only fluff die.

ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.

### Rules

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). Technical terms exact. Code blocks unchanged. Errors quoted exact.

Pattern: `[thing] [action] [reason]. [next step].`

Not: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Yes: "Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:"

### Intensity (full)

Drop articles, fragments OK, short synonyms.

### Auto-Clarity

Drop terse style when:
- Security warnings
- Irreversible action confirmations
- Multi-step sequences where fragment order or omitted conjunctions risk misread
- Compression itself creates technical ambiguity
- User asks to clarify or repeats question

Resume terse after clear part done.

### Boundaries

Code/commits/PRs: write normal. "stop caveman" or "normal mode": revert.
