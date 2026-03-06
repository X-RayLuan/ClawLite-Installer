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

  const { email, source } = req.body || {}
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' })
  }

  const scriptUrl = process.env.NEWSLETTER_SCRIPT_URL
  if (!scriptUrl) {
    console.log('NEWSLETTER_EMAIL:', email, source)
    return res.status(200).json({ success: true })
  }

  try {
    const r = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source: source || 'app' }),
      redirect: 'follow'
    })
    const text = await r.text()
    try {
      return res.status(200).json(JSON.parse(text))
    } catch {
      return res.status(200).json({ success: true })
    }
  } catch (e) {
    console.error('Newsletter error:', e)
    return res.status(500).json({ error: 'Server error. Please try again later.' })
  }
}
