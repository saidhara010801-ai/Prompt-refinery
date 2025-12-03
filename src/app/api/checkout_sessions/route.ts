'use server';
import { NextRequest, NextResponse } from 'next/server';

// Make sure to add your Stripe secret key to your environment variables
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

export async function POST(req: NextRequest) {
  try {
    const session = await stripe.checkout.sessions.create({
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
      success_url: `${req.headers.get('origin')}/?success=true`,
      cancel_url: `${req.headers.get('origin')}/`,
    });

    return NextResponse.json({ id: session.id });
  } catch (err: any) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Hello World!" });
}
