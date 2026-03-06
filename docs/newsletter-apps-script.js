/**
 * Google Apps Script - ClawLite newsletter collector
 *
 * Setup:
 * 1) Create a Google Sheet with headers: [email, source, subscribedAt]
 * 2) Open Extensions -> Apps Script
 * 3) Paste this file and save
 * 4) Deploy as Web App (access: Anyone)
 * 5) Set the deployed URL as NEWSLETTER_SCRIPT_URL in your environment
 */

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSheet()
  const payload = JSON.parse(e.postData.contents || '{}')
  const email = payload.email || ''
  const source = payload.source || 'web'

  if (!email || !email.includes('@')) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'invalid email' }))
      .setMimeType(ContentService.MimeType.JSON)
  }

  const values = sheet.getDataRange().getValues()
  const exists = values.some((row, idx) => idx > 0 && row[0] === email)
  if (!exists) {
    sheet.appendRow([email, source, new Date().toISOString()])
  }

  return ContentService.createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON)
}
