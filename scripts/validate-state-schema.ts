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
import { resolve } from 'path';

interface SchemaField {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
  optional?: boolean;
  description?: string;
}

type Schema = Record<string, SchemaField | Schema>;

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

// Core game state schema — extend this as the game evolves
const GAME_STATE_SCHEMA: Schema = {
  gameTime: { type: 'number', description: 'Elapsed game ticks' },
  money: { type: 'number', description: 'Current funds' },
  score: { type: 'number', description: 'Level score' },
  holeCount: { type: 'number', optional: true },
  chargedCount: { type: 'number', optional: true },
  sequencedCount: { type: 'number', optional: true },
  employees: { type: 'number', optional: true },
  vehicles: { type: 'number', optional: true },
  morale: { type: 'number', optional: true },
  corruption: { type: 'number', optional: true },
  ecology: { type: 'number', optional: true },
  safety: { type: 'number', optional: true },
  level: { type: 'number', optional: true },
  phase: { type: 'string', optional: true },
  weather: { type: 'string', optional: true },
  vibrationBudget: { type: 'number', optional: true },
  warningCount: { type: 'number', optional: true },
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

function parseArgs(): { path?: string; dir?: string } {
  const args = process.argv.slice(2);
  let path: string | undefined;
  let dir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--state' && args[i + 1]) {
      path = resolve(process.cwd(), args[i + 1]);
      i++;
    } else if (args[i] === '--dir' && args[i + 1]) {
      dir = resolve(process.cwd(), args[i + 1]);
      i++;
    }
  }

  return { path, dir };
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
        .filter(f => f.endsWith('.json'))
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
            .filter(f => f.endsWith('.json') && f !== 'report.json')
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

main();
