// api/paypal/create-order.js
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

  const { amount, username } = req.body || {};
  const parsed = parseFloat(amount);
  if (!parsed || parsed < 1 || parsed > 500) return res.status(400).json({ error: "Amount must be between $1 and $500" });
  if (!username) return res.status(400).json({ error: "Missing username" });

  try {
    const accessToken = await getAccessToken();
    const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          amount: { currency_code: "USD", value: parsed.toFixed(2) },
          custom_id: username,
          description: `Runeterra Wagers deposit for ${username}`,
        }],
        application_context: {
          return_url: "https://runeterra-wagers.vercel.app",
          cancel_url: "https://runeterra-wagers.vercel.app",
          brand_name: "Runeterra Wagers",
          user_action: "PAY_NOW",
        },
      }),
    });
    const order = await orderRes.json();
    if (!order.id) return res.status(500).json({ error: "Failed to create PayPal order" });
    return res.status(200).json({ orderID: order.id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
