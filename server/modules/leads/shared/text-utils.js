export function normalizeKey(value = '') {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function titleCase(value = '') {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function slugify(value = '') {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function dedupeStrings(values) {
  return [...new Set((values || []).filter(Boolean))]
}

export function truncateText(value = '', maxLength = 320) {
  if (!value) {
    return ''
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value
}

export function cleanDomain(value = '') {
  return value
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .trim()
}

export function stripTrackingParams(url = '') {
  try {
    const parsed = new URL(url)
    ;['srsltid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((key) => parsed.searchParams.delete(key))
    return parsed.toString()
  } catch {
    return url
  }
}

export function toRootCompanyUrl(url = '') {
  try {
    const parsed = new URL(stripTrackingParams(url))
    const path = parsed.pathname || '/'
    const shallowIdentityPath = /^\/(|en|de|fr|about|about-us|company|contact)\/?$/i.test(path)

    if (shallowIdentityPath) {
      parsed.pathname = path || '/'
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString()
    }

    parsed.pathname = '/'
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return stripTrackingParams(url)
  }
}
