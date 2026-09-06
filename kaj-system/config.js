/* ==========================================================================
   Kaj System – site configuration
   Everything a non-developer might want to change lives here: contact
   details, prices, links, the estimator's numbers and the testimonials.
   Edit this file, save, redeploy. No build step required.
   ========================================================================== */
window.KAJ_CONFIG = {
  brand: {
    name: 'Kaj System',
    tagline: 'App & software studio',
    // Public site URL – used for SEO tags and the sitemap.
    url: 'https://kajsystem.com',
    founded: 2026,
  },

  contact: {
    email: 'hello@kaj-consulting.com',
    // International format, digits only (used for the WhatsApp link).
    whatsapp: '',
    // A booking link (Calendly, Cal.com, Google Calendar…). Leave empty to hide.
    bookingUrl: '',
    // Contact form endpoint. Create a free form at https://formspree.io and
    // paste the endpoint here (e.g. 'https://formspree.io/f/abcdwxyz').
    // While empty, the form opens the visitor's email client instead.
    formEndpoint: '',
    location: 'Remote-first · Serving clients worldwide',
  },

  social: {
    linkedin: '',
    twitter: '',
    instagram: '',
    github: 'https://github.com/jkabore97',
  },

  // Prices are shown as "from $X". Currency symbol is applied by the site.
  currency: { symbol: '$', code: 'USD' },
  pricing: {
    website: 490,
    webapp: 1900,
    mobile: 3900,
    care: 49, // per month
  },

  // Interactive estimator. Base price per platform, then add-ons.
  estimator: {
    base: {
      website: { price: 490, weeks: 2 },
      webapp: { price: 1900, weeks: 5 },
      mobile: { price: 3900, weeks: 8 },
    },
    addons: {
      accounts: { price: 300, weeks: 0.5 },
      payments: { price: 500, weeks: 1 },
      admin: { price: 600, weeks: 1 },
      chat: { price: 700, weeks: 1 },
      push: { price: 250, weeks: 0.5 },
      i18n: { price: 350, weeks: 0.5 },
      offline: { price: 600, weeks: 1 },
      ai: { price: 800, weeks: 1 },
      design: { price: 400, weeks: 1 },
    },
    // Rush delivery multiplier (price up, weeks down).
    rush: { price: 1.3, weeks: 0.7 },
    // Range shown around the estimate (e.g. 0.15 = ±15 %).
    spread: 0.15,
  },

  // Real client quotes go here. The section is hidden while the list is empty.
  // { quote: '…', name: 'Jane Doe', role: 'Founder, Acme', avatar: 'JD' }
  testimonials: [],
};
