export interface GameModule {
  name: string;
  init(): void | Promise<void>;
  onTick?(event: import('@stock-survival/shared').TickEvent): void | Promise<void>;
  onPriceTick?(event: import('@stock-survival/shared').TickEvent): void | Promise<void>;
  onSurvivalTick?(event: import('@stock-survival/shared').TickEvent): void | Promise<void>;
}

export class ModuleRegistry {
  private modules: GameModule[] = [];

  register(module: GameModule): void {
    this.modules.push(module);
  }

  getAll(): GameModule[] {
    return this.modules;
  }

  /** Removes every registered module (used when re-bootstrapping in tests). */
  clear(): void {
    this.modules = [];
  }

  async initAll(): Promise<void> {
    for (const mod of this.modules) {
      await mod.init();
    }
  }
}

export const moduleRegistry = new ModuleRegistry();
