import fetch from 'node-fetch';

/**
 * Emit a settlement webhook.
 * The webhook URL is taken from the environment variable WEBHOOK_URL.
 * Payload is whatever is passed; callers should ensure it matches the
 * expected schema for settlement events.
 */
export async function emitSettlementWebhook(payload: Record<string, unknown>): Promise<void> {
  const url = process.env.WEBHOOK_URL;
  if (!url) return; // No webhook configured – silently ignore.
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Webhook failed with status ${resp.status}: ${text}`);
  }
}
