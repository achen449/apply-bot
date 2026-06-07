export async function fetchText(url, options = {}) {
  const response = await fetch(url, options)
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return response.text()
}
