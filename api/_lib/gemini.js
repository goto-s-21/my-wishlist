// api/_lib/gemini.js
// Gemini呼び出しのHTTP/パース処理の正本。プロンプトは用途ごとに呼び出し側が渡す。
// GEMINI_API_KEY 未設定なら常に null（=AIをスキップ）。副作用なし。

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/**
 * プロンプトをGeminiに投げ、JSON応答をパースして返す。
 * 失敗・未設定時は null。呼び出し側で必要フィールドを検証すること。
 */
export async function callGeminiJson(prompt) {
  if (!process.env.GEMINI_API_KEY) return null;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
