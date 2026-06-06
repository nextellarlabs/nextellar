// routes-d/lib/sponsorshipTracker.ts
// Simple in‑memory tracker for the number of accounts funded per day.
// The counter resets at midnight UTC each day.

let currentDay: string = new Date().toISOString().slice(0, 10); // YYYY‑MM‑DD
let fundedCount = 0;

function resetIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== currentDay) {
    currentDay = today;
    fundedCount = 0;
  }
}

export const sponsorshipTracker = {
  /** Return the current funded count for today (after resetting if day changed). */
  getCount(): number {
    resetIfNewDay();
    return fundedCount;
  },
  /** Increment the count and return the new total. */
  increment(): number {
    resetIfNewDay();
    fundedCount += 1;
    return fundedCount;
  },
  /** Reset the counter manually (useful for tests). */
  reset(): void {
    fundedCount = 0;
    currentDay = new Date().toISOString().slice(0, 10);
  },
};
