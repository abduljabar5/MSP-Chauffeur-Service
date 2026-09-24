// Stripe webhook handler
// Triggered server-side by Stripe after payment completes.
// Owner notifications are no longer dependent on the customer's browser.
// V2 syntax: required so the Netlify Blobs context is auto-injected
// (processBooking writes to a Netlify Blobs store).
import Stripe from 'stripe';
import { processBooking } from './process-booking.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

  const signature = req.headers.get('stripe-signature');
  const rawBody = await req.text();

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return jsonResponse(200, { received: true, ignored: stripeEvent.type });
  }

  const session = stripeEvent.data.object;
  const m = session.metadata || {};

  const booking = {
    confirmationNumber: m.confirmationNumber,
    name: m.customerName,
    email: m.customerEmail || session.customer_email,
    phone: m.customerPhone,
    pickup: m.pickup,
    dropoff: m.dropoff,
    date: m.date,
    time: m.time,
    vehicle: m.vehicle,
    passengers: m.passengers,
    flight: m.flight || '',
    notes: m.notes || '',
    paymentMethod: 'online',
    baseFare: parseFloat(m.baseFare) || 0,
    roundTrip: m.roundTrip === 'true',
    roundTripDiscount: parseFloat(m.roundTripDiscount) || 0,
    returnDate: m.returnDate || '',
    returnTime: m.returnTime || '',
    meetAndGreet: m.meetAndGreet === 'true',
    meetAndGreetPrice: parseFloat(m.meetAndGreetPrice) || 0,
    carSeats: parseInt(m.carSeats) || 0,
    carSeatsTotal: parseFloat(m.carSeatsTotal) || 0,
    serviceType: m.serviceType || 'transfer',
    hours: parseInt(m.hours) || 0,
    stops: (() => { let j = m.stops || ''; for (let i = 2; m[`stops${i}`]; i++) j += m[`stops${i}`]; return j ? j.split(' | ').filter(Boolean) : []; })(),
    stopsFee: parseFloat(m.stopsFee) || 0,
    tipType: m.tipType || 'percent',
    discount: parseFloat(m.discount) || 0,
    promoCode: m.promoCode || '',
    tip: parseFloat(m.tip) || 0,
    processingFee: parseFloat(m.processingFee) || 0,
    total: parseFloat(m.total) || 0,
    distance: parseFloat(m.distance) || 0,
    duration: parseFloat(m.duration) || 0
  };

  if (!booking.email || !booking.phone || !booking.pickup || !booking.dropoff) {
    console.error('Webhook booking missing required fields:', booking);
    return jsonResponse(200, { received: true, error: 'Missing fields' });
  }

  try {
    const results = await processBooking(booking);
    console.log('Webhook booking processed:', booking.confirmationNumber, results);
    return jsonResponse(200, { received: true, results });
  } catch (error) {
    console.error('Webhook processing error:', error);
    // Return 500 so Stripe retries the webhook
    return jsonResponse(500, { error: error.message });
  }
};
