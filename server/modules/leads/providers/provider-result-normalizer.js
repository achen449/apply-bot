function normalizeQueryLabel(queryConfig, fallbackLabel = 'company') {
  if (typeof queryConfig === 'string') {
    return fallbackLabel
  }

  return queryConfig?.label || fallbackLabel
}

export function getQueryText(queryConfig) {
  return typeof queryConfig === 'string' ? queryConfig : queryConfig?.query || ''
}

export function buildProviderSearchResult(provider, queryConfig, fields = {}) {
  return {
    provider,
    query: getQueryText(queryConfig),
    queryLabel: normalizeQueryLabel(queryConfig),
    capturedAt: new Date().toISOString(),
    title: fields.title || '',
    url: fields.url || '',
    snippet: fields.snippet || '',
    rawContent: fields.rawContent || fields.snippet || '',
    metadata: fields.metadata || {},
    ...fields.extra
  }
}
