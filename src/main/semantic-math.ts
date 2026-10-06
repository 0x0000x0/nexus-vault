export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na2 = 0;
  let nb2 = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na2 += a[i] * a[i];
    nb2 += b[i] * b[i];
  }
  if (na2 === 0 || nb2 === 0) return 0;
  return dot / (Math.sqrt(na2) * Math.sqrt(nb2));
}
