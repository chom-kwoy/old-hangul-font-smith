"use client";

export default async function schedulerYield() {
  if ("scheduler" in globalThis) {
    // @ts-expect-error scheduler is not defined in ts
    await globalThis.scheduler.yield();
  }
}
