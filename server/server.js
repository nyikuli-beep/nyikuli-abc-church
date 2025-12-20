const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

// Best Practice: Ensure all required environment variables are set before starting.
const requiredEnv = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_PASSKEY', 'MPESA_SHORTCODE', 'MPESA_CALLBACK_URL', 'JWT_SECRET', 'GOOGLE_CLIENT_ID', 'MPESA_CALLBACK_SECRET'];
for (const v of requiredEnv) {
    if (!process.env[v]) {
        console.error(`\nFATAL ERROR: Environment variable ${v} is not set. Please check your .env file or hosting configuration.\n`);
        process.exit(1); // Exit if a critical variable is missing.
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT: Replace with the Client ID you generated in the Google Cloud Console
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com';

// IMPORTANT: Use a strong, secret key from an environment variable in a real app
// In production, use process.env.JWT_SECRET
const JWT_SECRET = process.env.JWT_SECRET || 'YOUR_SUPER_SECRET_KEY_FOR_JWT';

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// Middleware
// CORS: Only allow requests from specific domains
const allowedOrigins = [
    'https://your-custom-domain.com', // REPLACE THIS with your actual custom domain
    'https://www.your-custom-domain.com',
    'http://localhost:3000', // Allow local backend testing
    'http://127.0.0.1:5500'  // Allow local frontend testing (VS Code Live Server)
];
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, or M-Pesa callbacks) or if origin is in allowed list
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
}));
app.use(express.json()); // Parses incoming JSON requests

// Request Logger: Prints every incoming request to the logs
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Root route to verify server is running
app.get('/', (req, res) => {
    res.send('ABC Church Server is running!');
});

/**
 * In-memory database simulation.
 * In a real application, you would use a proper database like PostgreSQL, MongoDB, etc.
 */
const users = [];
// Simulating the MpesaTransaction table/collection
const mpesaTransactions = [];

app.post('/api/auth/google-signin', async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ message: 'Authentication token is missing.' });
  }

  try {
    // Verify the ID token with Google
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // --- Database Logic ---
    // 1. Check if the user already exists in your database
    let user = users.find(u => u.googleId === googleId);

    // 2. If not, create a new user
    if (!user) {
      user = {
        id: users.length + 1, // Simple ID generation
        googleId,
        email,
        name,
        picture,
      };
      users.push(user);
      console.log('New user created:', user);
    } else {
      console.log('User already exists:', user);
    }

    // 3. Create a session token (JWT) for the user
    const sessionToken = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });

    // 4. Send the session token and user info back to the client
    res.status(200).json({
      message: 'Authentication successful!',
      token: sessionToken,
      user: { name: user.name, email: user.email, picture: user.picture },
    });

  } catch (error) {
    console.error('Error verifying Google token:', error);
    res.status(401).json({ message: 'Authentication failed. Invalid token.' });
  }
});

// --- M-Pesa Integration ---

// Middleware to generate Safaricom Access Token
const getMpesaAccessToken = async (req, res, next) => {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    
    if (!consumerKey || !consumerSecret) {
        return res.status(500).json({ error: 'M-Pesa credentials missing in .env' });
    }

    const url = process.env.MPESA_ENV === 'production' 
        ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
        : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
    
    const auth = 'Basic ' + Buffer.from(consumerKey + ':' + consumerSecret).toString('base64');

    try {
        const response = await axios.get(url, { headers: { Authorization: auth } });
        req.accessToken = response.data.access_token;
        next();
    } catch (error) {
        console.error('M-Pesa Token Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to get M-Pesa access token' });
    }
};

