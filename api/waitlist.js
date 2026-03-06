import { list, put } from '@vercel/blob'

const BLOB_FILENAME = 'waitlist-emails.json'

async function getEmails() {
  const { blobs } = await list({ prefix: BLOB_FILENAME })
  if (blobs.length === 0) return []
  const res = await fetch(blobs[0].downloadUrl)
  return res.json()
}

async function putEmails(emails) {
  await put(BLOB_FILENAME, JSON.stringify(emails), {
    contentType: 'application/json',
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0
  })
}

const ALLOWED_ORIGINS = ['https://clawlite.ai', 'https://www.clawlite.ai']

export default async function handler(req, res) {
  const origin = req.headers.origin
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email } = req.body || {}
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' })
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.log('WAITLIST_EMAIL:', email)
    return res.status(200).json({ success: true })
  }

  try {
    const emails = await getEmails()
    if (emails.some((e) => e.email === email)) {
      return res.status(200).json({ success: true })
    }
    emails.push({ email, registeredAt: new Date().toISOString() })
    await putEmails(emails)
    return res.status(200).json({ success: true })
  } catch (e) {
    console.error('Blob error:', e)
    return res.status(500).json({ error: 'Server error. Please try again later.' })
  }
}
