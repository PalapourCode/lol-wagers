export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Riot API key not configured on server" });

  const { endpoint } = req.query;
  if (!endpoint) return res.status(400).json({ error: "No endpoint provided" });

  try {
    // Decode the endpoint fully before using it
    let url = endpoint;
    let prev = null;
    while (prev !== url) {
      prev = url;
      url = decodeURIComponent(url);
    }
    
    const separator = url.includes("?") ? "&" : "?";
    const finalUrl = `${url}${separator}api_key=${apiKey}`;
    
    console.log("Calling Riot URL:", finalUrl.replace(apiKey, "REDACTED"));
    
    const response = await fetch(finalUrl);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    console.error("Proxy error:", e);
    res.status(500).json({ error: e.message });
  }
}
