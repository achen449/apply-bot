export async function fetchJson(url, options = {}) {
  const { timeoutMs = 12000, ...fetchOptions } = options
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response
  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: fetchOptions.signal || controller.signal
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`)
      timeoutError.code = 'provider_request_timeout'
      throw timeoutError
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return response.json()
}
