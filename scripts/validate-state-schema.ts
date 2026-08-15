/**
 * BlastSimulator2026 — State JSON Schema Validator
 *
 * Validates game state dumps (from scenario-test.ts) against a schema
 * definition to catch unexpected field types, missing fields, or drift.
 *
 * Usage:
 *   npx tsx scripts/validate-state-schema.ts --state path/to/state.json
 *   npx tsx scripts/validate-state-schema.ts --dir screenshots/scenario-blast-basic
 *
 * Schema rules:
 *   Each known field has a type, optionality, and optional value constraints.
 *   Unknown fields are reported as warnings (possible schema drift).
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { basename, resolve } from 'path';

interface SchemaField {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
  optional?: boolean;
  description?: string;
}

type Schema = Record<string, SchemaField | Record<string, SchemaField>>;

interface ValidationError {
  path: string;
  field: string;
  expectedType: string;
  actualValue: unknown;
  message: string;
}

interface ValidationWarning {
  path: string;
  field: string;
  message: string;
}

interface ValidationResult {
  file: string;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  pass: boolean;
}

/**
 * Game state schema — mirrors `SerializableGameState` in src/console-api.ts,
 * which is what both `serializeGameState()` (command mode) and
 * `window.__gameState()` (interaction mode) emit.
 *
 * Keep in lockstep with that interface. `tests/unit/console-api.test.ts`
 * asserts the emitted field set, so a field added there without a matching
 * entry here shows up as drift rather than passing silently.
 */
export const GAME_STATE_SCHEMA: Schema = {
  seed: { type: 'number', description: 'PRNG seed the game was created with' },
  time: { type: 'number', description: 'Elapsed game time' },
  tickCount: { type: 'number', description: 'Simulation ticks elapsed' },
  isPaused: { type: 'boolean' },
  timeScale: { type: 'number', description: 'Simulation speed multiplier (1/2/4/8) set by `time speed`' },
  mineType: { type: 'string', description: 'Terrain preset identifier' },
  weather: { type: 'string', optional: true, description: 'Current weather state (WeatherCycle.ts); null until ctx.weatherCycle exists' },
  worldSizeX: { type: 'number', optional: true, description: 'Live world bounding box (#473)' },
  worldSizeZ: { type: 'number', optional: true },
  worldMinX: { type: 'number', optional: true },
  worldMinZ: { type: 'number', optional: true },
  drillHoles: { type: 'array' },
  chargesByHole: { type: 'object' },
  sequenceDelays: { type: 'object' },
  finances: { type: 'object', description: 'Finance sub-state; cash mirrors the flat field' },
  holeCount: { type: 'number' },
  orderedHoleCount: { type: 'number', description: 'Holes ordered but not yet drilled (state.plannedDrillHoles.length, #553)' },
  chargedCount: { type: 'number' },
  sequencedCount: { type: 'number' },
  surveyCount: { type: 'number', description: 'Completed survey results (state.surveyResults.length)' },
  pendingActionCount: { type: 'number', description: 'Queued-but-not-yet-claimed PendingActions, including auto-inserted rest tasks (state.pendingActions.length)' },
  buildingCount: { type: 'number' },
  vehicleCount: { type: 'number' },
  employeeCount: { type: 'number' },
  qualificationCount: { type: 'number', description: 'Qualifications held across the whole roster' },
  proficiencyTotal: { type: 'number', description: 'Sum of every held qualification\'s proficiency level' },
  trainingCount: { type: 'number', description: 'Employees currently enrolled in training' },
  collapsedCount: { type: 'number', description: 'Employees currently in the collapsing state' },
  minFatigue: { type: 'number', description: 'Lowest fatigue (0-100, 100=rested) across the roster — closest employee to collapse, 100 with none' },
  stuckEmployeeCount: { type: 'number', description: 'Employees currently in the isMoveStuck state — pathfinding failed STUCK_THRESHOLD consecutive times' },
  activeContractCount: { type: 'number', description: 'Contracts currently accepted and in progress (state.contracts.active)' },
  deathCount: { type: 'number', description: 'Employees killed so far (state.damage.deathCount)' },
  levelEnded: { type: 'boolean' },
  levelEndReason: { type: 'string', optional: true, description: 'null while the level runs' },
  bankrupt: { type: 'boolean', description: 'Loss condition' },
  revolted: { type: 'boolean', description: 'Loss condition' },
  ecologicalShutdown: { type: 'boolean', description: 'Loss condition' },
  arrested: { type: 'boolean', description: 'Loss condition' },
  cash: { type: 'number' },
  profit: { type: 'number', description: 'Total wealth accumulated this level' },
  wellBeing: { type: 'number', description: '0-100 score (ScoreState)' },
  safety: { type: 'number', description: '0-100 score (ScoreState)' },
  ecology: { type: 'number', description: '0-100 score (ScoreState)' },
  nuisance: { type: 'number', description: '0-100 score (ScoreState)' },
  muckPile: { type: 'object', optional: true, description: 'Fragment size, speed and clearance spread after a blast' },
  storedMassKg: { type: 'number', description: 'Mass held in warehouse storage (LogisticsState.storedMassKg)' },
};

/** UI state schema — mirrors window.__uiState() in src/main.ts. */
export const UI_STATE_SCHEMA: Schema = {
  panels: { type: 'object', description: 'Per-panel visibility and pointer-events' },
  blastPanelButtons: { type: 'array', description: 'Blast panel controls with computed styles' },
};

