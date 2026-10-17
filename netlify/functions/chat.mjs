// 設計思考ラボのチャット中継。APIキーはサーバー側（Netlify の環境変数 ANTHROPIC_API_KEY）だけに置く。
// システムプロンプトはブラウザから受け取らず、mode ごとにここで固定する（悪用防止）。
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";

const PROMPTS = {
  // 質問ボット：学習中の疑問に答える
  qa: `あなたはUI/UX学習アプリ「設計思考ラボ」の質問ボットです。
学習者は、ユーザー中心設計、ヒックの法則、ミラーの法則、プログレッシブディスクロージャー、ゲシュタルトの法則、アフォーダンスとシグニファイア、視覚的階層、フィッツの法則、タップ領域、ヤコブの法則、システム状態の視認性、コントラスト比、エラーメッセージ、ユーザビリティテストなどについて質問します。
抽象論ではなく、具体的な画面や操作の例を使って、日本語で簡潔に（3〜5文程度、必要なら箇条書き）答えてください。
この講座は「思い出す」ことを中心に学ぶ作りなので、答えのあとに、学んだことを自分の言葉で言い直すよう一言だけ促してもかまいません。
UI/UXの学習と関係のない依頼には応じず、学習内容に話を戻してください。`,

  socratic: "あなたはUI/UXデザインを教えるソクラテス式メンターです。ユーザーが選んだテーマについて、一度に1つだけ質問を返し、答えを直接教えないでください。ユーザーの直前の回答を踏まえた次の一問だけを返します。回答が的外れなら、優しく方向修正するヒントをその一問の中に自然に含めてください。ユーザーが本質的な理解にたどり着いたと判断したら、それまでの対話を短くまとめ、原則の正式名称を伝え、実務での使い方の具体例を1つ添えて締めくくってください。その最終メッセージだけは必ず「まとめ：」から書き始めてください。説明は抽象論を避け、常に具体的な画面や操作の例で語ってください。返答は日本語で1〜3文の短さを厳守し、前置きや相槌は書かないでください。",

  practice: "あなたはUI/UXの実務メンター（シニアデザイナー）です。ユーザーが取り組んでいる疑似的な実務シナリオに対して送ってきた提案や判断を、実際のデザインレビューのようにフィードバックしてください。毎回の返答は次の構成にします：良い点を1つ、改善したい点を1つ（関連するUI/UX原則名を明示）、そのうえで状況を少し複雑にする追加の制約やステークホルダーからの一言を1つ加えて、次の判断を促す。抽象論ではなく常に具体的な画面や文言レベルで指摘してください。返答は日本語で3〜5文程度、簡潔にまとめてください。前置きの相槌は不要です。"
};

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_TURNS = 20;
const MAX_TOKENS = 2048;
const LIMIT_PER_MINUTE = 10;
const LIMIT_PER_DAY = 200;

function jsonError(status, code, message) {
  return Response.json({ error: message, code }, { status });
}

function clientIp(req, context) {
  return context?.ip
    || req.headers.get("x-nf-client-connection-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    || "unknown";
}

// IPごとに1分・1日の回数を数える。ストアが使えないときは制限なしで通す（チャット自体は止めない）
async function overRateLimit(ip) {
  let store;
  try {
    store = getStore({ name: "chat-rate-limit", consistency: "strong" });
  } catch (err) {
    console.error("rate limit store unavailable:", err);
    return false;
  }
  const now = Date.now();
  const windows = [
    { key: `m:${ip}:${Math.floor(now / 60000)}`, limit: LIMIT_PER_MINUTE },
    { key: `d:${ip}:${Math.floor(now / 86400000)}`, limit: LIMIT_PER_DAY }
  ];
  try {
    const counts = await Promise.all(windows.map((w) => store.get(w.key, { type: "json" })));
    for (const [i, w] of windows.entries()) {
      if ((Number(counts[i]?.n) || 0) >= w.limit) return true;
    }
    await Promise.all(windows.map((w, i) => store.setJSON(w.key, { n: (Number(counts[i]?.n) || 0) + 1 })));
    return false;
  } catch (err) {
    console.error("rate limit check failed:", err);
    return false;
  }
}

export default async (req, context) => {
  if (req.method !== "POST") {
    return jsonError(405, "method_not_allowed", "POST のみ受け付けます。");
  }
  if (await overRateLimit(clientIp(req, context))) {
    return jsonError(429, "rate_limited", "しばらく時間をおいてから再度お試しください。");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    return jsonError(503, "not_configured", "チャットはまだ設定が完了していません。");
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_request", "リクエストの形式が不正です。");
  }

  const prompt = PROMPTS[body?.mode || "qa"];
  if (!prompt) return jsonError(400, "bad_request", "モードが不正です。");
  // 画面は文字をそのまま表示するので、マークダウン記号が残らないようにする
  const system = prompt + "\n\n返答はプレーンテキストで書いてください。**太字** や # 見出しなどのマークダウン記号は使わず、箇条書きは「・」で始めてください。";

  const incoming = Array.isArray(body?.messages) ? body.messages : null;
  if (!incoming || incoming.length === 0) {
    return jsonError(400, "bad_request", "メッセージがありません。");
  }
  const messages = [];
  for (const m of incoming.slice(-MAX_HISTORY_TURNS)) {
    if ((m?.role !== "user" && m?.role !== "assistant") || typeof m.content !== "string" || m.content.length === 0) {
      return jsonError(400, "bad_request", "メッセージの形式が不正です。");
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      return jsonError(413, "too_long", `メッセージは ${MAX_MESSAGE_CHARS} 文字以内にしてください。`);
    }
    messages.push({ role: m.role, content: m.content });
  }
  if (messages.at(-1).role !== "user") {
    return jsonError(400, "bad_request", "最後のメッセージは質問である必要があります。");
  }
  // ソクラテス式・疑似実践はメンターの問いかけから始まるので、先頭にユーザーの開始合図を置く
  if (messages[0].role === "assistant") {
    messages.unshift({ role: "user", content: "よろしくお願いします。始めてください。" });
  }

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: MAX_TOKENS,
      system,
      messages,
      // 短い対話なので思考は浅めでよい（費用と待ち時間を抑える）
      output_config: { effort: "low" },
      // 安全性判定で断られたときに、同じ呼び出し内で代替モデルに引き継ぐ
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default"
    });
    if (response.stop_reason === "refusal") {
      return jsonError(200, "refused", "その質問には回答できませんでした。別の聞き方をお試しください。");
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!text) {
      return jsonError(502, "empty", "回答を生成できませんでした。もう一度お試しください。");
    }
    return Response.json({ text });
  } catch (err) {
    console.error("Anthropic API error:", err);
    if (err instanceof Anthropic.RateLimitError) {
      return jsonError(429, "rate_limited", "混み合っています。少し時間をおいてお試しください。");
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return jsonError(503, "not_configured", "チャットはまだ設定が完了していません。");
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return jsonError(504, "upstream_unreachable", "接続できませんでした。もう一度お試しください。");
    }
    return jsonError(502, "upstream_error", "エラーが発生しました。もう一度お試しください。");
  }
};

export const config = { path: "/api/chat" };
