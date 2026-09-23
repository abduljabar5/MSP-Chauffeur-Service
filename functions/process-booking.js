// Process Booking - Sends email, SMS, reminders, and review requests
// Uses Resend for emails, Twilio for SMS
import { getStore } from '@netlify/blobs';

// ========================================
// UTILITY FUNCTIONS
// ========================================

function parseBookingDateTime(dateStr, timeStr) {
  const months = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
  const datePart = dateStr.replace(/^[A-Za-z]+,\s*/, '');
  const dateMatch = datePart.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!dateMatch) return null;
  const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!timeMatch) return null;
  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);
  const period = timeMatch[3].toUpperCase();
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return new Date(parseInt(dateMatch[3], 10), months[dateMatch[1]], parseInt(dateMatch[2], 10), hours, minutes, 0);
}

function centralToUTCISO(localDate) {
  const year = localDate.getFullYear();
  const marchSecondSunday = new Date(year, 2, 1);
  marchSecondSunday.setDate(1 + (7 - marchSecondSunday.getDay()) % 7 + 7);
  const novFirstSunday = new Date(year, 10, 1);
  novFirstSunday.setDate(1 + (7 - novFirstSunday.getDay()) % 7);
  const isDST = localDate >= marchSecondSunday && localDate < novFirstSunday;
  const offsetHours = isDST ? 5 : 6;
  const utc = new Date(localDate.getTime() + offsetHours * 60 * 60 * 1000);
  return utc.toISOString();
}

