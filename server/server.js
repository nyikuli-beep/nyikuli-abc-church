const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3000;

// IMPORTANT: Replace with the Client ID you generated in the Google Cloud Console
const GOOGLE_CLIENT_ID = 'PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com';

// IMPORTANT: Use a strong, secret key from an environment variable in a real app
const JWT_SECRET = 'YOUR_SUPER_SECRET_KEY_FOR_JWT';

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// Middleware
app.use(cors()); // Allows requests from your frontend
app.use(express.json()); // Parses incoming JSON requests

/**
 * In-memory database simulation.
 * In a real application, you would use a proper database like PostgreSQL, MongoDB, etc.
 */
const users = [];

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

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});