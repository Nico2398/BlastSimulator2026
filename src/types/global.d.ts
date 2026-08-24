import type { probeUiActions, probeSelector } from '../ui/uiActionProbe.js';

declare global {
  interface Window {
    __gameConsole: (cmd: string) => import('../console/ConsoleRunner.js').CommandResult;
    __gameState: () => Record<string, unknown> | null;
    __uiState: () => Record<string, unknown>;
    __cameraOrbit: (yaw: number, pitch: number) => void;
    __cameraFocus: (x: number, z: number, distance: number) => void;
    __cameraReset: () => void;
    __skipBlastPlayback: () => void;
    __seekBlastPlayback: (t: number) => void;
    __blastPlaybackDuration: () => number;
    __startTutorial: () => void;
    __uiActions: () => ReturnType<typeof probeUiActions>;
    __probeSelector: (selector: string) => ReturnType<typeof probeSelector>;
    __tutorialState: () => { active: boolean; stepIndex: number; stepId: string | null; title: string; total: number; stageIndex: number; stageTotal: number; stageTarget: string | null; clockHeld: boolean };
    __resetTickAccumulator: () => void;
    __setAutoTick: (enabled: boolean) => void;
    __setRenderEnabled: (enabled: boolean) => void;
    __renderFrame: () => void;
    __debugGridInfo: () => Record<string, unknown>;
    __entityWorldPosition: (kind: 'building' | 'vehicle' | 'employee' | 'fragment', id: number) => { x: number; z: number } | null;
    /** Scenario-harness hooks for the P3 in-scene placement tool — see PlacementController.paintRect for why this bypasses real pointer events. */
    __placement: {
      isArmed: () => boolean;
      /**
       * 'confirmed' is the 220ms confirm-flash window (PlacementController's
       * CONFIRM_FLASH_MS) between a successful confirm() and its scheduled
       * disarm() — isArmed() is still true throughout it, indistinguishable
       * from a fresh, correctly-staying-armed tool without this. The
       * interaction harness polls this to wait out that specific window
       * before arming a different build type, instead of racing a setTimeout
       * with a fixed frame count that cannot see it.
       */
      currentPhase: () => string;
      paintRect: (x1: number, z1: number, x2: number, z2: number) => void;
      confirm: () => void;
      cancel: () => void;
    };
    /** World tile → screen pixel, for interaction mode's real clicks on the P3 placement canvas (unlike __placement, which scenario-mode uses directly). */
    __worldToScreen: (x: number, z: number) => { px: number; py: number; onScreen: boolean } | null;
    /**
     * Preview the loading screen without running a real (multi-second,
     * main-thread-blocking) level load — the visual-testing scenario has no
     * other deterministic way to see it (#493). `kind` picks a campaign level
     * or a sandbox site; `locale` optionally renders it in the other
     * language, restored once the synchronous `show()` call returns.
     */
    __loadingScreenPreview: (kind?: 'level' | 'sandbox', locale?: 'en' | 'fr') => void;
    __loadingScreenHide: () => void;
  }
}

export {};