function generateCalendarLink(booking, estimatedMinutes) {
  const bookingDate = parseBookingDateTime(booking.date, booking.time);
  if (!bookingDate) return '';
  const endDate = new Date(bookingDate.getTime() + estimatedMinutes * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const text = encodeURIComponent(`Town Car Service - ${booking.pickup} → ${booking.dropoff}`);
  const dates = `${fmt(bookingDate)}/${fmt(endDate)}`;
  const details = encodeURIComponent(`Confirmation: ${booking.confirmationNumber}\nVehicle: ${booking.vehicle}\nPickup: ${booking.pickup}\nDropoff: ${booking.dropoff}\nTotal: $${booking.total}\n\nQuestions? Call (612) 666-5004`);
  const location = encodeURIComponent(booking.pickup);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&amp;text=${text}&amp;dates=${dates}&amp;details=${details}&amp;location=${location}&amp;ctz=America/Chicago`;
}

async function scheduleSmsTwilio(accountSid, authToken, messagingServiceSid, to, body, sendAt) {
  const twilioAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${twilioAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ MessagingServiceSid: messagingServiceSid, To: to, Body: body, ScheduleType: 'fixed', SendAt: sendAt })
  });
  if (!response.ok) return { status: 'failed', sid: null };
  try {
    const data = await response.json();
    return { status: 'scheduled', sid: data.sid || null };
  } catch (e) {
    return { status: 'scheduled', sid: null };
  }
}

async function scheduleReminderEmail(apiKey, fromEmail, fromName, toEmail, subject, html, text, scheduledAt, refId) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [toEmail],
      reply_to: 'tcblackcar@gmail.com',
      subject,
      html,
      text,
      scheduled_at: scheduledAt,
      headers: refId ? { 'X-Entity-Ref-ID': refId } : undefined
    })
  });
  if (!response.ok) return { status: 'failed', id: null };
  try {
    const data = await response.json();
    return { status: 'scheduled', id: data.id || null };
  } catch (e) {
    return { status: 'scheduled', id: null };
  }
}

// Strip HTML to a safe plain-text fallback (Resend includes both for deliverability).
function htmlToText(html) {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#9733;/g, '*')
    .replace(/&rarr;/g, '->')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ========================================
// MAIN BOOKING PROCESSOR
// ========================================
// Exported so both the HTTP handler and the Stripe webhook can call it.
// All independent I/O (emails, SMS, reminders) runs in parallel.

export async function processBooking(booking) {
  const OWNER_EMAIL = process.env.OWNER_EMAIL || 'tcblackcar@gmail.com'; // override via env
  const OWNER_PHONE = process.env.OWNER_PHONE || '+16126665004'; // dispatch line; override via env
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'bookings@mspairportchauffeur.com'; // must be on a domain verified in Resend
  const FROM_NAME = 'MSP Chauffeur Service';
  const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER || '+16129991462'; // set TWILIO_FROM_NUMBER in env

  // Format data
  const formattedTotal = '$' + (booking.total || 0);
  const formattedBase = '$' + (booking.baseFare || booking.total || 0);
  const formattedDiscount = '$' + (booking.discount || 0);
  const formattedTip = '$' + (booking.tip || 0);
  const formattedFee = '$' + (booking.processingFee || 0);
  const hasDiscount = (booking.discount || 0) > 0;
  const hasProcessingFee = (booking.processingFee || 0) > 0;
  const promoCode = booking.promoCode || '';
  const distance = booking.distance || 0;
  const estimatedMinutes = booking.duration || Math.round(distance * 1.5);

  const isRoundTrip = booking.roundTrip || false;
  const roundTripDiscount = booking.roundTripDiscount || 0;
  const formattedRoundTripDiscount = '$' + roundTripDiscount;
  const returnDate = booking.returnDate || '';
  const returnTime = booking.returnTime || '';
  const hasMeetAndGreet = booking.meetAndGreet || false;
  const meetAndGreetPrice = booking.meetAndGreetPrice || 15;
  const formattedMeetAndGreet = '$' + meetAndGreetPrice;
  const carSeats = parseInt(booking.carSeats) || 0;
  const carSeatsTotal = booking.carSeatsTotal || carSeats * 25;
  const carSeatsLabel = carSeats === 1 ? '1 car seat' : `${carSeats} car seats`;
  const formattedCarSeats = '$' + carSeatsTotal;
  const isHourly = booking.serviceType === 'hourly';
  const hours = parseInt(booking.hours) || 0;
  const stops = Array.isArray(booking.stops) ? booking.stops.filter(Boolean) : [];
  const stopsFee = booking.stopsFee || stops.length * 15;
  const formattedStopsFee = '$' + stopsFee;
  const serviceLine = isHourly ? `Hourly service · ${hours} hours · as directed` : '';

  const pickupLink = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(booking.pickup);
  const dropoffLink = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(booking.dropoff);

  const calendarLink = generateCalendarLink(booking, estimatedMinutes);
  const customerPhone = booking.phone.startsWith('+') ? booking.phone : '+1' + booking.phone.replace(/\D/g, '');

  // ----------------------------------------
  // Email task (Resend batch)
  // ----------------------------------------
  const emailTask = async () => {
    if (!process.env.RESEND_API_KEY) return 'skipped';
    const customerHtml = generateCustomerEmail(booking, formattedTotal, formattedBase, formattedDiscount, formattedTip, formattedFee, hasDiscount, hasProcessingFee, promoCode, distance, estimatedMinutes, pickupLink, dropoffLink, isRoundTrip, formattedRoundTripDiscount, returnDate, returnTime, hasMeetAndGreet, formattedMeetAndGreet, calendarLink);
    const ownerHtml = generateOwnerEmail(booking, formattedTotal, formattedBase, formattedDiscount, formattedTip, formattedFee, hasDiscount, hasProcessingFee, promoCode, distance, pickupLink, dropoffLink, isRoundTrip, formattedRoundTripDiscount, returnDate, returnTime, hasMeetAndGreet, formattedMeetAndGreet);
    const customerText = generateCustomerText(booking, formattedTotal, estimatedMinutes, isRoundTrip, returnDate, returnTime, hasMeetAndGreet, hasDiscount, formattedDiscount, promoCode);
    const ownerText = generateOwnerText(booking, formattedTotal, hasDiscount, formattedDiscount, promoCode, isRoundTrip, returnDate, returnTime, hasMeetAndGreet);
    const refId = booking.confirmationNumber || '';
    // Send the two emails as independent requests so a rejected customer address
    // (or a Resend sandbox restriction) can never suppress the owner alert.
    const sendOne = async (label, payload) => {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!r.ok) {
          console.error(`Resend ${label} email failed (${r.status}) from=${FROM_EMAIL} to=${payload.to}:`, await r.text());
          return 'failed';
        }
        return 'sent';
      } catch (e) {
        console.error(`Resend ${label} email error:`, e);
        return 'error';
      }
    };
    const [customer, owner] = await Promise.all([
      sendOne('customer', {
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [booking.email],
        reply_to: OWNER_EMAIL,
        subject: `Your ride is confirmed — ${booking.confirmationNumber || booking.date}`,
        html: customerHtml,
        text: customerText,
        headers: { 'X-Entity-Ref-ID': refId }
      }),
      sendOne('owner', {
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [OWNER_EMAIL],
        reply_to: booking.email,
        subject: `NEW BOOKING - ${booking.name} - ${booking.date}`,
        html: ownerHtml,
        text: ownerText,
        headers: { 'X-Entity-Ref-ID': refId }
      })
    ]);
    if (customer === 'sent' && owner === 'sent') return 'sent';
    if (customer !== 'sent' && owner !== 'sent') return customer === 'error' ? 'error' : 'failed';
    return `partial (customer: ${customer}, owner: ${owner})`;
  };

  // ----------------------------------------
  // SMS tasks (Twilio - customer + owner sent in parallel)
  // ----------------------------------------
  const smsTask = async () => {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      return { customer: 'skipped', owner: 'skipped' };
    }

    const roundTripLine = isRoundTrip ? `\n🔄 ROUND TRIP` : '';
    const returnLine = isRoundTrip && returnDate ? `\nRETURN: ${returnDate} at ${returnTime}` : '';
    const meetGreetLine = hasMeetAndGreet ? `\n👤 Meet & Greet included` : '';
    const carSeatLine = carSeats > 0 ? `\n🧒 ${carSeatsLabel} installed` : '';
    const hourlyLine = isHourly ? `\n⏱ HOURLY: ${hours} hours, as directed` : '';
    const stopsSmsLine = stops.length ? `\n📍 STOPS: ${stops.join(' → ')}` : '';
    const discountLine = hasDiscount ? `\nDiscount (${promoCode}): -${formattedDiscount}` : '';
    const customerSms = `MSP Chauffeur Service
━━━━━━━━━━━━━━━━━━

Booking Confirmed
#${booking.confirmationNumber}

WHEN: ${booking.date} at ${booking.time}

PICKUP: ${booking.pickup}

DROPOFF: ${booking.dropoff}
${hourlyLine}${stopsSmsLine}${roundTripLine}${returnLine}${meetGreetLine}${carSeatLine}${discountLine}
Total: ${formattedTotal}${booking.paymentMethod === 'online' ? ' (Paid)' : ''}

Your driver will arrive on time.
Questions? (612) 666-5004`;

    const ownerDiscountLine = hasDiscount ? `\n🏷️ DISCOUNT: -${formattedDiscount} (${promoCode})` : '';
    const ownerRoundTripLine = isRoundTrip ? `\n🔄 ROUND TRIP` : '';
    const ownerReturnLine = isRoundTrip && returnDate ? `\n🔙 RETURN: ${returnDate} at ${returnTime}` : '';
    const ownerMeetGreetLine = hasMeetAndGreet ? `\n👤 MEET & GREET (+${formattedMeetAndGreet})` : '';
    const ownerCarSeatLine = carSeats > 0 ? `\n🧒 CAR SEATS: ${carSeats} (+${formattedCarSeats})` : '';
    const ownerHourlyLine = isHourly ? `\n⏱ HOURLY: ${hours} HRS AS DIRECTED` : '';
    const ownerStopsLine = stops.length ? `\n📍 STOPS (+${formattedStopsFee}): ${stops.join(' → ')}` : '';
    const ownerSms = `🚨 NEW BOOKING 🚨

💰 FARE: ${formattedTotal}${ownerHourlyLine}${ownerStopsLine}${ownerDiscountLine}${ownerRoundTripLine}${ownerMeetGreetLine}${ownerCarSeatLine}
🗓️ WHEN: ${booking.date} at ${booking.time}${ownerReturnLine}

📍 PICKUP: ${booking.pickup}

🏁 DROPOFF: ${booking.dropoff}

👤 ${booking.name}
📞 ${booking.phone}
✉️ ${booking.email}

Vehicle: ${booking.vehicle}
Payment: ${booking.paymentMethod === 'online' ? 'Paid Online' : 'Cash'}${booking.flight ? `\nFlight: ${booking.flight}` : ''}${booking.notes ? `\nNotes: ${booking.notes}` : ''}`;

    const twilioAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const sendSms = (to, body) => fetch(twilioUrl, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${twilioAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: TWILIO_FROM, To: to, Body: body, ...(process.env.TWILIO_MESSAGING_SERVICE_SID ? { MessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID } : {}) })
    });

    try {
      const [customerRes, ownerRes] = await Promise.all([
        sendSms(customerPhone, customerSms),
        sendSms(OWNER_PHONE, ownerSms)
      ]);
      if (!customerRes.ok) console.error('Customer SMS failed:', await customerRes.text());
      if (!ownerRes.ok) console.error('Owner SMS failed:', await ownerRes.text());
      return {
        customer: customerRes.ok ? 'sent' : 'failed',
        owner: ownerRes.ok ? 'sent' : 'failed'
      };
    } catch (e) {
      console.error('SMS error:', e);
      return { customer: 'error', owner: 'error' };
    }
  };

  // ----------------------------------------
  // Reminders task (parallel scheduling of all reminders)
  // ----------------------------------------
  const remindersTask = async () => {
    if (!process.env.RESEND_API_KEY) return 'skipped';
    try {
      const bookingDate = parseBookingDateTime(booking.date, booking.time);
      if (!bookingDate) return 'parse_error';

      const now = new Date();
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const inWindow = (d) => d > now && (d.getTime() - now.getTime()) < THIRTY_DAYS_MS;
      const reminder24h = new Date(bookingDate.getTime() - 24 * 60 * 60 * 1000);
      const reminder1h = new Date(bookingDate.getTime() - 60 * 60 * 1000);
      const rideEnd = new Date(bookingDate.getTime() + (estimatedMinutes + 15) * 60 * 1000);
      const hasMessagingService = !!process.env.TWILIO_MESSAGING_SERVICE_SID;

      const refId = booking.confirmationNumber || '';
      // Each scheduling call returns {status, id|sid}. We tag the result with the
      // reminder type so the cancellation flow knows what each ID is for.
      const jobs = [];
      if (inWindow(reminder24h)) {
        const html24 = generateReminderEmail(booking, 'tomorrow', pickupLink);
        jobs.push(scheduleReminderEmail(process.env.RESEND_API_KEY, FROM_EMAIL, FROM_NAME, booking.email, `Ride reminder: tomorrow at ${booking.time}`, html24, htmlToText(html24), centralToUTCISO(reminder24h), refId)
          .then(r => ({ purpose: '24h_email', kind: 'email', id: r.id, status: r.status })));
      }
      if (inWindow(reminder1h)) {
        const html1 = generateReminderEmail(booking, 'in 1 hour', pickupLink);
        jobs.push(scheduleReminderEmail(process.env.RESEND_API_KEY, FROM_EMAIL, FROM_NAME, booking.email, `Ride reminder: ${booking.time} today`, html1, htmlToText(html1), centralToUTCISO(reminder1h), refId)
          .then(r => ({ purpose: '1h_email', kind: 'email', id: r.id, status: r.status })));
        if (hasMessagingService) {
          jobs.push(scheduleSmsTwilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, process.env.TWILIO_MESSAGING_SERVICE_SID, customerPhone, `MSP Chauffeur Service\n\nYour ride is in 1 hour!\n\n${booking.date} at ${booking.time}\nPickup: ${booking.pickup}\n\nQuestions? (612) 666-5004`, centralToUTCISO(reminder1h))
            .then(r => ({ purpose: '1h_sms', kind: 'sms', sid: r.sid, status: r.status })));
        }
      }
      if (inWindow(rideEnd)) {
        const htmlReview = generateReviewEmail(booking);
        jobs.push(scheduleReminderEmail(process.env.RESEND_API_KEY, FROM_EMAIL, FROM_NAME, booking.email, 'How was your ride with MSP Chauffeur Service?', htmlReview, htmlToText(htmlReview), centralToUTCISO(rideEnd), refId)
          .then(r => ({ purpose: 'review_email', kind: 'email', id: r.id, status: r.status })));
        if (hasMessagingService) {
          // TODO: replace with this brand's Google review link
          jobs.push(scheduleSmsTwilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, process.env.TWILIO_MESSAGING_SERVICE_SID, customerPhone, `Thanks for riding with MSP Chauffeur Service! We'd love your feedback:\n\nhttps://g.page/r/REPLACE_WITH_REVIEW_LINK/review\n\nIt takes less than a minute and means the world to us.`, centralToUTCISO(rideEnd))
            .then(r => ({ purpose: 'review_sms', kind: 'sms', sid: r.sid, status: r.status })));
        }
      }

      if (!jobs.length) return { summary: 'none_scheduled', items: [] };
      const items = await Promise.all(jobs);
      const summary = items.map(it => `${it.purpose}: ${it.status}`).join(', ');
      return { summary, items };
    } catch (e) {
      console.error('Reminder scheduling error:', e);
      return { summary: 'error', items: [] };
    }
  };

  // Run all top-level tasks in parallel
  const [email, sms, remindersResult] = await Promise.all([
    emailTask(),
    smsTask(),
    remindersTask()
  ]);
  const reminders = remindersResult.summary;

  // Persist a record of this booking in Netlify Blobs so the cancellation
  // function can look it up later by confirmation number and clean up
  // scheduled reminders.
  let stored = 'skipped';
  if (booking.confirmationNumber) {
    try {
      const store = getStore('bookings');
      await store.setJSON(booking.confirmationNumber, {
        confirmationNumber: booking.confirmationNumber,
        createdAt: new Date().toISOString(),
        cancelled: false,
        booking: {
          name: booking.name,
          email: booking.email,
          phone: booking.phone,
          date: booking.date,
          time: booking.time,
          pickup: booking.pickup,
          dropoff: booking.dropoff,
          vehicle: booking.vehicle,
          passengers: booking.passengers,
          total: booking.total,
          paymentMethod: booking.paymentMethod,
          roundTrip: booking.roundTrip,
          returnDate: booking.returnDate,
          returnTime: booking.returnTime,
          notes: booking.notes,
          flight: booking.flight,
          promoCode: booking.promoCode
        },
        scheduledItems: remindersResult.items || [],
        notificationResults: { email, sms, reminders }
      });
      stored = 'saved';
    } catch (e) {
      console.error('Blob store error:', e);
      stored = 'error';
    }
  }

  // ----------------------------------------
  // Backup alert: if BOTH owner email and owner SMS failed,
  // fire a one-line alert to OWNER_BACKUP_EMAIL so the booking isn't missed.
  // We don't trigger when channels are 'skipped' (intentionally not configured).
  // ----------------------------------------
  let backupAlert = 'not_needed';
  const ownerEmailDelivered = email === 'sent' || /owner: sent/.test(String(email));
  const ownerSmsDelivered = sms.owner === 'sent';
  const emailAttempted = email !== 'skipped';
  const smsAttempted = sms.owner !== 'skipped';

  if (emailAttempted && smsAttempted && !ownerEmailDelivered && !ownerSmsDelivered
      && process.env.OWNER_BACKUP_EMAIL && process.env.RESEND_API_KEY) {
    try {
      const alertHtml = `
<div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #b91c1c; margin-bottom: 8px;">⚠️ Booking notification failure</h2>
  <p>The booking below was confirmed (and charged, if online) but <strong>both the primary owner email and SMS failed to deliver</strong>. Customer notifications may have succeeded — see the function logs for details.</p>
  <table style="border-collapse: collapse; margin-top: 16px; font-size: 14px;">
    <tr><td style="padding: 4px 12px 4px 0; color: #555;">Confirmation:</td><td><strong>${booking.confirmationNumber || '(none)'}</strong></td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #555;">Name:</td><td>${booking.name || ''}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #555;">Phone:</td><td><a href="tel:${booking.phone}">${booking.phone || ''}</a></td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #555;">Email:</td><td>${booking.email || ''}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #555;">Date / Time:</td><td>${booking.date || ''} at ${booking.time || ''}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #555;">Pickup:</td><td>${booking.pickup || ''}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #555;">Dropoff:</td><td>${booking.dropoff || ''}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #555;">Vehicle:</td><td>${booking.vehicle || ''}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #555;">Total:</td><td>$${booking.total || 0}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #555;">Payment:</td><td>${booking.paymentMethod === 'online' ? 'Paid Online' : 'Pay Driver'}</td></tr>
  </table>
  <p style="margin-top: 16px; color: #555; font-size: 13px;">Delivery results — email: ${email}, owner SMS: ${sms.owner}. Check Netlify function logs for the underlying errors.</p>
</div>`;
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `${FROM_NAME} <${FROM_EMAIL}>`,
          to: [process.env.OWNER_BACKUP_EMAIL],
          reply_to: OWNER_EMAIL,
          subject: `⚠️ BOOKING ALERT - ${booking.confirmationNumber || 'unknown'} - notifications failed`,
          html: alertHtml,
          text: htmlToText(alertHtml),
          headers: { 'X-Entity-Ref-ID': booking.confirmationNumber || 'alert' }
        })
      });
      backupAlert = r.ok ? 'sent' : 'failed';
      if (!r.ok) console.error('Backup alert failed:', await r.text());
    } catch (e) {
      console.error('Backup alert error:', e);
      backupAlert = 'error';
    }
  }

  return { email, sms, reminders, backupAlert, stored };
}

