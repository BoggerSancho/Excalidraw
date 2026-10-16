/**
 * Excalidraw keeps some behaviour out of its public API. These helpers reach it through the
 * React fiber tree of a DOM node it rendered. Callers must cope with finding nothing, since
 * an Excalidraw or React upgrade can change what's there.
 */
export type FiberNode = {
  return: FiberNode | null;
  memoizedProps?: Record<string, unknown> | null;
  stateNode?: unknown;
};

/** The node's own fiber and every fiber above it, nearest first. */
export function* fiberAncestors(node: Element): Generator<FiberNode> {
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
  let fiber = key ? ((node as unknown as Record<string, FiberNode | undefined>)[key] ?? null) : null;
  for (; fiber; fiber = fiber.return) yield fiber;
}

/** Excalidraw's `App` class instance, which owns the scene and most editor behaviour. */
export function findExcalidrawApp(root: HTMLElement): object | null {
  const node = root.querySelector(".excalidraw");
  if (!node) return null;
  for (const fiber of fiberAncestors(node)) {
    const instance = fiber.stateNode;
    if (instance && typeof instance === "object" && "scene" in instance && "actionManager" in instance) return instance;
  }
  return null;
}
