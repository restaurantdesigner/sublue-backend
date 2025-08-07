📦 Stripe Setup for Production
This guide explains how to replace the current Stripe API keys with the client’s own credentials.

✅ 1. Create a Stripe Account
Ask the client to register at https://dashboard.stripe.com/register

🔐 2. Get the Secret Key
Once logged in:

Go to Developers > API Keys

Click "Reveal live key"

Copy the Secret key (starts with sk_live_...)

🧩 3. Update .env File
On the server (backend/.env), replace the existing key:

ini
Copy
Edit
STRIPE_SECRET_KEY=sk_live_your_client_key_here
⚠️ Never commit .env files to GitHub.

🛠️ 4. Update server.js (if needed)
Make sure server.js loads the .env file like this:

js
Copy
Edit
import dotenv from 'dotenv';
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
✅ No need to hardcode keys anywhere.

🌍 5. Check Redirect URLs
In server.js, update the links for success & cancel:

js
Copy
Edit
success_url: 'https://yourclientdomain.com/success.html',
cancel_url: 'https://yourclientdomain.com/cancel.html',
You can test with Stripe’s “test mode” first.

🧪 6. Optional — Test in Live Mode
Once keys are replaced and the project is deployed, create a real transaction with a small product (e.g. €1.00) to verify payment flow.