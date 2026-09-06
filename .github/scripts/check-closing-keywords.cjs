'use strict';

/**
 * BlastSimulator2026 — Guard against accidental issue-closing keywords
 *
 * GitHub's merge-time parser matches `close[sd]?`, `fix(es|ed)?`, `resolve[sd]?`
 * immediately followed by `#<number>` as a bare substring, anywhere outside a
 * code span or fenced block — with no awareness of negation, quotation, or
 * tense. Three independent incidents on issue #707 in one day (see
 * `.claude/skills/agentic-autonomous-pipeline/references/keyword-closing-postmortem.md`)
 * each a docs-only attempt to correct the previous one, each retriggered the
 * exact bug it was documenting. Prose guidance alone is not enough: this is
 * the mechanical guard that reads a PR the same way GitHub's parser does.
 *
 * Scans the PR title, PR body, and every commit message in the PR's range —
 * whatever text this repo's merge strategy could feed into the base branch's
 * history (a squash commit here concatenates constituent commit messages
 * verbatim by default; see the postmortem's exhibit 4). The one exempt shape
 * is a standalone line that is *exactly* a closing directive — `Closes #755`,
 * nothing else on the line — the pipeline's own convention for the PR body's
 * intended closing line. Everything else matching the pattern fails the check,
 * including a correct reference to the *right* issue if it is not written as
 * that standalone line: the incidents were not about picking the wrong issue
 * number, they were about the phrase appearing anywhere a human reader would
 * parse it as prose rather than as the deliberate directive.
 *
 * @module check-closing-keywords
 */

const fs = require('fs');

/** The same fixed keyword set the postmortem documents, case-insensitive. */
const CLOSING_KEYWORD_RE = /\b(close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+#(\d+)\b/gi;

/**
 * The conventional-commit types this repo emits, as a subject prefix. Deliberately
 * a closed list: it is what makes the exemption below a recognised *shape* rather
 * than "any word before a colon", so a narrating line like `note: fixes #99` is
 * still a violation.
 */
const COMMIT_TYPE_PREFIX = '(?:feat|fix|refactor|docs|test|chore|perf|build|ci|style|revert)(?:\\([^)]*\\))?!?:\\s+';

/**
 * The exempt shape: a line whose entire (trimmed) content is a closing directive,
 * optionally behind a conventional-commit type prefix, optionally followed by a
 * single trailing `.` or `,`. Matches the pipeline's `Closes #<N>` body convention,
 * its `Fixes`/`Resolves` synonyms, and a typed directive title — `<type>: Resolve #<N>`.
 *
 * The typed title had to be admitted, and admitting it is not a softening. The
 * guard landed (#765) while `open-pr` was required to write exactly that title,
 * so the two shipped in direct contradiction: PR #773 — the first pipeline PR
 * opened after the guard merged — failed this check on its own mandated title,
 * and every pipeline PR after it would have failed the same way. Both are
 * deliberate directives about the issue the PR exists to close; neither is the
 * prose the postmortem is about. What stays flagged is unchanged: a closing
 * keyword inside a *sentence*, which is what every incident on #707 actually was,
 * and which no amount of naming the right issue number excuses.
 *
 * The pipeline no longer writes that title. Because the exemption is a whole-line
 * match, the bare directive was the only title it could write, and every pipeline
 * PR from #773 to #980 read `fix: Resolve #<N>` with nothing descriptive in it.
 * `open-pr` now titles a PR `<type>: <summary> (#<N>)` and leaves the directive to
 * the body's `Closes #<N>` line — a title with no closing keyword, which this guard
 * passes without any exemption. The typed shape stays admitted for the pull
 * requests already opened under it and for a hand-written directive title.
 */
const SANCTIONED_LINE_RE = new RegExp(
  `^(?:${COMMIT_TYPE_PREFIX})?(close[sd]?|fix(?:es|ed)?|resolve[sd]?)\\s+#(\\d+)[.,]?$`,
  'i'
);

/**
 * Blanks out fenced code blocks and inline code spans without shifting any
 * other character's position, so a violation's reported column still points
 * at the original text. The parser this guards against skips code spans
 * entirely — that is the one reliable boundary the postmortem names.
 *
 * @param {string} text
 * @returns {string}
 */
function stripCodeSpans(text) {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

/**
 * @param {string} text
 * @param {string} source Human-readable label for where this text came from.
 * @param {{ source: string, line: number, text: string }[]} violations Appended to in place.
 */
function scanText(text, source, violations) {
  if (!text) return;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (SANCTIONED_LINE_RE.test(line.trim())) return;
    const stripped = stripCodeSpans(line);
    const re = new RegExp(CLOSING_KEYWORD_RE.source, 'gi');
    let match;
    while ((match = re.exec(stripped)) !== null) {
      violations.push({ source, line: idx + 1, text: match[0].trim() });
    }
  });
}

/**
 * @param {{ title?: string, body?: string, commitMessages?: string[] }} input
 * @returns {{ source: string, line: number, text: string }[]}
 */
function findClosingKeywordViolations({ title, body, commitMessages } = {}) {
  const violations = [];
  scanText(title || '', 'title', violations);
  scanText(body || '', 'body', violations);
  (commitMessages || []).forEach((message, i) => {
    scanText(message || '', `commit ${i + 1}`, violations);
  });
  return violations;
}

function readFileIfPresent(path) {
  if (!path || !fs.existsSync(path)) return '';
  return fs.readFileSync(path, 'utf8');
}

function readCommitMessages(path) {
  if (!path || !fs.existsSync(path)) return [];
  const raw = fs.readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function main() {
  const [, , titleFile, bodyFile, commitsFile] = process.argv;
  const title = readFileIfPresent(titleFile);
  const body = readFileIfPresent(bodyFile);
  const commitMessages = readCommitMessages(commitsFile);

  const violations = findClosingKeywordViolations({ title, body, commitMessages });

  if (violations.length > 0) {
    console.error(
      'Closing-keyword guard: found a closing keyword immediately before a bare issue number,' +
        ' outside a code span and outside a standalone `Closes #<N>` line.'
    );
    console.error('');
    for (const v of violations) {
      console.error(`  [${v.source}:${v.line}] "${v.text}"`);
    }
    console.error('');
    console.error(
      "GitHub's merge-time parser matches close[sd]?/fix(es|ed)?/resolve[sd]? followed by #<number>" +
        ' as a bare substring, with no awareness of negation, quotation, or tense — see'
    );
    console.error(
      '.claude/skills/agentic-autonomous-pipeline/references/keyword-closing-postmortem.md'
    );
    console.error('');
    console.error(
      'Fix: rephrase so the keyword and the number are not adjacent, or wrap the whole phrase in a' +
        ' code span. The exempt shape is a line that is exactly `Closes #<N>` (or Fixes/Resolves),' +
        ' optionally behind a conventional-commit type — `fix: Resolve #<N>`. Nothing else on that' +
        ' line. A PR title needs no directive at all: the pipeline writes `<type>: <summary> (#<N>)`' +
        ' and closes the issue from the body.'
    );
    process.exitCode = 1;
    return;
  }

  console.log('Closing-keyword guard: clean.');
}

if (require.main === module) {
  main();
}

module.exports = {
  CLOSING_KEYWORD_RE,
  COMMIT_TYPE_PREFIX,
  SANCTIONED_LINE_RE,
  findClosingKeywordViolations,
  stripCodeSpans,
};
