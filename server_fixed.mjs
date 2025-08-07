import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
console.log("📦 .env STRIPE_WEBHOOK_SECRET:", process.env.STRIPE_WEBHOOK_SECRET);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const SPREADSHEET_ID = '1oFM818LNbAgwb-SQBZxmH2UaG2RJQg1nFJymO7THpDw';
const SHEET_NAME = 'Stock';

app.use(cors());
app.use('/webhook', bodyParser.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.post('/create-checkout-session', async (req, res) => {
  const { items } = req.body;
  console.log("🛒 items received:", items);

  try {
    const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:E`
    });

    const rows = response.data.values;

    // 🧠 Проверка остатков перед оплатой
    for (const item of items) {
      const row = rows.find(r => r[0] === item.id);
      if (!row) {
        return res.status(400).json({ error: `❌ Product not found: ${item.id}` });
      }

      const available = parseInt(row[4] || 0);
      const requested = parseInt(item.quantity || 1);

      if (available < requested) {
        return res.status(400).json({
          error: `❌ Not enough stock for ${item.name}. Only ${available} left.`
        });
      }
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: items.map(item => ({
        price_data: {
          currency: 'eur',
          product_data: {
            name: item.name,
            images: [item.image],
            metadata: { id: item.id }
          },
          unit_amount: Math.round(Number(item.price) * 100)
        },
        quantity: parseInt(item.quantity || 1),
      })),
      success_url: 'https://restaurantdesigner.github.io/sublue/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://restaurantdesigner.github.io/sublue/cancel.html',
      shipping_address_collection: { allowed_countries: ['ES', 'FR', 'PT'] },
      phone_number_collection: { enabled: true },
      metadata: { source: 'cart' }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe or stock error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/checkout-session/:id', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id, {
      expand: ['line_items', 'customer_details']
    });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function updateStockFromCheckoutItems(items) {
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:E`
  });

  const rows = response.data.values;

  for (const item of items) {
    const id = item.id;
    const qty = Number(item.quantity || 1);
    const rowIndex = rows.findIndex(row => row[0] === id);

    if (rowIndex !== -1) {
      const currentStock = Number(rows[rowIndex][4] || 0);
      const newStock = Math.max(0, currentStock - qty);
      const cell = `E${rowIndex + 2}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!${cell}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[newStock]] }
      });

      console.log(`✅ Stock updated for ${id}: ${currentStock} → ${newStock}`);
    } else {
      console.warn(`⚠️ Product not found in sheet: ${id}`);
    }
  }
}

app.post('/webhook', async (req, res) => {
  console.log("🔔 Webhook endpoint triggered");

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log("✅ Webhook signature verified");
  } catch (err) {
    console.error('❌ Webhook verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log("🎉 Event type:", event.type);
    console.log("📦 Session ID:", session.id);

    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        expand: ['data.price.product']
      });

      const items = lineItems.data.map(li => {
        const id = li.price.product.metadata?.id || li.description || "UNKNOWN";
        console.log("🔍 Line item:", li.description, "→", id);
        return {
          id,
          quantity: li.quantity
        };
      });

      console.log("✅ Webhook: updating stock", items);
      await updateStockFromCheckoutItems(items);
    } catch (err) {
      console.error("❌ Failed to list line items:", err.message);
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