// 1. Trigger STK Push
app.post('/api/stkpush', getMpesaAccessToken, async (req, res) => {
    const { phone, amount, householdId } = req.body;
    const shortCode = process.env.MPESA_SHORTCODE || '174379';
    const passkey = process.env.MPESA_PASSKEY;
    let callbackUrl = process.env.MPESA_CALLBACK_URL; // Must be HTTPS and publicly accessible (e.g., ngrok)
    const callbackSecret = process.env.MPESA_CALLBACK_SECRET;

    // Append secret token to callback URL for security
    const separator = callbackUrl.includes('?') ? '&' : '?';
    callbackUrl += `${separator}secret=${callbackSecret}`;

    const date = new Date();
    const timestamp = date.getFullYear() +
        ("0" + (date.getMonth() + 1)).slice(-2) +
        ("0" + date.getDate()).slice(-2) +
        ("0" + date.getHours()).slice(-2) +
        ("0" + date.getMinutes()).slice(-2) +
        ("0" + date.getSeconds()).slice(-2);

    const password = Buffer.from(shortCode + passkey + timestamp).toString('base64');

    // Format phone to 254...
    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.startsWith('0')) formattedPhone = '254' + formattedPhone.substring(1);

    const stkUrl = process.env.MPESA_ENV === 'production'
        ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
        : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    const data = {
        "BusinessShortCode": shortCode,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": Math.floor(amount),
        "PartyA": formattedPhone,
        "PartyB": shortCode,
        "PhoneNumber": formattedPhone,
        "CallBackURL": callbackUrl,
        "AccountReference": "ABC Church",
        "TransactionDesc": "Contribution"
    };

    try {
        const response = await axios.post(stkUrl, data, {
            headers: { Authorization: `Bearer ${req.accessToken}` }
        });

        // --- DB PERSISTENCE (Simulated) ---
        // Save the initial transaction state
        const newTransaction = {
            merchantRequestID: response.data.MerchantRequestID,
            checkoutRequestID: response.data.CheckoutRequestID,
            amount: amount,
            phoneNumber: formattedPhone,
            status: 'PENDING',
            householdId: householdId || null,
            created_at: new Date()
        };
        mpesaTransactions.push(newTransaction);
        console.log('Transaction Initiated:', newTransaction);

        res.json(response.data);
    } catch (error) {
        console.error('STK Push Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'STK Push failed', details: error.response?.data });
    }
});

// 2. Callback Route (Safaricom calls this)
app.post('/api/callback', (req, res) => {
    console.log('--- M-Pesa Callback Received ---');
    
    // Security Check: Verify the secret token
    const secret = req.query.secret;
    if (!secret || secret !== process.env.MPESA_CALLBACK_SECRET) {
        console.warn('Unauthorized callback attempt rejected.');
        return res.status(403).json({ error: 'Forbidden' });
    }

    const body = req.body.Body.stkCallback;
    
    // Find transaction in DB
    const transaction = mpesaTransactions.find(t => t.checkoutRequestID === body.CheckoutRequestID);

    if (transaction) {
        transaction.resultCode = body.ResultCode;
        transaction.resultDesc = body.ResultDesc;
        transaction.updated_at = new Date();

        if (body.ResultCode === 0) {
            transaction.status = 'COMPLETED';
            // Extract metadata items
            const meta = body.CallbackMetadata.Item;
            const amtItem = meta.find(i => i.Name === 'Amount');
            const receiptItem = meta.find(i => i.Name === 'MpesaReceiptNumber');
            const dateItem = meta.find(i => i.Name === 'TransactionDate');
            
            if (amtItem) transaction.amount = amtItem.Value;
            if (receiptItem) transaction.mpesaReceiptNumber = receiptItem.Value;
            if (dateItem) transaction.transactionDate = dateItem.Value; // Format: YYYYMMDDHHmmss
        } else {
            transaction.status = 'FAILED';
        }
        console.log('Transaction Updated:', transaction);
    } else {
        console.log('Transaction not found for callback:', body.CheckoutRequestID);
    }
    
    res.json({ result: 'ok' });
});

// 3. Query Status Endpoint (Frontend polls this)
app.post('/api/query-status', async (req, res) => {
    const { checkoutRequestId } = req.body;
    // In a real app, you might query Safaricom API here if your DB isn't updated yet,
    // but usually, checking your own DB is faster if the callback has arrived.
    const transaction = mpesaTransactions.find(t => t.checkoutRequestID === checkoutRequestId);
    
    if (transaction) {
        // Return the status from our DB
        res.json({ 
            ResultCode: transaction.status === 'COMPLETED' ? "0" : (transaction.status === 'PENDING' ? "PENDING" : "1"),
            ResultDesc: transaction.resultDesc || transaction.status
        });
    } else {
        res.status(404).json({ error: 'Transaction not found' });
    }
});

// 4. Admin Endpoint: Get All Transactions
app.get('/api/admin/mpesa-transactions', (req, res) => {
    // Return transactions sorted by newest first
    const sorted = [...mpesaTransactions].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(sorted);
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});