/** Recognize only supported HTTPS Google file links and bounded provider IDs. */
export function googleSpreadsheetFileId(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:') return null;
    let id: string | null = null;
    if (url.hostname === 'docs.google.com') {
      id = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)(?:\/|$)/)?.[1] ?? null;
    } else if (url.hostname === 'drive.google.com') {
      id = url.pathname.match(/^\/file\/d\/([^/]+)(?:\/|$)/)?.[1] ?? null;
      if (id === null && url.pathname === '/open') id = url.searchParams.get('id');
    }
    return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function looksLikeWebLink(raw: string): boolean {
  return /^https?:\/\//i.test(raw.trim());
}
