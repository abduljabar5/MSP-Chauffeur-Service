# MSP Chauffeur Service

Static marketing and booking site for MSP Chauffeur Service, a black car and airport transfer company serving Minneapolis–Saint Paul.

## Stack

- Static HTML pages styled with Tailwind (Play CDN, palette in `tw-config.js`) and `site.css`
- `app.js` — shared pricing engine, quote widget, Google Maps autocomplete and routing
- `functions/` — Netlify Functions for booking processing (Resend email, Twilio SMS), Stripe Checkout, and the admin dashboard
- `images/` — fleet renders and site photography

## Local development

```bash
npm install
cp .env.example .env   # fill in keys
npm run dev            # netlify dev on http://localhost:8888
```

The Google Maps browser key must allow `http://localhost:8888/*` under its website restrictions for autocomplete and routing to work locally.

## Environment

See `.env.example` for every variable. Production values are set in the Netlify dashboard, not committed.