// ========================================
// HTTP HANDLER (used by pay-driver flow)
// V2 syntax: required so the Netlify Blobs context is auto-injected
// (processBooking writes booking records to a Netlify Blobs store).
// ========================================

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

  try {
    const booking = await req.json();

    if (!booking.email || !booking.phone || !booking.pickup || !booking.dropoff) {
      return jsonResponse(400, { error: 'Missing required fields' });
    }

    const results = await processBooking(booking);

    return jsonResponse(200, {
      success: true,
      confirmationNumber: booking.confirmationNumber,
      results
    });
  } catch (error) {
    console.error('Process booking error:', error);
    return jsonResponse(500, { error: error.message });
  }
};

// ========================================
// EMAIL TEMPLATES
// ========================================

// Plain-text version of the customer confirmation. Sent alongside HTML so providers
// that demote HTML-only mail (notably Gmail) treat the message as legit.
function generateCustomerText(booking, total, estimatedMinutes, isRoundTrip, returnDate, returnTime, hasMeetAndGreet, hasDiscount, discount, promoCode) {
  const lines = [
    `Hi ${booking.name},`,
    ``,
    `Your ride with MSP Chauffeur Service is confirmed.`,
    ``,
    `Confirmation: ${booking.confirmationNumber || ''}`,
    `When: ${booking.date} at ${booking.time}`,
    booking.serviceType === 'hourly' ? `Service: Hourly, ${booking.hours} hours as directed` : '',
    `Pickup: ${booking.pickup}`,
    ...((Array.isArray(booking.stops) ? booking.stops : []).map((s, i) => `Stop ${i + 1}: ${s}`)),
    `Dropoff: ${booking.dropoff}`,
    isRoundTrip && returnDate ? `Return: ${returnDate} at ${returnTime}` : '',
    hasMeetAndGreet ? `Meet & Greet: included` : '',
    (parseInt(booking.carSeats) || 0) > 0 ? `Car seats: ${booking.carSeats} (installed before pickup)` : '',
    hasDiscount ? `Discount (${promoCode}): -${discount}` : '',
    `Vehicle: ${booking.vehicle}`,
    `Passengers: ${booking.passengers || '1'}`,
    `Estimated duration: ~${estimatedMinutes} min`,
    `Total: ${total} ${booking.paymentMethod === 'online' ? '(Paid online)' : '(Pay driver upon arrival)'}`,
    ``,
    `What to expect:`,
    `- Your driver will arrive on time at the pickup location.`,
    `- Look for a clean, professional vehicle.`,
    `- The driver may contact you when they arrive.`,
    ``,
    `Questions or changes? Call (612) 666-5004 or reply to this email.`,
    ``,
    `— MSP Chauffeur Service`,
    `https://mspairportchauffeur.com`
  ];
  return lines.filter(Boolean).join('\n');
}

