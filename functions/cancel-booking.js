// Cancel Booking - Owner-initiated cancellation flow.
// Looks up the booking record from Netlify Blobs, cancels scheduled reminder
// emails (Resend) and SMS (Twilio), sends cancellation notifications to
// customer and owner, and marks the record as cancelled.
// The Stripe refund is intentionally manual (left to the owner).
import crypto from 'crypto';
import { getStore } from '@netlify/blobs';

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'tcblackcar@gmail.com'; // override via env
const OWNER_PHONE = process.env.OWNER_PHONE || '+16126665004'; // dispatch line; override via env
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'bookings@tcblackcar.com'; // must be on a domain verified in Resend
const FROM_NAME = 'MSP Chauffeur Service';
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER || '+16129991462'; // set TWILIO_FROM_NUMBER in env

// ----- Auth -----
// Constant-time comparison so brute-force timing attacks aren't possible.
function tokensMatch(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (_) { return false; }
}

// ----- Resend / Twilio cancellation helpers -----
async function cancelResendEmail(apiKey, emailId) {
  if (!emailId) return { status: 'no_id' };
  try {
    const r = await fetch(`https://api.resend.com/emails/${emailId}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (r.ok) return { status: 'cancelled' };
    if (r.status === 404) return { status: 'not_found', error: `id ${emailId} not found in Resend` };
    const txt = await r.text();
    console.error(`Resend cancel failed for ${emailId}: HTTP ${r.status} ${r.statusText} - ${txt}`);
    return { status: 'failed', error: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
  } catch (e) {
    console.error('Resend cancel error:', e);
    return { status: 'error', error: e.message };
  }
}

async function cancelTwilioMessage(accountSid, authToken, messageSid) {
  if (!messageSid) return { status: 'no_sid' };
  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ Status: 'canceled' })
    });
    if (r.ok) return { status: 'cancelled' };
    const txt = await r.text();
    console.error('Twilio cancel failed:', messageSid, r.status, txt);
    return { status: 'failed', error: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
  } catch (e) {
    console.error('Twilio cancel error:', e);
    return { status: 'error', error: e.message };
  }
}

// ----- Cancellation email/SMS templates -----
function generateCustomerCancelHtml(rec, reason) {
  const b = rec.booking || {};
  const reasonBlock = reason
    ? `<div style="background-color: #1a1a1a; border-left: 3px solid #D4AF37; padding: 15px 20px; margin: 20px 0;">
         <div style="color: #D4AF37; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Reason</div>
         <div style="color: #ffffff; font-size: 14px;">${escapeHtml(reason)}</div>
       </div>` : '';
  const refundBlock = b.paymentMethod === 'online'
    ? `<p style="color: #a0a0a0; font-size: 14px; line-height: 1.6;">If you paid online, your refund will appear on your card within 5–10 business days.</p>` : '';
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0d0d0d;">
    <div style="background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%); padding: 40px 30px; text-align: center; border-bottom: 2px solid #D4AF37;">
        <div style="color: #D4AF37; font-size: 28px; font-weight: 700; letter-spacing: 2px; margin-bottom: 10px;">MSP Chauffeur Service</div>
        <div style="color: #ffffff; font-size: 18px;">Booking Cancelled</div>
    </div>
    <div style="padding: 30px; color: #ffffff;">
        <div style="font-size: 22px; font-weight: 600; margin-bottom: 15px;">Hi ${escapeHtml(b.name || '')},</div>
        <div style="color: #a0a0a0; font-size: 15px; line-height: 1.6; margin-bottom: 25px;">
            Your booking with MSP Chauffeur Service has been cancelled. Confirmation number <strong style="color: #D4AF37;">${escapeHtml(rec.confirmationNumber)}</strong>.
        </div>
        ${reasonBlock}
        <div style="background-color: #1a1a1a; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid #333;">
            <div style="color: #D4AF37; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">Original Trip</div>
            <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 6px 0; color: #888; width: 35%;">When</td><td style="padding: 6px 0; color: #fff;">${escapeHtml(b.date || '')} at ${escapeHtml(b.time || '')}</td></tr>
                <tr><td style="padding: 6px 0; color: #888;">Pickup</td><td style="padding: 6px 0; color: #fff;">${escapeHtml(b.pickup || '')}</td></tr>
                <tr><td style="padding: 6px 0; color: #888;">Dropoff</td><td style="padding: 6px 0; color: #fff;">${escapeHtml(b.dropoff || '')}</td></tr>
                <tr><td style="padding: 6px 0; color: #888;">Vehicle</td><td style="padding: 6px 0; color: #fff;">${escapeHtml(b.vehicle || '')}</td></tr>
            </table>
        </div>
        ${refundBlock}
        <div style="text-align: center; padding: 25px 0; border-top: 1px solid #333; margin-top: 25px;">
            <div style="color: #ffffff; font-size: 15px; margin-bottom: 8px;">Need to rebook or have questions?</div>
            <a href="tel:6126665004" style="color: #D4AF37; font-size: 22px; font-weight: 700; text-decoration: none;">(612) 666-5004</a>
        </div>
    </div>
    <div style="background-color: #1a1a1a; padding: 20px; text-align: center; border-top: 1px solid #333;">
        <div style="color: #D4AF37; font-size: 14px; font-weight: 600;">MSP Chauffeur Service</div>
        <div style="color: #666; font-size: 12px; margin-top: 5px;">Premium Transportation in the Twin Cities</div>
    </div>
</div>`;
}

function generateCustomerCancelText(rec, reason) {
  const b = rec.booking || {};
  return [
    `Hi ${b.name || ''},`,
    ``,
    `Your booking with MSP Chauffeur Service has been cancelled.`,
    `Confirmation: ${rec.confirmationNumber}`,
    ``,
    reason ? `Reason: ${reason}` : '',
    reason ? `` : '',
    `Original trip:`,
    `When: ${b.date || ''} at ${b.time || ''}`,
    `Pickup: ${b.pickup || ''}`,
    `Dropoff: ${b.dropoff || ''}`,
    `Vehicle: ${b.vehicle || ''}`,
    ``,
    b.paymentMethod === 'online' ? `If you paid online, your refund will appear within 5-10 business days.` : '',
    b.paymentMethod === 'online' ? `` : '',
    `Need to rebook or have questions? Call (612) 666-5004.`,
    ``,
    `— MSP Chauffeur Service`
  ].filter(Boolean).join('\n');
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ----- Handler (V2 syntax — required for Netlify Blobs auto-context) -----
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Auth
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const expected = process.env.CANCEL_ADMIN_TOKEN;
  if (!expected) {
    return jsonResponse(500, { error: 'CANCEL_ADMIN_TOKEN not configured' });
  }
  if (!tokensMatch(token, expected)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  // Parse input
  let payload;
  try { payload = await req.json(); } catch (_) { return jsonResponse(400, { error: 'Invalid JSON' }); }
  const confirmationNumber = String(payload.confirmationNumber || '').trim().toUpperCase();
  const reason = String(payload.reason || '').trim().slice(0, 500);
  if (!confirmationNumber) {
    return jsonResponse(400, { error: 'Missing confirmation number' });
  }

  // Look up booking
  const store = getStore('bookings');
  let rec;
  try {
    rec = await store.get(confirmationNumber, { type: 'json' });
  } catch (e) {
    console.error('Blob lookup error:', e);
    return jsonResponse(500, { error: 'Lookup failed' });
  }
  if (!rec) {
    return jsonResponse(404, { error: `No booking found for ${confirmationNumber}` });
  }
  if (rec.cancelled) {
    return jsonResponse(200, {
      ok: true,
      already: true,
      message: `Booking ${confirmationNumber} was already cancelled at ${rec.cancelledAt}.`
    });
  }

  const customer = rec.booking || {};
  const customerPhone = (customer.phone || '').startsWith('+')
    ? customer.phone
    : '+1' + (customer.phone || '').replace(/\D/g, '');

  // Cancel scheduled reminders in parallel
  const reminderResults = await Promise.all(
    (rec.scheduledItems || []).map(async (item) => {
      if (item.kind === 'email') {
        const r = await cancelResendEmail(process.env.RESEND_API_KEY, item.id);
        return { purpose: item.purpose, kind: 'email', id: item.id, result: r.status, error: r.error || null };
      }
      if (item.kind === 'sms') {
        const r = await cancelTwilioMessage(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, item.sid);
        return { purpose: item.purpose, kind: 'sms', sid: item.sid, result: r.status, error: r.error || null };
      }
      return { purpose: item.purpose || 'unknown', result: 'skipped' };
    })
  );

  // Send cancellation notifications in parallel
  const customerHtml = generateCustomerCancelHtml(rec, reason);
  const customerText = generateCustomerCancelText(rec, reason);

  const customerEmailPromise = (async () => {
    if (!process.env.RESEND_API_KEY || !customer.email) return 'skipped';
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${FROM_NAME} <${FROM_EMAIL}>`,
          to: [customer.email],
          reply_to: OWNER_EMAIL,
          subject: `Your ride has been cancelled — ${rec.confirmationNumber}`,
          html: customerHtml,
          text: customerText,
          headers: { 'X-Entity-Ref-ID': rec.confirmationNumber }
        })
      });
      return r.ok ? 'sent' : 'failed';
    } catch (e) { console.error('Customer cancel email error:', e); return 'error'; }
  })();

  const customerSmsPromise = (async () => {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !customerPhone) return 'skipped';
    const reasonLine = reason ? `\nReason: ${reason}` : '';
    const refundLine = customer.paymentMethod === 'online' ? `\nOnline payments refund within 5-10 business days.` : '';
    const body = `MSP Chauffeur Service\n\nYour booking #${rec.confirmationNumber} for ${customer.date || ''} at ${customer.time || ''} has been cancelled.${reasonLine}${refundLine}\n\nQuestions? (612) 666-5004`;
    try {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: TWILIO_FROM, To: customerPhone, Body: body })
      });
      return r.ok ? 'sent' : 'failed';
    } catch (e) { console.error('Customer cancel SMS error:', e); return 'error'; }
  })();

  const ownerSmsPromise = (async () => {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return 'skipped';
    const body = `🚫 BOOKING CANCELLED\n\n#${rec.confirmationNumber}\n${customer.name || ''}\n${customer.date || ''} at ${customer.time || ''}\n${customer.pickup || ''} → ${customer.dropoff || ''}${customer.paymentMethod === 'online' ? '\n\n⚠️ REFUND THE PAYMENT IN STRIPE' : ''}`;
    try {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: TWILIO_FROM, To: OWNER_PHONE, Body: body })
      });
      return r.ok ? 'sent' : 'failed';
    } catch (e) { console.error('Owner cancel SMS error:', e); return 'error'; }
  })();

  const [customerEmailResult, customerSmsResult, ownerSmsResult] = await Promise.all([
    customerEmailPromise, customerSmsPromise, ownerSmsPromise
  ]);

  // Mark the booking record as cancelled (keep record for history)
  rec.cancelled = true;
  rec.cancelledAt = new Date().toISOString();
  rec.cancelReason = reason || null;
  rec.cancellationResults = {
    customerEmail: customerEmailResult,
    customerSms: customerSmsResult,
    ownerSms: ownerSmsResult,
    reminders: reminderResults
  };
  try {
    await store.setJSON(confirmationNumber, rec);
  } catch (e) {
    console.error('Failed to update record after cancel:', e);
  }

  return jsonResponse(200, {
    ok: true,
    confirmationNumber,
    customer: { name: customer.name, email: customer.email, phone: customer.phone },
    results: rec.cancellationResults,
    stripeRefundReminder: customer.paymentMethod === 'online'
      ? 'This booking was paid online — issue the refund manually in Stripe Dashboard.'
      : null
  });
};
