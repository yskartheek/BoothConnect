export interface HealthCheck {
  readonly name: string;
  /** Resolves when the dependency is reachable; rejects otherwise. */
  check(): Promise<void>;
}

export const HEALTH_CHECKS = Symbol('HEALTH_CHECKS');
