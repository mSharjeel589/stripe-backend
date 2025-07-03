// 1) Load environment variables
require("dotenv").config();

// 2) Import libraries
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const jwt = require("jsonwebtoken");
const admin = require('firebase-admin');

// const serviceAccount = require("./serviceAccountKey.json");

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

// Decode the base64
const serviceAccount = JSON.parse(
  Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, "base64").toString("utf8")
);

// Initialize
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// 4) Create Express app
const app = express();

// 5) Middleware
app.use(cors({
  origin: [
    "https://clinquant-bombolone-37d80e.netlify.app",
    "https://snazzy-puffpuff-d160dc.netlify.app"
  ],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 6) Create Stripe Checkout session and Firestore record
app.post("/create-checkout-session", async (req, res) => {
  try {
    // Create Firestore doc with random ID
    const docRef = db.collection("payments").doc();
    const docId = docRef.id;

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Game Play Access",
            },
            unit_amount: 5000, // $50
          },
          quantity: 1,
        },
      ],
      success_url: `https://snazzy-puffpuff-d160dc.netlify.app/?userId=${docId}`,
      cancel_url: "https://clinquant-bombolone-37d80e.netlify.app/cancel",
      metadata: {
        firestoreDocId: docId,
      },
    });

    // Save Firestore record (empty for now)
    await docRef.set({
      amount: 5000,
      played: false,
      createdAt: Date.now(),
      email: null,
      name: null,
      stripeSessionId: session.id,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Error creating checkout session:", err);
    res.status(500).json({ error: err.message });
  }
});

// 7) Webhook to update Firestore after payment success
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const docId = session.metadata.firestoreDocId;
    if (docId) {
      const docRef = db.collection("payments").doc(docId);
      await docRef.update({
        email: session.customer_details?.email || null,
        name: session.customer_details?.name || null,
      });
      console.log(`Payment completed and Firestore updated for docId: ${docId}`);
    }
  }

  res.json({ received: true });
});

// 8) Generate JWT token for secure game access
app.post("/api/generate-token", (req, res) => {
  const token = jwt.sign(
    {
      purpose: "play_access",
      createdAt: Date.now(),
    },
    process.env.JWT_SECRET_KEY,
    { expiresIn: "5m" }
  );
  res.json({ token });
});

// 9) Validate JWT token
app.post("/api/validate-token", (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: "Token required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    res.json({ valid: true });
  } catch (err) {
    console.error("JWT validation failed:", err);
    res.status(403).json({ error: "Invalid or expired token" });
  }
});

// 10) Check payment status (to see if played)
app.post("/api/check-status", async (req, res) => {
  const { userId } = req.body;

  const doc = await db.collection("payments").doc(userId).get();
  if (!doc.exists) {
    return res.status(404).json({ error: "Record not found" });
  }
  res.json({ played: doc.data().played });
});

// 11) Mark payment record as played
app.post("/api/mark-played", async (req, res) => {
  const { userId } = req.body;

  await db.collection("payments").doc(userId).update({
    played: true,
  });
  res.json({ success: true });
});

// 12) Start the server
app.listen(4242, () => console.log("✅ Server running at http://localhost:4242"));
