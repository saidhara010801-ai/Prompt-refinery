'use server';
import { NextRequest, NextResponse } from 'next/server';

// Make sure to add your Stripe secret key to your environment variables
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

export async function POST(req: NextRequest) {
  if (!stripeSecretKey) {
    return NextResponse.json(
      { error: { message: 'Stripe secret key is not set. Please add it to your .env file.' } },
      { status: 500 }
    );
  }

  const stripe = require('stripe')(stripeSecretKey);

  try {
    const origin = req.headers.get('origin') || 'http://localhost:9002';
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'hosted',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'A coffee for the developer',
              images: ['https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png'],
            },
            unit_amount: 500, // $5.00
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${origin}/?success=true`,
      cancel_url: `${origin}/`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Hello World!" });
}