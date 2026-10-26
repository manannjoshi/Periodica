"use strict";

// Rate limiting state (in-memory sliding window)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 10;     // Max 10 requests per minute per IP

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "127.0.0.1";
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { limited: false, remaining: MAX_REQUESTS_PER_WINDOW - 1 };
  }
  if (now > entry.resetTime) {
    entry.count = 1;
    entry.resetTime = now + RATE_LIMIT_WINDOW_MS;
    return { limited: false, remaining: MAX_REQUESTS_PER_WINDOW - 1 };
  }
  entry.count++;
  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    return { limited: true, retryAfter };
  }
  return { limited: false, remaining: MAX_REQUESTS_PER_WINDOW - entry.count };
}

// Clean up stale rate-limit entries every 5 minutes
if (typeof setInterval !== "undefined") {
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
      if (now > entry.resetTime) rateLimitMap.delete(ip);
    }
  }, 5 * 60 * 1000);
  if (cleanup.unref) cleanup.unref();
}

// Input Sanitization to prevent prompt injection and DoS
function sanitizeString(str, maxLen = 50) {
  if (typeof str !== "string") return "";
  // Strip control characters, backticks, angle brackets, and enforce max length
  return str.replace(/[\x00-\x1F\x7F<>`\\]/g, "").trim().slice(0, maxLen);
}

function validateAndSanitizeSummary(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid payload: summary must be a valid JSON object.");
  }

  const days = Array.isArray(raw.days)
    ? raw.days.slice(0, 7).map(d => sanitizeString(d, 15)).filter(Boolean)
    : ["Mon", "Tue", "Wed", "Thu", "Fri"];

  const periodsPerDay = Math.min(Math.max(1, parseInt(raw.periodsPerDay, 10) || 8), 24);
  const totalSessions = Math.min(Math.max(0, parseInt(raw.totalSessions, 10) || 0), 2000);
  const clashCount = Math.max(0, parseInt(raw.clashCount, 10) || 0);

  const dailyDistribution = {};
  if (raw.dailyDistribution && typeof raw.dailyDistribution === "object") {
    for (const [day, count] of Object.entries(raw.dailyDistribution).slice(0, 7)) {
      const safeDay = sanitizeString(day, 15);
      if (safeDay) {
        dailyDistribution[safeDay] = Math.max(0, parseInt(count, 10) || 0);
      }
    }
  }

  const teacherLoad = Array.isArray(raw.teacherLoad)
    ? raw.teacherLoad.slice(0, 50).map(t => ({
        teacher: sanitizeString(t?.teacher, 40) || "Unknown",
        sessions: Math.max(0, parseInt(t?.sessions, 10) || 0)
      }))
    : [];

  const courseLoad = Array.isArray(raw.courseLoad)
    ? raw.courseLoad.slice(0, 50).map(c => ({
        course: sanitizeString(c?.course, 30) || "Unknown",
        sessions: Math.max(0, parseInt(c?.sessions, 10) || 0)
      }))
    : [];

  const sectionLoad = Array.isArray(raw.sectionLoad)
    ? raw.sectionLoad.slice(0, 50).map(s => ({
        section: sanitizeString(s?.section, 30) || "Unknown",
        sessions: Math.max(0, parseInt(s?.sessions, 10) || 0)
      }))
    : [];

  return {
    days,
    periodsPerDay,
    totalSessions,
    clashCount,
    dailyDistribution,
    teacherLoad,
    courseLoad,
    sectionLoad
  };
}

const SYSTEM_PROMPT = "You are an academic scheduling expert analyzing a generated timetable. CRITICAL RULES: 1. Course hours and teacher assignments are FIXED academic requirements decided by department syllabus and cannot be changed. Do NOT tell administrators to cut or add course sessions, change curriculum credits, or swap assigned teachers. 2. Focus on schedule execution quality: conflict-free verification, even distribution across days, and daily pace. 3. If clashCount is 0, clearly confirm the timetable is fully conflict-free and valid for publication. 4. Give 1 or 2 practical operational observations for managing the schedule smoothly (such as room turnarounds or peak day monitoring). Format: Short practical analysis. Max 200 words. Plain text only, no markdown, no asterisks, no bold, no underscores.";

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    const msg = { error: "Method not allowed. Use POST." };
    return res.json ? res.json(msg) : res.end(JSON.stringify(msg));
  }

  // Rate Limiting Check
  const clientIp = getClientIp(req);
  const rateStatus = checkRateLimit(clientIp);
  if (rateStatus.limited) {
    res.statusCode = 429;
    res.setHeader("Retry-After", String(rateStatus.retryAfter || 60));
    const msg = { error: `Too many requests. Rate limit is ${MAX_REQUESTS_PER_WINDOW} per minute. Please try again in ${rateStatus.retryAfter} seconds.` };
    return res.json ? res.json(msg) : res.end(JSON.stringify(msg));
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    const msg = { error: "GROQ_API_KEY is not configured on the server. Please check your .env or deployment settings." };
    return res.json ? res.json(msg) : res.end(JSON.stringify(msg));
  }

  try {
    const rawBody = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    
    // Strict Input Validation & Sanitization
    const sanitizedSummary = validateAndSanitizeSummary(rawBody.summary);
    const userMsg = "Summary:\n" + JSON.stringify(sanitizedSummary);

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "User-Agent": "Periodica-Scheduler/1.15"
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg }
        ],
        temperature: 0.3,
        max_completion_tokens: 4096
      })
    });

    const data = await groqResponse.json();
    if (!groqResponse.ok) {
      res.statusCode = groqResponse.status;
      const errorMsg = data.error?.message || "Error calling Groq API";
      return res.json ? res.json({ error: errorMsg }) : res.end(JSON.stringify({ error: errorMsg }));
    }

    const msg = data.choices?.[0]?.message || {};
    const content = msg.content || msg.reasoning || "No analysis generated.";
    
    res.statusCode = 200;
    return res.json ? res.json({ content }) : res.end(JSON.stringify({ content }));
  } catch (err) {
    res.statusCode = err.message && err.message.startsWith("Invalid payload") ? 400 : 500;
    const errorMsg = err.message || "Internal server error";
    return res.json ? res.json({ error: errorMsg }) : res.end(JSON.stringify({ error: errorMsg }));
  }
};
