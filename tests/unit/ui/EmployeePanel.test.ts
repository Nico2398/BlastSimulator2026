// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EmployeePanel } from '../../../src/ui/EmployeePanel.js';

describe('EmployeePanel', () => {
  it('should exist and be constructable', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new EmployeePanel(container);
    expect(panel).toBeDefined();
    panel.dispose();
  });
});
