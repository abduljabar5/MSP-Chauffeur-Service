// List Bookings - Admin endpoint that returns all booking records
// from the 'bookings' Netlify Blob store. V2 (modern) function syntax
// is required so the Netlify runtime auto-injects Blobs context.
import crypto from 'crypto';
import { getStore } from '@netlify/blobs';

function tokensMatch(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (_) { return false; }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export default async (req, context) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const expected = process.env.CANCEL_ADMIN_TOKEN;
  if (!expected) {
    return jsonResponse(500, { error: 'CANCEL_ADMIN_TOKEN not configured' });
  }
  if (!tokensMatch(token, expected)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  try {
    const store = getStore('bookings');
    const { blobs } = await store.list();
    const records = await Promise.all(
      (blobs || []).map(async (b) => {
        try {
          const rec = await store.get(b.key, { type: 'json' });
          if (!rec) return null;
          return {
            confirmationNumber: rec.confirmationNumber || b.key,
            createdAt: rec.createdAt || null,
            cancelled: !!rec.cancelled,
            cancelledAt: rec.cancelledAt || null,
            cancelReason: rec.cancelReason || null,
            booking: {
              name: rec.booking?.name || '',
              email: rec.booking?.email || '',
              phone: rec.booking?.phone || '',
              date: rec.booking?.date || '',
              time: rec.booking?.time || '',
              pickup: rec.booking?.pickup || '',
              dropoff: rec.booking?.dropoff || '',
              vehicle: rec.booking?.vehicle || '',
              passengers: rec.booking?.passengers || '',
              total: rec.booking?.total || 0,
              paymentMethod: rec.booking?.paymentMethod || '',
              roundTrip: !!rec.booking?.roundTrip,
              returnDate: rec.booking?.returnDate || '',
              returnTime: rec.booking?.returnTime || ''
            }
          };
        } catch (e) {
          console.error('Failed to load blob', b.key, e);
          return null;
        }
      })
    );

    const list = records.filter(Boolean);
    return jsonResponse(200, { count: list.length, bookings: list });
  } catch (e) {
    console.error('list-bookings error:', e);
    return jsonResponse(500, { error: e.message });
  }
};
