import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../src/console/ConsoleRunner.js';

describe('parseCommand — positional args', () => {
  it('parses a command with a single positional arg', () => {
    const result = parseCommand('survey 25,30');
    expect(result.command).toBe('survey');
    expect(result.args).toEqual(['25,30']);
    expect(result.namedArgs).toEqual({});
  });

  it('parses a command with no args', () => {
    const result = parseCommand('blast');
    expect(result.command).toBe('blast');
    expect(result.args).toEqual([]);
    expect(result.namedArgs).toEqual({});
  });

  it('parses a command with multiple positional args', () => {
    const result = parseCommand('status scores');
    expect(result.command).toBe('status');
    expect(result.args).toEqual(['scores']);
  });
});

describe('parseCommand — named args', () => {
  it('parses named args from charge command', () => {
    const result = parseCommand('charge hole:1 explosive:tnt amount:5kg');
    expect(result.command).toBe('charge');
    expect(result.namedArgs).toEqual({
      hole: '1',
      explosive: 'tnt',
      amount: '5kg',
    });
    expect(result.args).toEqual([]);
  });

  it('parses mixed positional and named args', () => {
    const result = parseCommand('drill_plan grid origin:20,25 rows:3 cols:4 spacing:3 depth:8');
    expect(result.command).toBe('drill_plan');
    expect(result.args).toEqual(['grid']);
    expect(result.namedArgs).toEqual({
      origin: '20,25',
      rows: '3',
      cols: '4',
      spacing: '3',
      depth: '8',
    });
  });

  it('handles wildcard named arg value', () => {
    const result = parseCommand('charge hole:* explosive:pop_rock amount:3kg stemming:1.5m');
    expect(result.namedArgs['hole']).toBe('*');
    expect(result.namedArgs['stemming']).toBe('1.5m');
  });
});

describe('parseCommand — edge cases', () => {
  it('trims leading/trailing whitespace', () => {
    const result = parseCommand('  blast  ');
    expect(result.command).toBe('blast');
  });

  it('returns empty command for blank input', () => {
    const result = parseCommand('');
    expect(result.command).toBe('');
    expect(result.args).toEqual([]);
  });
});
