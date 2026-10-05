// Vercel serverless функциясы: Gemini API кілті тек серверде сақталады.
// Vercel → Settings → Environment Variables: GEMINI_API_KEY (міндетті), GEMINI_MODEL (міндетті емес)

const SYSTEM = {
  solve:
    "Сен қазақ тілінде жауап беретін мейірімді математика мұғалімісің. Есепті мына тәртіппен шеш: " +
    "1) есеп түрі, 2) қолданылатын әдіс, 3) нөмірленген қадамдар, 4) **Жауабы:** қысқа соңғы жауап, " +
    "5) жауапты есепке қайта қойып тексер. Формулаларды LaTeX емес, қарапайым мәтінмен жаз (x^2, sqrt(3), 1/2). " +
    "Суретте есеп болса, алдымен шартын жазып ал. Есеп шарты толық болмаса, не жетіспейтінін айт.",
  chat:
    "Сен қазақ тілінде жауап беретін, Python, жасанды интеллект және математика бойынша оқушыларға көмектесетін " +
    "тьюторсың. Қысқа, түсінікті, мысалмен түсіндір. Код керек болса Python қолдан. Формулаларды LaTeX емес, " +
    "қарапайым мәтінмен жаз. Оқуға қатысты емес зиянды сұрауларға көмектеспе.",
};

const hits = new Map(); // IP бойынша жеңіл шектеу (тегін кілтті қорғау үшін)
const LIMIT = 25, WINDOW = 10 * 60 * 1000;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Тек POST сұрауы қабылданады" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "Серверде GEMINI_API_KEY қойылмаған" });

  const ip = String(req.headers["x-forwarded-for"] || "anon").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
  if (recent.length >= LIMIT)
    return res.status(429).json({ error: "Сұраныс тым көп. Бірнеше минуттан кейін қайталаңыз." });
  recent.push(now);
  hits.set(ip, recent);

  try {
    const { mode = "chat", messages = [], image } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "Хабарлама бос" });
    const total = messages.reduce((n, m) => n + String(m.text || "").length, 0);
    if (total > 12000) return res.status(400).json({ error: "Мәтін тым ұзын" });
    if (image && String(image.data || "").length > 3.5 * 1024 * 1024)
      return res.status(400).json({ error: "Сурет тым үлкен" });

    const contents = messages.slice(-12).map((m, i, arr) => {
      const parts = [{ text: String(m.text || "").slice(0, 6000) }];
      if (image && i === arr.length - 1 && m.role === "user")
        parts.push({ inline_data: { mime_type: image.mime || "image/jpeg", data: image.data } });
      return { role: m.role === "model" ? "model" : "user", parts };
    });

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM[mode] || SYSTEM.chat }] },
        contents,
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = r.status === 429 ? "Gemini тегін шегіне жетті. Біраздан кейін қайталаңыз." : "Gemini қатесі: " + (data.error?.message || r.status);
      return res.status(502).json({ error: msg });
    }
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (!text) return res.status(502).json({ error: "AI бос жауап қайтарды. Сұрақты басқаша жазып көріңіз." });
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "Сервер қатесі. Қайталап көріңіз." });
  }
};
