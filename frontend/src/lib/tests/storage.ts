import type { Session } from "@/lib/recorder/schema";
import type { TestAssertionConfig } from "@/lib/assertion";

const TESTS_STORAGE_KEY = "mcp-studio-tests";

export interface SavedTest {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  session: Session;
  /**
   * Per-test assertion config. Optional — when absent every action falls
   * back to its `AssertablePoint.defaultMode` and state falls back to
   * `"exact"`, preserving the pre-v2 replay behavior.
   */
  assertions?: TestAssertionConfig;
}

export function saveTest(test: SavedTest): void {
  const tests = loadTests();
  tests.push(test);
  localStorage.setItem(TESTS_STORAGE_KEY, JSON.stringify(tests));
}

export function loadTests(): SavedTest[] {
  const stored = localStorage.getItem(TESTS_STORAGE_KEY);
  if (!stored) return [];

  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function deleteTest(id: string): void {
  const tests = loadTests();
  const filtered = tests.filter((t) => t.id !== id);
  localStorage.setItem(TESTS_STORAGE_KEY, JSON.stringify(filtered));
}

export function getTest(id: string): SavedTest | undefined {
  const tests = loadTests();
  return tests.find((t) => t.id === id);
}

/**
 * Replace the `assertions` field on a saved test. Both the test detail
 * view and the replay result dialog write through this helper, so the
 * source of truth stays the single localStorage entry.
 */
export function updateTestAssertions(
  testId: string,
  cfg: TestAssertionConfig,
): void {
  const tests = loadTests();
  const idx = tests.findIndex((t) => t.id === testId);
  if (idx === -1) return;
  tests[idx] = { ...tests[idx], assertions: cfg };
  localStorage.setItem(TESTS_STORAGE_KEY, JSON.stringify(tests));
}
