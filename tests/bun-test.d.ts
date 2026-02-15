declare module "bun:test" {
  type TestFn = () => void | Promise<void>;
  type SuiteFn = () => void | Promise<void>;

  interface Matchers<T> {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    toContain(expected: string): void;
    toMatch(expected: RegExp | string): void;
    toBeNull(): void;
    toThrow(expected?: unknown): void;
    not: Matchers<T>;
  }

  export function expect<T>(actual: T): Matchers<T>;
  export function describe(name: string, fn: SuiteFn): void;
  export function it(name: string, fn: TestFn): void;
  export { it as test };
}
