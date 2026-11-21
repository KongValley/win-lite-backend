export const MIN_NODE_VERSION = Object.freeze([18, 2, 0] as const);
export const MIN_NODE_VERSION_STRING = MIN_NODE_VERSION.join('.');

export interface NodeSupport {
  readonly version: string;
  readonly minimum: string;
  readonly supported: boolean;
}

export function compareVersions(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a > b) {
      return 1;
    }
    if (a < b) {
      return -1;
    }
  }
  return 0;
}

export function getNodeSupport(version = process.versions.node): NodeSupport {
  const parsed = String(version)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);

  return {
    version,
    minimum: MIN_NODE_VERSION_STRING,
    supported: compareVersions(parsed, MIN_NODE_VERSION) >= 0,
  };
}

export function assertSupportedNodeVersion(): void {
  const support = getNodeSupport();
  if (!support.supported) {
    throw new Error(
      `Node.js ${MIN_NODE_VERSION_STRING}+ is required, current version is ${process.version}`,
    );
  }
}