// Plain-text version for the owner notification.
function generateOwnerText(booking, total, hasDiscount, discount, promoCode, isRoundTrip, returnDate, returnTime, hasMeetAndGreet) {
  const lines = [
    `NEW BOOKING — ${total} ${booking.paymentMethod === 'online' ? '(PAID ONLINE)' : '(COLLECT FROM CUSTOMER)'}`,
    ``,
    `Confirmation: ${booking.confirmationNumber || ''}`,
    `Customer: ${booking.name}`,
    `Phone: ${booking.phone}`,
    `Email: ${booking.email}`,
    ``,
    `When: ${booking.date} at ${booking.time}`,
    isRoundTrip && returnDate ? `Return: ${returnDate} at ${returnTime}` : '',
    booking.serviceType === 'hourly' ? `Service: HOURLY — ${booking.hours} hours as directed` : '',
    `Pickup: ${booking.pickup}`,
    ...((Array.isArray(booking.stops) ? booking.stops : []).map((s, i) => `Stop ${i + 1}: ${s}`)),
    `Dropoff: ${booking.dropoff}`,
    (Array.isArray(booking.stops) && booking.stops.length) ? `Extra stops fee: $${booking.stopsFee || booking.stops.length * 15}` : '',
    ``,
    `Vehicle: ${booking.vehicle}`,
    `Passengers: ${booking.passengers || '1'}`,
    isRoundTrip ? `Round trip: yes` : '',
    hasMeetAndGreet ? `Meet & Greet: yes` : '',
    (parseInt(booking.carSeats) || 0) > 0 ? `Car seats: ${booking.carSeats} — $${booking.carSeatsTotal || (parseInt(booking.carSeats) * 25)}` : '',
    hasDiscount ? `Discount: -${discount} (${promoCode})` : '',
    booking.flight ? `Flight: ${booking.flight}` : '',
    booking.notes ? `Notes: ${booking.notes}` : '',
    ``,
    `Open in Admin: https://mspairportchauffeur.com/admin.html?focus=${encodeURIComponent(booking.confirmationNumber || '')}`
  ];
  return lines.filter(Boolean).join('\n');
}

