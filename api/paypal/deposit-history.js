// api/paypal/deposit-history.js
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.POSTGRES_URL);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const username = req.query.username;
  if (!username) return res.status(400).json({ error: "Missing username" });

  try {
    const deposits = await sql`
      SELECT id, amount, paypal_order_id, status, created_at
      FROM deposits WHERE username = ${username}
      ORDER BY created_at DESC LIMIT 50
    `;
    return res.status(200).json({
      deposits: deposits.map(d => ({
        id: Number(d.id),
        amount: Number(d.amount),
        status: d.status,
        created_at: Number(d.created_at)
      }))
    });
  } catch (e) {
    // Table may not exist yet — return empty safely
    return res.status(200).json({ deposits: [] });
  }
};
