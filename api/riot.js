export default async function handler(req, res) {
  // Allow requests from any origin (CORS fix)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { endpoint } = req.query;
  if (!endpoint) return res.status(400).json({ error: "No endpoint provided" });

  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Riot API key not configured on server" });

  try {
    const separator = endpoint.includes("?") ? "&" : "?";
    const url = `${decodeURIComponent(endpoint)}${separator}api_key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
