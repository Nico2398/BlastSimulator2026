// @vitest-environment jsdom
// Portrait tiles (#2241): one builder for the inspector header and every grid card.
import { describe, it, expect } from 'vitest';
import {
  buildingPortraitSpec, employeePortraitSpec, portraitEl, rolePortraitSpec, vehiclePortraitSpec,
} from '../../../src/ui/portraits.js';
import { thumbnailUrl } from '../../../src/renderer/models/Thumbnails.js';

describe('portrait specs', () => {
  it('employees use their role model, tinted backdrop in the role colour', () => {
    const spec = employeePortraitSpec({ role: 'driver', name: 'Gus Pickaxe' });
    expect(spec.id).toBe('worker_driver');
    expect(spec.accent).toBe('#ffcc00');
    expect(spec.monogram).toBe('GP');
    expect(spec.state).toBe('none');
  });

  it('a role picture carries no per-person state', () => {
    expect(rolePortraitSpec('manager', 'Manager')).toEqual({ id: 'worker_manager', accent: '#aa55dd', alt: 'Manager' });
  });

  it('vehicles differ by tier and wear', () => {
    expect(vehiclePortraitSpec('rock_digger', 2, 'x').id).toBe('vehicle_rock_digger_t2');
    expect(vehiclePortraitSpec('rock_digger', 2, 'x', 0.5).state).toBe('none');
    expect(vehiclePortraitSpec('rock_digger', 2, 'x', 0.1).state).toBe('wrecked');
  });

  it('a single-tier building always shows its one model, without a tier badge', () => {
    const spec = buildingPortraitSpec('spoil_heap', 3, 'Spoil Heap');
    expect(spec.id).toBe('building_spoil_heap_t1');
    expect(spec.badge).toBeUndefined();
    expect(buildingPortraitSpec('geology_lab', 2, 'Lab').badge).toBe('T2');
    expect(buildingPortraitSpec('geology_lab', 2, 'Lab', 0).state).toBe('destroyed');
  });
});

describe('portraitEl', () => {
  it('renders the thumbnail, the badges and readable hooks', () => {
    const tile = portraitEl(employeePortraitSpec({ role: 'driller', name: 'Nick Rubble', injured: true }), 56);
    expect(tile.dataset['portrait']).toBe('worker_driller');
    expect(tile.dataset['state']).toBe('injured');
    expect(tile.getAttribute('aria-label')).toBe('Nick Rubble');
    expect(tile.querySelector('img')!.getAttribute('src')).toBe(thumbnailUrl('worker_driller'));
    expect(tile.querySelector('.bsx-portrait-monogram')!.textContent).toBe('NR');
    expect(tile.querySelector('.bsx-portrait-state')).not.toBeNull();
    expect(tile.classList.contains('bsx-portrait-56')).toBe(true);
  });

  it('draws no state mark for a healthy subject', () => {
    expect(portraitEl(vehiclePortraitSpec('drill_rig', 1, 'Rig'), 72).querySelector('.bsx-portrait-state')).toBeNull();
  });
});
