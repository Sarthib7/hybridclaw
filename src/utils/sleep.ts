export async function sleep(ms: number): Promise<void> {
  const waitMs = Math.max(0, Math.floor(ms));
  if (waitMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}
