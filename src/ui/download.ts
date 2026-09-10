/**
 * Triggers a browser download for in-memory content, with no server round-trip: a
 * temporary object URL and anchor, clicked programmatically then discarded. Shared by
 * every export feature (#67/#68) so there is exactly one place that does this.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked after the click rather than immediately: revoking before the browser has
  // started the download would turn it into a broken link.
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, text: string, mimeType: string): void {
  downloadBlob(filename, new Blob([text], { type: mimeType }));
}
