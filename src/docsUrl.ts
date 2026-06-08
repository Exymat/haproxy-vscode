/** Fragment id for a keyword, aligned with haproxy-dconv anchor rules. */
export function docsAnchor(keyword: string, chapter?: string): string {
  const anchor = chapter ? `${chapter}-${keyword}` : keyword;
  return encodeURIComponent(anchor);
}

export function configurationDocsUrl(version: string, keyword: string, chapter?: string): string {
  return `https://docs.haproxy.org/${version}/configuration.html#${docsAnchor(keyword, chapter)}`;
}
