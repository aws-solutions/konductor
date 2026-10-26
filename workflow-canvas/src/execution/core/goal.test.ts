// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { GOAL_MAX_LENGTH, goalProblem } from './goal';

describe('goalProblem', () => {
  it('accepts a sentence', () => {
    expect(goalProblem('Add a greeting to the README')).toBeUndefined();
  });

  it.each(['', '   ', '\t\n'])('asks for a goal when it is %j', (goal) => {
    expect(goalProblem(goal)).toBe('Enter a goal to run.');
  });

  it('accepts a goal of the most characters', () => {
    expect(goalProblem('x'.repeat(GOAL_MAX_LENGTH))).toBeUndefined();
  });

  it('refuses a goal of one character more', () => {
    expect(goalProblem('x'.repeat(GOAL_MAX_LENGTH + 1))).toBe(
      'The goal can have at most 2048 characters.',
    );
  });

  it('counts a character outside the basic plane once, as the API does', () => {
    // Each of these is two UTF-16 units but one character.
    expect(goalProblem('😀'.repeat(GOAL_MAX_LENGTH))).toBeUndefined();
    expect(goalProblem('😀'.repeat(GOAL_MAX_LENGTH + 1))).toBeDefined();
  });
});
