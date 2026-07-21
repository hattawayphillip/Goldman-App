// Base ID is already filled in — it's your real "Goldman Equipment" base.
// You only need to paste in your own Personal Access Token; see
// ../SETUP.md for exactly where to generate one.
window.AIRTABLE_CONFIG = {
  baseId: 'appyVjlwJwGvYf7Xe',
  token: 'PASTE_YOUR_PERSONAL_ACCESS_TOKEN_HERE',
  tables: {
    categories: 'Categories',
    equipment: 'Equipment',
    attachments: 'Attachments',
    promotions: 'Promotions',
    siteSettings: 'SiteSettings',
    quoteRequests: 'QuoteRequests'
  }
};
