/** Starts a browser download of local text. Returns the byte size; it cannot know whether the file was saved. */
export function downloadText(filename: string, text: string, mimeType: string): number {
  const bytes = new TextEncoder().encode(text);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return bytes.length;
}

/** Derives a safe download base name from the source name. */
export function baseName(sourceName: string): string {
  const withoutExtension = sourceName.replace(/\.(csv|txt|json)$/i, '');
  const safe = withoutExtension.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe.length > 0 ? safe.slice(0, 80) : 'feed';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
