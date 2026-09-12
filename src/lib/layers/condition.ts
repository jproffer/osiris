import { coerce } from './format';
import type { Condition } from './types';

function present(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

/**
 * One predicate, shared by popup `when` clauses and variant filters, so there
 * is a single set of coercion rules rather than two that can disagree.
 * Clauses AND together; `not` inverts the result.
 */
export function evaluate(cond: Condition, props: Record<string, unknown>): boolean {
  const raw = props[cond.property];
  let ok = true;

  if (cond.exists !== undefined) ok = ok && present(raw) === cond.exists;

  if (cond.truthy !== undefined) {
    const c = coerce(raw);
    ok = ok && (present(c) && c !== false && c !== 0) === cond.truthy;
  }

  if (cond.equals !== undefined) ok = ok && coerce(raw) === cond.equals;

  if (cond.in !== undefined) ok = ok && cond.in.some(v => v === coerce(raw));

  return cond.not ? !ok : ok;
}
