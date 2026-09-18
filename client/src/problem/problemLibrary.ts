export interface VerificationTest {
  name: string;
  input?: unknown[];
  expected?: unknown;
  assertion: 'equals' | 'contains' | 'raises';
}

export interface ProblemDefinition {
  problemId: string;
  version: string;
  title: string;
  description: string;
  buggyCode: string;
  expectedBehavior: string;
  hiddenVerificationTests: VerificationTest[];
  bugCategory: 'off_by_one' | 'control_flow' | 'variable_scope' | 'string_handling' | 'logic_error';
  difficulty: 'easy' | 'medium' | 'hard';
  pedagogicalMetadata?: {
    learningGoal?: string;
    misconception?: string;
    hintStrategy?: string;
    targetConcepts?: string[];
  };
}

export const sampleProblem: ProblemDefinition = {
  problemId: 'p_01',
  version: '1.0.0',
  title: 'Sum of Evens',
  description: 'Write a function that returns the sum of all even numbers from 1 to n inclusive.',
  buggyCode: `
def sum_even_numbers(n):
    total = 0
    for i in range(1, n + 1):
        if i % 2 == 0:
            total += i
    return total
`,
  expectedBehavior: 'Returns the sum of even integers from 2 to n inclusive.',
  hiddenVerificationTests: [
    { name: 'n=5', input: [5], expected: 6, assertion: 'equals' },
    { name: 'n=10', input: [10], expected: 30, assertion: 'equals' },
    { name: 'n=1', input: [1], expected: 0, assertion: 'equals' },
  ],
  bugCategory: 'off_by_one',
  difficulty: 'easy',
  pedagogicalMetadata: {
    learningGoal: 'Understand inclusive bounds and loop iteration logic',
    misconception: 'Students may include 1 or skip the final even number',
    hintStrategy: 'Focus on the loop bounds and the modulo condition',
    targetConcepts: ['range', 'modulo', 'loops'],
  },
};
