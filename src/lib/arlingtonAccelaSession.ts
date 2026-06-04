/** Accela /api/scrape rejected a client session id (e.g. after scraper restart). */
export function isArlingtonAccelaStaleSessionScrapeError(message: string): boolean {
  const lower = `${message || ""}`.toLowerCase();
  return (
    /session not found/i.test(lower) ||
    /wrong id/i.test(lower) ||
    /stale client/i.test(lower) ||
    /other server instance/i.test(lower)
  );
}
