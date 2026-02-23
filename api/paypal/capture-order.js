// api/paypal/capture-order.js
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.POSTGRES_URL);

const PAYPAL_BASE = process.env.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

async function getAccessToken() {
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Failed to get PayPal access token");
  return data.access_token;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { orderID, username } = req.body || {};
  if (!orderID || !username) return res.status(400).json({ error: "Missing orderID or username" });

  try {
    // Prevent double-capture
    const existing = await sql`SELECT id FROM deposits WHERE paypal_order_id = ${orderID}`;
    if (existing.length > 0) return res.status(409).json({ error: "Order already captured" });

    const accessToken = await getAccessToken();
    const captureRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    const capture = await captureRes.json();

    if (capture.status !== "COMPLETED") return res.status(400).json({ error: "Payment not completed by PayPal" });

    const capturedAmount = parseFloat(
      capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || "0"
    );
    if (!capturedAmount || capturedAmount <= 0) return res.status(400).json({ error: "Could not verify captured amount" });
    if (capturedAmount < 5.00) return res.status(400).json({ error: "Minimum deposit is $5.00" });

    // Security: verify username matches what was set in create-order
    const customId = capture.purchase_units?.[0]?.custom_id;
    if (customId && customId !== username) return res.status(403).json({ error: "Username mismatch" });

    const now = Date.now();
    await sql`UPDATE users SET real_balance = COALESCE(real_balance, 0) + ${capturedAmount} WHERE username = ${username}`;
    await sql`INSERT INTO deposits (id, username, amount, paypal_order_id, status, created_at)
              VALUES (${now}, ${username}, ${capturedAmount}, ${orderID}, 'completed', ${now})`;

    const rows = await sql`SELECT real_balance, skin_credits FROM users WHERE username = ${username}`;
    return res.status(200).json({
      success: true,
      depositedAmount: capturedAmount,
      realBalance: Number(rows[0].real_balance),
      skinCredits: Number(rows[0].skin_credits || 0),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
