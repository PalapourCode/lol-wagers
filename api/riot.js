export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "No API key configured" });

  const { action, gameName, tagLine, region, puuid, summonerId, matchId } = req.query;

  const regions = { euw1: "europe", na1: "americas", kr: "asia", br1: "americas" };
  const routing = regions[region] || "europe";

  let url = "";
  try {
    if (action === "account") {
      url = `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gameName}/${tagLine}`;
    } else if (action === "summoner") {
      url = `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
    } else if (action === "rank") {
      url = `https://${region}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerId}`;
    } else if (action === "matchlist") {
      url = `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&start=0&count=1`;
    } else if (action === "match") {
      url = `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
    } else {
      return res.status(400).json({ error: "Unknown action" });
    }

    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(`${url}${separator}api_key=${apiKey}`);
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
