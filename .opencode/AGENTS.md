# BlastSimulator2026

Satirical open-pit mine management game (Theme Hospital meets capitalism). Cartoon 3D visuals, blast physics, union strikes, mafia, lawsuits.

## How to read all context files

AGENTS.md, agent definitions, and skills all use this convention. Two kinds of content. Obey their rules:

### ▶ INSTRUCTION blocks
- Marked by: `▶` prefix, numbered step lists, or the word "PROCEDURE" in a header
- **Meaning:** execute immediately, in order, without deviation
- **Failure to follow = agent failure.** Not optional. Not background.
- Examples: pipeline steps, operating procedures, capability gate checks

### KNOWLEDGE blocks
- Everything else: descriptions, reference tables, conventions, domain explanations
- **Meaning:** understand, internalize, apply when making decisions
- Not directly executable — informs judgment, does not override INSTRUCTION blocks

**When in doubt between the two:** if the block contains verbs directed at YOU ("delegate", "run", "check", "verify"), treat it as INSTRUCTION.

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

## Skills-First

Before any task, load related skill(s) for domain rules, procedures, and constraints.

## ▶ Capability Gate — CHECK BEFORE ANY ACTION

**Run first. Before everything.**

1. Does the task require visual perception, image analysis, screenshots, or rendering inspection?
   → **REJECT immediately.** "I lack vision capability. Delegate to @visual-tester?"
2. Does the task require a capability you do not possess (audio, binary analysis, etc.)?
   → **REJECT immediately.** "I lack [capability]. This requires [agent]."
3. Does the task ask to write outside allowed directories or perform forbidden actions?
   → **REJECT immediately.** State the restriction.

Do NOT attempt workarounds. Do NOT read image files hoping to extract text. Do NOT substitute state JSON for visual inspection. A modality gap is a hard stop.

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
