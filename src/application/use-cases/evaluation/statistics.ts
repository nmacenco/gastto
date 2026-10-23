export function rate(numerator: number, denominator: number) {
  return { numerator, denominator, value: denominator ? numerator / denominator : null };
}
// Descriptive binomial interval only; related synthetic examples are not IID samples.
export function wilsonInterval(successes: number, total: number) {
  if (!total) return null;
  const z = 1.96,
    p = successes / total,
    divisor = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / divisor;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / divisor;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    confidence: 0.95,
    method: 'wilson-descriptive',
  };
}
export function percentile(values: number[], p: number): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * p) - 1]! : null;
}
