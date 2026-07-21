export function normalizeCaptureUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  if (!hasScheme && /^[/?#]/.test(trimmed)) return null;

  try {
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || !url.hostname
      || url.username
      || url.password
    ) {
      return null;
    }
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return null;
  }
}
