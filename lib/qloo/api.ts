import "server-only";

import type { QlooSource } from "./source";

export const NOT_IMPLEMENTED = "not implemented until probe runs";

/**
 * The real Qloo source. Deliberately a stub until the probe has recorded Qloo's response shapes;
 * docs/after-key.md lists every assumption to check before filling this in. When it is built,
 * every call must go through qlooGet in ./client.
 */
export class QlooApiSource implements QlooSource {
  readonly mock = false;

  async searchEntities(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async candidates(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async heatmap(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async places(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async brands(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