function generateCustomerEmail(booking, total, baseFare, discount, tip, processingFee, hasDiscount, hasProcessingFee, promoCode, distance, estimatedMinutes, pickupLink, dropoffLink, isRoundTrip, roundTripDiscount, returnDate, returnTime, hasMeetAndGreet, meetAndGreetPrice, calendarLink) {
  const hasTip = parseFloat(tip.replace('$', '')) > 0;
  const durationText = estimatedMinutes < 60
    ? `~${estimatedMinutes} minutes`
    : `~${Math.floor(estimatedMinutes/60)}h ${estimatedMinutes % 60}m`;

  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0d0d0d;">

    <!-- HEADER -->
    <div style="background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%); padding: 40px 30px; text-align: center; border-bottom: 2px solid #D4AF37;">
        <div style="color: #D4AF37; font-size: 28px; font-weight: 700; letter-spacing: 2px; margin-bottom: 10px;">MSP Chauffeur Service</div>
        <div style="color: #ffffff; font-size: 18px; font-weight: 400;">Booking Confirmed</div>
    </div>

    <!-- CONFIRMATION BADGE -->
    <div style="background-color: #1a1a1a; padding: 20px; text-align: center; border-bottom: 1px solid #333;">
        <div style="color: #888; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">✓ Confirmation Number</div>
        <div style="color: #D4AF37; font-size: 24px; font-weight: 700; margin-top: 5px;">${booking.confirmationNumber}</div>
    </div>

    <!-- MAIN CONTENT -->
    <div style="padding: 30px; color: #ffffff;">

        <!-- GREETING -->
        <div style="margin-bottom: 30px;">
            <div style="font-size: 22px; font-weight: 600; color: #ffffff; margin-bottom: 10px;">Dear ${booking.name},</div>
            <div style="color: #a0a0a0; font-size: 15px; line-height: 1.6;">Thank you for choosing MSP Chauffeur Service. Your premium transportation has been confirmed and your driver will be ready at the scheduled time.</div>
        </div>

        <!-- TRIP AT A GLANCE -->
        <div style="background-color: #1a1a1a; border-radius: 12px; padding: 25px; margin-bottom: 25px; border: 1px solid #333;">
            <div style="color: #D4AF37; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px;">Trip Details</div>

            <!-- DATE & TIME -->
            <div style="display: table; width: 100%; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #333;">
                <div style="display: table-cell; width: 50%;">
                    <div style="color: #a0a0a0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Date</div>
                    <div style="color: #ffffff; font-size: 18px; font-weight: 600; margin-top: 5px;">${booking.date}</div>
                </div>
                <div style="display: table-cell; width: 50%;">
                    <div style="color: #a0a0a0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Pickup Time</div>
                    <div style="color: #D4AF37; font-size: 18px; font-weight: 600; margin-top: 5px;">${booking.time}</div>
                </div>
            </div>
            ${isRoundTrip && returnDate ? `
            <!-- RETURN DATE & TIME -->
            <div style="display: table; width: 100%; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #333; background: rgba(212, 175, 55, 0.05); border-radius: 8px; padding: 15px;">
                <div style="color: #D4AF37; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">🔄 Return Trip</div>
                <div style="display: table; width: 100%;">
                    <div style="display: table-cell; width: 50%;">
                        <div style="color: #a0a0a0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Return Date</div>
                        <div style="color: #ffffff; font-size: 16px; font-weight: 600; margin-top: 5px;">${returnDate}</div>
                    </div>
                    <div style="display: table-cell; width: 50%;">
                        <div style="color: #a0a0a0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Return Time</div>
                        <div style="color: #D4AF37; font-size: 16px; font-weight: 600; margin-top: 5px;">${returnTime}</div>
                    </div>
                </div>
            </div>` : ''}

            <!-- ROUTE -->
            <div style="margin-bottom: 20px;">
                <div style="margin-bottom: 15px;">
                    <div style="color: #D4AF37; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">📍 Pickup Location</div>
                    <div style="color: #ffffff; font-size: 15px; line-height: 1.4; margin-bottom: 8px;">${booking.pickup}</div>
                    <a href="${pickupLink}" style="color: #D4AF37; font-size: 13px; text-decoration: underline;">Open in Maps →</a>
                </div>
                ${(Array.isArray(booking.stops) ? booking.stops : []).map((stop, i) => `
                <div style="border-left: 2px dotted #D4AF37; height: 15px; margin-left: 5px;"></div>
                <div style="margin-bottom: 15px;">
                    <div style="color: #D4AF37; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">🔸 Stop ${i + 1}</div>
                    <div style="color: #ffffff; font-size: 15px; line-height: 1.4;">${stop}</div>
                </div>`).join('')}
                <div style="border-left: 2px dotted #D4AF37; height: 15px; margin-left: 5px;"></div>
                <div>
                    <div style="color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">🏁 ${booking.serviceType === 'hourly' ? 'Drop-off / As Directed' : 'Dropoff Location'}</div>
                    <div style="color: #ffffff; font-size: 15px; line-height: 1.4; margin-bottom: 8px;">${booking.dropoff}</div>
                    <a href="${dropoffLink}" style="color: #D4AF37; font-size: 13px; text-decoration: underline;">Open in Maps →</a>
                </div>
            </div>

            <!-- DISTANCE & DURATION -->
            <div style="background-color: #0d0d0d; padding: 15px; border-radius: 8px; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="width: 50%; text-align: center; border-right: 1px solid #333; padding: 5px;">
                            <div style="color: #D4AF37; font-size: 20px; font-weight: 700;">${distance} mi</div>
                            <div style="color: #a0a0a0; font-size: 11px; text-transform: uppercase;">Distance</div>
                        </td>
                        <td style="width: 50%; text-align: center; padding: 5px;">
                            <div style="color: #D4AF37; font-size: 20px; font-weight: 700;">${durationText}</div>
                            <div style="color: #a0a0a0; font-size: 11px; text-transform: uppercase;">Est. Duration</div>
                        </td>
                    </tr>
                </table>
            </div>
        </div>

        <!-- VEHICLE & PASSENGERS -->
        <div style="background-color: #1a1a1a; border-radius: 12px; padding: 20px; margin-bottom: 25px; border: 1px solid #333;">
            <div style="display: table; width: 100%;">
                <div style="display: table-cell; width: 50%;">
                    <div style="color: #a0a0a0; font-size: 12px; text-transform: uppercase;">Vehicle</div>
                    <div style="color: #ffffff; font-size: 16px; font-weight: 600; margin-top: 5px;">${booking.vehicle}</div>
                </div>
                <div style="display: table-cell; width: 50%;">
                    <div style="color: #a0a0a0; font-size: 12px; text-transform: uppercase;">Passengers</div>
                    <div style="color: #ffffff; font-size: 16px; font-weight: 600; margin-top: 5px;">${booking.passengers || '1'}</div>
                </div>
            </div>
        </div>

        <!-- FARE BREAKDOWN -->
        <div style="background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); border-radius: 12px; padding: 25px; margin-bottom: 25px; color: #0d0d0d;">
            <div style="text-align: center;">
                <div style="font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Total Fare</div>
                <div style="font-size: 40px; font-weight: 800;">${total}</div>
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(0,0,0,0.2);">
                    <span style="font-size: 14px;">Base: <strong>${baseFare}</strong></span>
                    ${isRoundTrip ? `<span style="font-size: 14px; margin-left: 20px;">Return: <strong>${baseFare}</strong></span>` : ''}
                    ${hasMeetAndGreet ? `<span style="font-size: 14px; margin-left: 20px;">Meet & Greet: <strong>${meetAndGreetPrice}</strong></span>` : ''}
                    ${(parseInt(booking.carSeats) || 0) > 0 ? `<span style="font-size: 14px; margin-left: 20px;">Car Seats × ${booking.carSeats}: <strong>$${booking.carSeatsTotal || parseInt(booking.carSeats) * 25}</strong></span>` : ''}
                    ${(Array.isArray(booking.stops) && booking.stops.length) ? `<span style="font-size: 14px; margin-left: 20px;">Stops × ${booking.stops.length}: <strong>$${booking.stopsFee || booking.stops.length * 15}</strong></span>` : ''}
                    ${booking.serviceType === 'hourly' ? `<span style="font-size: 14px; margin-left: 20px;">Hourly: <strong>${booking.hours} hrs</strong></span>` : ''}
                    ${hasTip ? `<span style="font-size: 14px; margin-left: 20px;">Tip: <strong>${tip}</strong></span>` : ''}
                    ${hasProcessingFee ? `<span style="font-size: 14px; margin-left: 20px;">Fee: <strong>${processingFee}</strong></span>` : ''}
                </div>
                <div style="margin-top: 10px;">
                    <span style="background-color: rgba(0,0,0,0.2); padding: 6px 15px; border-radius: 15px; font-size: 13px; font-weight: 600;">
                        ${booking.paymentMethod === 'online' ? '✓ Paid Online' : 'Pay Driver Upon Arrival'}
                    </span>
                </div>
            </div>
        </div>

        <!-- WHAT TO EXPECT -->
        <div style="background-color: #1a1a1a; border-radius: 12px; padding: 20px; margin-bottom: 25px; border: 1px solid #333;">
            <div style="color: #D4AF37; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 15px;">What to Expect</div>
            <ul style="color: #a0a0a0; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                <li>Your driver will arrive at the pickup location on time</li>
                <li>Look for a clean, professional vehicle</li>
                <li>The driver may contact you upon arrival</li>
                <li>For airport pickups, the driver will meet you at the designated area</li>
            </ul>
        </div>

        ${calendarLink ? `
        <!-- ADD TO CALENDAR -->
        <div style="text-align: center; padding: 20px 0; margin-bottom: 15px;">
            <a href="${calendarLink}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #0d0d0d; padding: 16px 35px; text-decoration: none; border-radius: 30px; font-weight: 700; font-size: 16px;">
                Add to Calendar
            </a>
            <div style="color: #a0a0a0; font-size: 12px; margin-top: 8px;">Opens in Google Calendar</div>
        </div>` : ''}

        <!-- CONTACT -->
        <div style="text-align: center; padding: 25px 0; border-top: 1px solid #333;">
            <div style="color: #ffffff; font-size: 16px; margin-bottom: 10px;">Questions or changes?</div>
            <a href="tel:6126665004" style="color: #D4AF37; font-size: 24px; font-weight: 700; text-decoration: none;">(612) 666-5004</a>
            <div style="color: #a0a0a0; font-size: 13px; margin-top: 10px;">Available 24/7 for your convenience</div>
        </div>
    </div>

    <!-- FOOTER -->
    <div style="background-color: #1a1a1a; padding: 25px; text-align: center; border-top: 1px solid #333;">
        <div style="color: #D4AF37; font-size: 16px; font-weight: 600; margin-bottom: 5px;">MSP Chauffeur Service</div>
        <div style="color: #666; font-size: 12px;">Premium Transportation in the Twin Cities</div>
        <div style="margin-top: 15px;">
            <a href="https://mspairportchauffeur.com" style="color: #a0a0a0; font-size: 12px; text-decoration: none;">mspairportchauffeur.com</a>
        </div>
    </div>
</div>`;
}

function generateOwnerEmail(booking, total, baseFare, discount, tip, processingFee, hasDiscount, hasProcessingFee, promoCode, distance, pickupLink, dropoffLink, isRoundTrip, roundTripDiscount, returnDate, returnTime, hasMeetAndGreet, meetAndGreetPrice) {
  const hasTip = parseFloat(tip.replace('$', '')) > 0;
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <!-- URGENT HEADER - GOLD ALERT BAR -->
    <div style="background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); padding: 18px; text-align: center;">
        <span style="color: #0d0d0d; font-size: 26px; font-weight: 900; letter-spacing: 3px; text-transform: uppercase;">🚨 NEW BOOKING 🚨</span>
    </div>

    <!-- MONEY BOX - BLACK WITH GOLD TEXT FOR HIGH CONTRAST -->
    <div style="background-color: #0d0d0d; padding: 35px 30px; text-align: center; border-bottom: 4px solid #D4AF37;">
        <div style="color: #888; font-size: 13px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px;">TOTAL EARNINGS</div>
        <div style="color: #D4AF37; font-size: 56px; font-weight: 900; letter-spacing: -1px;">${total}</div>
        ${isRoundTrip || hasMeetAndGreet || (parseInt(booking.carSeats) || 0) > 0 || booking.serviceType === 'hourly' || (Array.isArray(booking.stops) && booking.stops.length) ? `
        <div style="margin-top: 12px; display: flex; justify-content: center; gap: 10px; flex-wrap: wrap;">
            ${isRoundTrip ? `<span style="background-color: #1a5f1a; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600; color: #90EE90;">🔄 ROUND TRIP</span>` : ''}
            ${hasMeetAndGreet ? `<span style="background-color: #D4AF37; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600; color: #0d0d0d;">👤 MEET & GREET</span>` : ''}
            ${(parseInt(booking.carSeats) || 0) > 0 ? `<span style="background-color: #D4AF37; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600; color: #0d0d0d;">🧒 ${booking.carSeats} CAR SEAT${parseInt(booking.carSeats) > 1 ? 'S' : ''}</span>` : ''}
            ${booking.serviceType === 'hourly' ? `<span style="background-color: #243f8f; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600; color: #ffffff;">⏱ HOURLY · ${booking.hours} HRS</span>` : ''}
            ${(Array.isArray(booking.stops) && booking.stops.length) ? `<span style="background-color: #D4AF37; padding: 5px 12px; border-radius: 15px; font-size: 12px; font-weight: 600; color: #0d0d0d;">📍 ${booking.stops.length} STOP${booking.stops.length > 1 ? 'S' : ''}</span>` : ''}
        </div>` : ''}
        <div style="margin-top: 18px; padding-top: 18px; border-top: 1px solid #333;">
            <span style="color: #888; font-size: 15px;">Base: <strong style="color: #ffffff;">${baseFare}</strong></span>
            ${isRoundTrip ? `<span style="color: #888; font-size: 15px; margin-left: 25px;">Return: <strong style="color: #ffffff;">${baseFare}</strong></span>` : ''}
            ${isRoundTrip && parseFloat(String(roundTripDiscount).replace('$','')) > 0 ? `<span style="color: #888; font-size: 15px; margin-left: 25px;">RT Savings: <strong style="color: #90EE90;">-${roundTripDiscount}</strong></span>` : ''}
            ${hasMeetAndGreet ? `<span style="color: #888; font-size: 15px; margin-left: 25px;">Meet & Greet: <strong style="color: #D4AF37;">${meetAndGreetPrice}</strong></span>` : ''}
            ${(parseInt(booking.carSeats) || 0) > 0 ? `<span style="color: #888; font-size: 15px; margin-left: 25px;">Car Seats × ${booking.carSeats}: <strong style="color: #D4AF37;">$${booking.carSeatsTotal || parseInt(booking.carSeats) * 25}</strong></span>` : ''}
            ${(Array.isArray(booking.stops) && booking.stops.length) ? `<span style="color: #888; font-size: 15px; margin-left: 25px;">Stops × ${booking.stops.length}: <strong style="color: #D4AF37;">$${booking.stopsFee || booking.stops.length * 15}</strong></span>` : ''}
            ${hasDiscount ? `<span style="color: #888; font-size: 15px; margin-left: 25px;">Discount: <strong style="color: #ff6b6b;">-${discount}</strong></span>` : ''}
            ${hasTip ? `<span style="color: #888; font-size: 15px; margin-left: 25px;">Tip: <strong style="color: #D4AF37;">${tip}</strong></span>` : ''}
            ${hasProcessingFee ? `<span style="color: #888; font-size: 15px; margin-left: 25px;">Fee: <strong style="color: #888;">${processingFee}</strong></span>` : ''}
        </div>
        ${hasDiscount ? `<div style="margin-top: 10px; color: #ff6b6b; font-size: 13px;">⚠️ Promo code used: ${promoCode}</div>` : ''}
        <div style="margin-top: 15px;">
            <span style="background-color: ${booking.paymentMethod === 'online' ? '#D4AF37' : '#ff9900'}; color: #0d0d0d; padding: 10px 25px; border-radius: 25px; font-size: 14px; font-weight: 800; display: inline-block;">
                ${booking.paymentMethod === 'online' ? '✅ PAID ONLINE' : '💵 COLLECT FROM CUSTOMER'}
            </span>
        </div>
    </div>

    <!-- QUICK GLANCE BOX -->
    <div style="background-color: #1a1a1a; padding: 25px; display: table; width: 100%; box-sizing: border-box;">
        <div style="display: table-cell; width: 50%; text-align: center; border-right: 1px solid #333;">
            <div style="color: #D4AF37; font-size: 36px; font-weight: 800;">${distance} mi</div>
            <div style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Distance</div>
        </div>
        <div style="display: table-cell; width: 50%; text-align: center;">
            <div style="color: #ffffff; font-size: 22px; font-weight: 700;">${booking.date}</div>
            <div style="color: #D4AF37; font-size: 22px; font-weight: 700;">${booking.time}</div>
        </div>
    </div>
    ${isRoundTrip && returnDate ? `
    <!-- RETURN INFO BAR -->
    <div style="background-color: #1a5f1a; padding: 15px 25px; text-align: center;">
        <span style="color: #90EE90; font-size: 14px; font-weight: 700;">🔄 RETURN: ${returnDate} at ${returnTime}</span>
    </div>` : ''}

    <!-- MAIN CONTENT -->
    <div style="background-color: #0d0d0d; padding: 30px; color: #ffffff;">

        <!-- CUSTOMER INFO -->
        <div style="background-color: #1a1a1a; border: 2px solid #D4AF37; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
            <div style="color: #D4AF37; font-size: 14px; font-weight: 700; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 1px;">👤 Customer</div>
            <div style="font-size: 24px; font-weight: 700; color: #ffffff; margin-bottom: 12px;">${booking.name}</div>
            <div style="margin-bottom: 8px;">
                <a href="tel:${booking.phone}" style="color: #D4AF37; font-size: 22px; font-weight: 700; text-decoration: none;">📞 ${booking.phone}</a>
            </div>
            <div>
                <a href="mailto:${booking.email}" style="color: #a0a0a0; font-size: 14px; text-decoration: none;">✉️ ${booking.email}</a>
            </div>
        </div>

        <!-- ROUTE INFO -->
        <div style="background-color: #1a1a1a; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
            <div style="color: #D4AF37; font-size: 14px; font-weight: 700; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 1px;">🗺️ Route</div>

            <div style="margin-bottom: 15px;">
                <div style="color: #D4AF37; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">📍 PICKUP</div>
                <div style="color: #ffffff; font-size: 16px; line-height: 1.4; margin-bottom: 8px;">${booking.pickup}</div>
                <a href="${pickupLink}" style="display: inline-block; background-color: #D4AF37; color: #0d0d0d; padding: 8px 15px; border-radius: 5px; font-size: 13px; font-weight: 600; text-decoration: none;">Open in Maps</a>
            </div>

            ${(Array.isArray(booking.stops) ? booking.stops : []).map((stop, i) => `
            <div style="border-left: 2px dashed #D4AF37; height: 20px; margin-left: 6px;"></div>
            <div style="margin-bottom: 15px;">
                <div style="color: #D4AF37; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">🔸 STOP ${i + 1}</div>
                <div style="color: #ffffff; font-size: 16px; line-height: 1.4;">${stop}</div>
            </div>`).join('')}
            <div style="border-left: 2px dashed #D4AF37; height: 20px; margin-left: 6px;"></div>

            <div>
                <div style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">🏁 ${booking.serviceType === 'hourly' ? 'DROP-OFF / AS DIRECTED' : 'DROPOFF'}</div>
                <div style="color: #ffffff; font-size: 16px; line-height: 1.4; margin-bottom: 8px;">${booking.dropoff}</div>
                <a href="${dropoffLink}" style="display: inline-block; background-color: #D4AF37; color: #0d0d0d; padding: 8px 15px; border-radius: 5px; font-size: 13px; font-weight: 600; text-decoration: none;">Open in Maps</a>
            </div>
        </div>

        <!-- TRIP DETAILS -->
        <div style="background-color: #1a1a1a; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
            <div style="color: #D4AF37; font-size: 14px; font-weight: 700; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 1px;">📋 Details</div>
            <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; color: #888; width: 40%;">Confirmation:</td><td style="padding: 8px 0; color: #D4AF37; font-weight: 700;">${booking.confirmationNumber}</td></tr>
                <tr><td style="padding: 8px 0; color: #888;">Vehicle:</td><td style="padding: 8px 0; color: #ffffff;">${booking.vehicle}</td></tr>
                <tr><td style="padding: 8px 0; color: #888;">Passengers:</td><td style="padding: 8px 0; color: #ffffff;">${booking.passengers || '1'}</td></tr>
                ${isRoundTrip ? `<tr><td style="padding: 8px 0; color: #888;">Trip Type:</td><td style="padding: 8px 0; color: #90EE90; font-weight: 700;">🔄 ROUND TRIP</td></tr>` : ''}
                ${hasMeetAndGreet ? `<tr><td style="padding: 8px 0; color: #888;">Service:</td><td style="padding: 8px 0; color: #D4AF37; font-weight: 700;">👤 MEET & GREET</td></tr>` : ''}
                ${(parseInt(booking.carSeats) || 0) > 0 ? `<tr><td style="padding: 8px 0; color: #888;">Car Seats:</td><td style="padding: 8px 0; color: #D4AF37; font-weight: 700;">🧒 ${booking.carSeats} — install before pickup</td></tr>` : ''}
                ${booking.flight ? `<tr><td style="padding: 8px 0; color: #888;">Flight #:</td><td style="padding: 8px 0; color: #ffffff;">${booking.flight}</td></tr>` : ''}
                ${booking.notes ? `<tr><td style="padding: 8px 0; color: #888;">Notes:</td><td style="padding: 8px 0; color: #D4AF37; font-weight: 600;">${booking.notes}</td></tr>` : ''}
            </table>
        </div>

        <!-- ACTION BUTTONS -->
        <div style="text-align: center; padding: 20px 0;">
            <a href="tel:${booking.phone}" style="display: inline-block; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #0d0d0d; padding: 18px 45px; text-decoration: none; border-radius: 30px; font-weight: 800; font-size: 18px; margin-bottom: 12px;">📞 CALL NOW</a>
            <div style="margin-top: 14px;">
                <a href="https://mspairportchauffeur.com/admin.html?focus=${encodeURIComponent(booking.confirmationNumber || '')}" style="display: inline-block; background-color: transparent; color: #D4AF37; padding: 12px 24px; text-decoration: none; border: 1px solid rgba(212, 175, 55, 0.4); border-radius: 25px; font-weight: 600; font-size: 13px;">Open in Admin →</a>
            </div>
        </div>
    </div>

    <!-- FOOTER -->
    <div style="background-color: #1a1a1a; padding: 20px; text-align: center; border-top: 1px solid #333;">
        <div style="color: #D4AF37; font-size: 14px; font-weight: 600;">MSP Chauffeur Service</div>
        <div style="color: #666; font-size: 12px; margin-top: 5px;">Premium Transportation</div>
    </div>
</div>`;
}

function generateReminderEmail(booking, hoursBeforeText, pickupLink) {
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0d0d0d;">
    <div style="background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%); padding: 40px 30px; text-align: center; border-bottom: 2px solid #D4AF37;">
        <div style="color: #D4AF37; font-size: 28px; font-weight: 700; letter-spacing: 2px; margin-bottom: 10px;">MSP Chauffeur Service</div>
        <div style="color: #ffffff; font-size: 18px; font-weight: 400;">Ride Reminder</div>
    </div>
    <div style="padding: 30px; color: #ffffff;">
        <div style="font-size: 22px; font-weight: 600; margin-bottom: 15px;">Hi ${booking.name},</div>
        <div style="color: #a0a0a0; font-size: 15px; line-height: 1.6; margin-bottom: 25px;">
            Your ride is ${hoursBeforeText}! Here are your trip details:
        </div>
        <div style="background-color: #1a1a1a; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #333;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; color: #888;">Date:</td><td style="padding: 8px 0; color: #D4AF37; font-weight: 700;">${booking.date}</td></tr>
                <tr><td style="padding: 8px 0; color: #888;">Time:</td><td style="padding: 8px 0; color: #D4AF37; font-weight: 700;">${booking.time}</td></tr>
                <tr><td style="padding: 8px 0; color: #888;">Pickup:</td><td style="padding: 8px 0; color: #ffffff;">${booking.pickup}</td></tr>
                <tr><td style="padding: 8px 0; color: #888;">Dropoff:</td><td style="padding: 8px 0; color: #ffffff;">${booking.dropoff}</td></tr>
                <tr><td style="padding: 8px 0; color: #888;">Vehicle:</td><td style="padding: 8px 0; color: #ffffff;">${booking.vehicle}</td></tr>
                <tr><td style="padding: 8px 0; color: #888;">Confirmation:</td><td style="padding: 8px 0; color: #D4AF37;">${booking.confirmationNumber}</td></tr>
            </table>
        </div>
        <div style="text-align: center; margin: 25px 0;">
            <a href="${pickupLink}" style="display: inline-block; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #0d0d0d; padding: 14px 30px; text-decoration: none; border-radius: 25px; font-weight: 700; font-size: 15px;">View Pickup Location</a>
        </div>
        <div style="text-align: center; padding: 20px 0; border-top: 1px solid #333;">
            <div style="color: #ffffff; font-size: 15px; margin-bottom: 8px;">Need to make changes?</div>
            <a href="tel:6126665004" style="color: #D4AF37; font-size: 22px; font-weight: 700; text-decoration: none;">(612) 666-5004</a>
        </div>
    </div>
    <div style="background-color: #1a1a1a; padding: 20px; text-align: center; border-top: 1px solid #333;">
        <div style="color: #D4AF37; font-size: 14px; font-weight: 600;">MSP Chauffeur Service</div>
        <div style="color: #666; font-size: 12px; margin-top: 5px;">Premium Transportation in the Twin Cities</div>
    </div>
</div>`;
}

