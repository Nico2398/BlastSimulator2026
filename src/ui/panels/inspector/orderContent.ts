/** Inspector content for pending-order selections (#2266): what the order is, and how to cancel it. */
import { t } from '../../../core/i18n/I18n.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { isAutoDebrisAction } from '../../../core/economy/HaulDispatch.js';
import { actionOrderCost, linkedActionIds } from '../../../core/engine/TaskCancellation.js';
import type { GameState, PendingAction } from '../../../core/state/GameState.js';
import { button } from '../../dom.js';
import { ACTION_LABEL_KEY } from '../../crewDetailSections.js';
import { buildBlockedOrderMessage, isFailureBlock } from '../../notify/blockedOrders.js';
import type { InspectorLinks, KindContent } from './InspectorContent.js';
import { detailBody, kindLabel, noteLine, sectionOf, syncSection, tagged, valueRow } from './inspectorWidgets.js';

const STATUS_KEY = {
  queued: 'ui.operations.work_queue_status_queued',
  assigned: 'ui.operations.work_queue_status_assigned',
  in_progress: 'ui.operations.work_queue_status_in_progress',
} as const;

const SMALL_BTN_STYLE = 'height:24px;padding:0 10px;font:600 10px/1 var(--bsx-font-mono)';

/** True for actions the engine owns (rest, auto-generated debris orders): never player-cancellable. */
export function isEngineOwnedAction(action: PendingAction): boolean {
  return action.type === 'rest' || isAutoDebrisAction(action.type);
}

/** A ramp's segments exist only as part of the ramp: its one cancel removes the whole order. */
function isLinkedOnly(action: PendingAction): boolean {
  return action.type === 'dig_ramp_segment';
}

export function cancelCommand(action: PendingAction): string {
  return isLinkedOnly(action) ? `employee cancel ${action.id} all` : `employee cancel ${action.id}`;
}

/** What one press of the main Cancel pays back: the whole ramp for a segment, the order itself otherwise. */
function refundOf(action: PendingAction, state: GameState): number {
  if (!isLinkedOnly(action)) return actionOrderCost(action);
  let sum = 0;
  for (const id of linkedActionIds(state, action)) {
    const linked = state.pendingActions.find(a => a.id === id);
    if (linked !== undefined) sum += actionOrderCost(linked);
  }
  return sum;
}

/** The cancel controls for `action` (Cancel, Cancel all N, or the managed-automatically note), shared with the hole inspector. */
export function orderControls(action: PendingAction, state: GameState, links: InspectorLinks): HTMLElement[] {
  if (isEngineOwnedAction(action)) return [tagged(noteLine(t('inspector.order.managed')), 'data-order-managed')];
  const label = t(isLinkedOnly(action) ? 'inspector.order.cancel_whole' : 'ui.operations.work_queue_cancel');
  const cancel = button('danger', label);
  cancel.style.cssText = SMALL_BTN_STYLE;
  cancel.setAttribute('data-order-cancel', String(action.id));
  cancel.addEventListener('click', () => links.run(cancelCommand(action)));
  const controls: HTMLElement[] = [cancel];
  const linkedCount = linkedActionIds(state, action).length;
  if (!isLinkedOnly(action) && linkedCount > 1) {
    const all = button('danger', t('ui.operations.work_queue_cancel_all', { count: linkedCount }));
    all.style.cssText = SMALL_BTN_STYLE;
    all.setAttribute('data-order-cancel-all', String(action.id));
    all.addEventListener('click', () => links.run(`employee cancel ${action.id} all`));
    controls.push(all);
  }
  return controls;
}

/** Queued / walking / working, or why nobody works it. */
function statusText(action: PendingAction, state: GameState): string {
  if (action.status === 'queued') {
    const preview = state.ghostPreviews.find(g => g.id === action.id);
    if (preview?.unreachable === true || action.blockedReason === 'debris_out_of_reach') {
      return t('ui.operations.work_queue_status_stranded');
    }
    if (action.blockedReason != null && isFailureBlock(action)) {
      return t('inspector.order.status_blocked', { reason: buildBlockedOrderMessage(action) });
    }
  }
  return t(STATUS_KEY[action.status]);
}

function holderText(action: PendingAction, state: GameState): string {
  if (action.holderId === null) return t('ui.operations.work_queue_holder_unclaimed');
  const holder = state.employees.employees.find(e => e.id === action.holderId);
  return holder?.name ?? t('ui.operations.work_queue_holder_unknown');
}

function buildFactsSection(action: PendingAction, state: GameState): HTMLElement {
  const rows: HTMLElement[] = [
    valueRow(t('inspector.order.kind'), t(ACTION_LABEL_KEY[action.type])),
    tagged(valueRow(t('inspector.order.status'), statusText(action, state)), 'data-order-status', action.status),
    valueRow(t('inspector.order.holder'), holderText(action, state)),
    valueRow(t('inspector.order.location'), t('ui.crew.location_coords', { x: action.targetX, z: action.targetZ })),
  ];
  if (!isEngineOwnedAction(action)) {
    rows.push(valueRow(t('inspector.order.refund'), t('inspector.order.refund_value', { amount: formatMoney(refundOf(action, state)) })));
  }
  return sectionOf(t('inspector.section.details'), rows);
}

function buildControlsSection(action: PendingAction, state: GameState, links: InspectorLinks): HTMLElement {
  const wrap = sectionOf(t('inspector.order.section.cancel'), orderControls(action, state, links));
  wrap.setAttribute('data-order-controls', '');
  return wrap;
}

export const orderContent: KindContent = {
  view(entity, state, links) {
    const action = state.pendingActions.find(a => a.id === entity.id);
    if (action === undefined) return null;
    const builders: Array<[string, () => HTMLElement]> = [
      ['bs-order-facts', () => buildFactsSection(action, state)],
      ['bs-order-controls', () => buildControlsSection(action, state, links)],
    ];
    return {
      title: t(ACTION_LABEL_KEY[action.type]),
      sub: `#${entity.id} · ${kindLabel('order')}`,
      icon: 'build',
      status: statusText(action, state),
      signature: `${action.id}:${action.status}:${action.holderId}:${action.blockedReason ?? ''}`,
      get sections() {
        const body = detailBody('bs-order-detail');
        for (const [className, make] of builders) {
          const node = make();
          node.classList.add(className);
          body.append(node);
        }
        return [body];
      },
      actions: [],
      sync: root => {
        const body = root.querySelector<HTMLElement>('.bs-order-detail');
        if (!body) return;
        for (const [className, make] of builders) syncSection(body, className, make);
      },
    };
  },
};
