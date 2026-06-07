import { fetchText } from '../../../../infrastructure/http/fetch-text.js'
import { dedupeStrings } from '../../shared/text-utils.js'

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

function extractEmailsFromHtml(html = '') {
  const textContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')

  const foundEmails = textContent.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []
  return dedupeStrings(foundEmails)
    .filter((email) => !email.match(/\.(png|jpg|gif|css|js)$/i))
    .slice(0, 3)
}

export async function scrapeWebsiteEmails(url = '') {
  if (!url) {
    return []
  }

  try {
    const html = await fetchText(url, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT
      }
    })

    return extractEmailsFromHtml(html)
  } catch (error) {
    console.error(`Failed to scrape emails from ${url}:`, error.message)
    return []
  }
}