function generateReviewEmail(booking) {
  // TODO: replace the g.page URL below with this brand's Google review link
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0d0d0d;">
    <div style="background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%); padding: 40px 30px; text-align: center; border-bottom: 2px solid #D4AF37;">
        <div style="color: #D4AF37; font-size: 28px; font-weight: 700; letter-spacing: 2px; margin-bottom: 10px;">MSP Chauffeur Service</div>
        <div style="color: #ffffff; font-size: 18px; font-weight: 400;">How was your ride?</div>
    </div>
    <div style="padding: 30px; color: #ffffff;">
        <div style="font-size: 22px; font-weight: 600; margin-bottom: 15px;">Hi ${booking.name},</div>
        <div style="color: #a0a0a0; font-size: 15px; line-height: 1.6; margin-bottom: 25px;">
            We hope you had a wonderful experience with MSP Chauffeur Service. Your feedback means the world to us and helps other customers find reliable transportation.
        </div>
        <div style="text-align: center; margin: 30px 0;">
            <div style="color: #D4AF37; font-size: 48px; margin-bottom: 15px;">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
            <a href="https://g.page/r/REPLACE_WITH_REVIEW_LINK/review" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #0d0d0d; padding: 18px 45px; text-decoration: none; border-radius: 30px; font-weight: 800; font-size: 18px;">
                Leave a Review
            </a>
            <div style="color: #a0a0a0; font-size: 12px; margin-top: 10px;">Takes less than a minute</div>
        </div>
        <div style="background-color: #1a1a1a; border-radius: 12px; padding: 20px; margin-top: 25px; border: 1px solid #333; text-align: center;">
            <div style="color: #a0a0a0; font-size: 14px; margin-bottom: 8px;">Your trip on ${booking.date}</div>
            <div style="color: #ffffff; font-size: 14px;">${booking.pickup} &rarr; ${booking.dropoff}</div>
            <div style="color: #888; font-size: 12px; margin-top: 5px;">Confirmation: ${booking.confirmationNumber}</div>
        </div>
        <div style="text-align: center; padding: 25px 0; border-top: 1px solid #333; margin-top: 25px;">
            <div style="color: #ffffff; font-size: 15px; margin-bottom: 5px;">Book your next ride</div>
            <a href="https://mspairportchauffeur.com/book-a-ride.html" style="color: #D4AF37; font-size: 16px; font-weight: 700; text-decoration: none;">mspairportchauffeur.com</a>
        </div>
    </div>
    <div style="background-color: #1a1a1a; padding: 20px; text-align: center; border-top: 1px solid #333;">
        <div style="color: #D4AF37; font-size: 14px; font-weight: 600;">MSP Chauffeur Service</div>
        <div style="color: #666; font-size: 12px; margin-top: 5px;">Premium Transportation in the Twin Cities</div>
    </div>
</div>`;
}
