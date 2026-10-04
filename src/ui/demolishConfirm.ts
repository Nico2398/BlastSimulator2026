// Demolish confirmation modal config (#1399).

import type { Building } from '../core/entities/Building.js';
import type { ConfirmModalConfig } from './panels/ConfirmModal.js';

/** Build the confirm-modal config for demolishing `b`; `onConfirm` runs the demolition. */
export function buildDemolishConfirm(b: Building, onConfirm: () => void): ConfirmModalConfig {
  void b;
  void onConfirm;
  // TODO: implement
  return undefined as unknown as ConfirmModalConfig;
}