function validateValue(
  path: string, value: unknown, schema: SchemaField | Schema, errors: ValidationError[],
): void {
  if ('type' in schema) {
    const field = schema as SchemaField;
    if (value === null || value === undefined) {
      if (!field.optional) {
        errors.push({
          path,
          field: path.split('.').pop() || '',
          expectedType: field.type,
          actualValue: value,
          message: `Required field is null/undefined (expected ${field.type})`,
        });
      }
      return;
    }

    const actualType = Array.isArray(value) ? 'array' : typeof value;

    if (field.type === 'any') return;

    if (actualType !== field.type) {
      errors.push({
        path,
        field: path.split('.').pop() || '',
        expectedType: field.type,
        actualValue: value,
        message: `Type mismatch: expected ${field.type}, got ${actualType} (${JSON.stringify(value).substring(0, 50)})`,
      });
    }

    return;
  }

  // Nested object schema
  if (typeof value === 'object' && value !== null) {
    validateObject(path, value as Record<string, unknown>, schema as Schema, errors);
  }
}

function validateObject(
  basePath: string, obj: Record<string, unknown>, schema: Schema, errors: ValidationError[],
): void {
  for (const [key, fieldSchema] of Object.entries(schema)) {
    const fieldPath = basePath ? `${basePath}.${key}` : key;
    validateValue(fieldPath, obj[key], fieldSchema as SchemaField | Schema, errors);
  }
}

function checkUnknownFields(
  basePath: string,
  obj: Record<string, unknown>,
  schema: Schema,
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  for (const [key] of Object.entries(obj)) {
    if (!(key in schema)) {
      warnings.push({
        path: basePath,
        field: key,
        message: `Unknown field in state — possible schema drift or new feature without schema update`,
      });
    }
  }
  return warnings;
}

function validateStateFile(filePath: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    // Unwrap scenario step wrapper if present
    const state = data.gameState ?? data;

    if (typeof state !== 'object' || state === null) {
      errors.push({
        path: '',
        field: 'root',
        expectedType: 'object',
        actualValue: state,
        message: 'State root is not an object',
      });
      return { file: filePath, errors, warnings, pass: false };
    }

    // Validate known fields
    validateObject('', state, GAME_STATE_SCHEMA, errors);

    // Check for unknown fields (warnings)
    const unknownWarnings = checkUnknownFields('', state, GAME_STATE_SCHEMA);
    warnings.push(...unknownWarnings);

    // Interaction-mode dumps carry UI state alongside game state
    if (typeof data.uiState === 'object' && data.uiState !== null) {
      const uiState = data.uiState as Record<string, unknown>;
      validateObject('uiState', uiState, UI_STATE_SCHEMA, errors);
      warnings.push(...checkUnknownFields('uiState', uiState, UI_STATE_SCHEMA));
    }

  } catch (err: any) {
    errors.push({
      path: '',
      field: 'file',
      expectedType: 'valid JSON',
      actualValue: err.message,
      message: `Failed to parse state file: ${err.message}`,
    });
  }

  return {
    file: filePath,
    errors,
    warnings,
    pass: errors.length === 0,
  };
}

/**
 * Per-step state dumps only. `report.json` is a run summary with a different
 * shape — validating it against the state schema reports every step index as
 * an unknown field.
 */
function isStateDump(fileName: string): boolean {
  return fileName.endsWith('.json') && fileName !== 'report.json';
}

function parseArgs(): { path?: string; dir?: string } {
  const args = process.argv.slice(2);
  let path: string | undefined;
  let dir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--state' && args[i + 1]) {
      path = resolve(process.cwd(), args[i + 1]!);
      i++;
    } else if (args[i] === '--dir' && args[i + 1]) {
      dir = resolve(process.cwd(), args[i + 1]!);
      i++;
    }
  }

  return {
    ...(path !== undefined ? { path } : {}),
    ...(dir !== undefined ? { dir } : {}),
  };
}

function main(): void {
  const { path: singlePath, dir } = parseArgs();
  const files: string[] = [];

  if (singlePath) {
    if (existsSync(singlePath)) files.push(singlePath);
  } else if (dir) {
    if (existsSync(dir)) {
      const entries = readdirSync(dir);
      files.push(...entries
        .filter(f => isStateDump(f))
        .map(f => resolve(dir, f))
        .filter(f => statSync(f).isFile())
      );
    }
  } else {
    // Default: validate all scenario outputs
    const scenariosDir = resolve(process.cwd(), 'screenshots');
    if (existsSync(scenariosDir)) {
      const scenarios = readdirSync(scenariosDir);
      for (const scenario of scenarios) {
        const scenarioDir = resolve(scenariosDir, scenario);
        if (statSync(scenarioDir).isDirectory()) {
          const entries = readdirSync(scenarioDir);
          files.push(...entries
            .filter(f => isStateDump(f))
            .map(f => resolve(scenarioDir, f))
          );
        }
      }
    }
  }

  if (files.length === 0) {
    console.log('No state files found to validate.');
    process.exit(0);
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  let passCount = 0;
  let failCount = 0;

  for (const file of files) {
    const result = validateStateFile(file);
    if (result.pass) {
      passCount++;
    } else {
      failCount++;
    }
    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;

    for (const err of result.errors) {
      console.log(`ERROR [${file}] ${err.path}: ${err.message}`);
    }
    for (const warn of result.warnings) {
      console.log(`WARN  [${file}] ${warn.path}.${warn.field}: ${warn.message}`);
    }
  }

  console.log(`\n--- State Schema Validation ---`);
  console.log(`Files: ${files.length}, Pass: ${passCount}, Fail: ${failCount}`);
  console.log(`Errors: ${totalErrors}, Warnings: ${totalWarnings}`);

  if (failCount > 0 || totalErrors > 0) {
    process.exit(1);
  }
}

// Run only when invoked directly — importing the schema must not scan the disk.
if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main();
}
