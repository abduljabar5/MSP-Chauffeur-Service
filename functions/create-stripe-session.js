import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const booking = JSON.parse(event.body);

    // Validate required fields
    if (!booking.amount || !booking.email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Generate confirmation number
    const confirmationNumber = 'TCB-' + Math.random().toString(36).substr(2, 6).toUpperCase();

    // Build success URL with booking data for confirmation page
    const bookingParams = new URLSearchParams({
      confirmation: confirmationNumber,
      paid: 'true'
    });

    const successUrl = `${booking.success_url}?${bookingParams.toString()}`;

    // Build product description with upsells
    const upsellParts = [];
    if (booking.roundTrip) upsellParts.push('Round Trip');
    if (booking.meetAndGreet) upsellParts.push('Meet & Greet');
    if (booking.carSeats > 0) upsellParts.push(`${booking.carSeats} Car Seat${booking.carSeats > 1 ? 's' : ''}`);
    const upsellText = upsellParts.length ? ` (${upsellParts.join(', ')})` : '';

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${booking.vehicle || 'Sedan'} - Airport Transfer${upsellText}`,
            description: `${booking.pickup} → ${booking.dropoff} on ${booking.date} at ${booking.time}`,
          },
          unit_amount: booking.amount, // Amount in cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: booking.cancel_url,
      customer_email: booking.email,
      metadata: {
        confirmationNumber,
        customerName: booking.name,
        customerPhone: booking.phone,
        customerEmail: booking.email,
        pickup: booking.pickup,
        dropoff: booking.dropoff,
        date: booking.date,
        time: booking.time,
        vehicle: booking.vehicle,
        passengers: booking.passengers,
        flight: booking.flight || '',
        notes: booking.notes || '',
        baseFare: String(booking.baseFare ?? 0),
        roundTrip: booking.roundTrip ? 'true' : 'false',
        roundTripDiscount: String(booking.roundTripDiscount ?? 0),
        returnDate: booking.returnDate || '',
        returnTime: booking.returnTime || '',
        meetAndGreet: booking.meetAndGreet ? 'true' : 'false',
        meetAndGreetPrice: String(booking.meetAndGreetPrice ?? 0),
        carSeats: String(booking.carSeats ?? 0),
        carSeatsTotal: String(booking.carSeatsTotal ?? 0),
        discount: String(booking.discount ?? 0),
        promoCode: booking.promoCode || '',
        tip: String(booking.tip ?? 0),
        total: String(booking.total ?? 0),
        distance: String(booking.distance ?? 0),
        duration: String(booking.duration ?? 0),
        processingFee: String(booking.processingFee ?? 0)
      },
      payment_intent_data: {
        description: `TCB Booking: ${booking.name} - ${booking.date}`,
        metadata: {
          confirmationNumber,
          customer: booking.name,
          phone: booking.phone
        }
      },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: session.url,
        confirmationNumber
      }),
    };
  } catch (error) {
    console.error('Stripe session error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
