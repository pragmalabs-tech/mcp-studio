import type { Session } from "@/lib/recorder/schema";

const TESTS_STORAGE_KEY = "mcp-studio-tests";

export interface SavedTest {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  session: Session;
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
