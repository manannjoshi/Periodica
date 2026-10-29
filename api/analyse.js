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
  // Inline cleanup of old entries without needing setInterval
  if (rateLimitMap.size > 500) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now > v.resetTime) rateLimitMap.delete(k);
    }
  }

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

// Input Sanitization to prevent prompt injection and DoS
function sanitizeString(str, maxLen = 50) {
  if (typeof str !== "string") return "";
  return str.replace(/[\x00-\x1F\x7F<>`\\]/g, "").trim().slice(0, maxLen);
}

function validateAndSanitizeSummary(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid payload: summary must be a valid JSON object.");
  }

  const generation = Math.max(0, parseInt(raw.generation, 10) || 0);

  const teacherHighlights = Array.isArray(raw.teacherHighlights)
    ? raw.teacherHighlights.slice(0, 15).map(s => sanitizeString(s, 120)).filter(Boolean)
    : [];

  const roomHighlights = Array.isArray(raw.roomHighlights)
    ? raw.roomHighlights.slice(0, 15).map(s => sanitizeString(s, 120)).filter(Boolean)
    : [];

  const studentHighlights = Array.isArray(raw.studentHighlights)
    ? raw.studentHighlights.slice(0, 15).map(s => sanitizeString(s, 120)).filter(Boolean)
    : [];

  const days = Array.isArray(raw.days)
    ? raw.days.slice(0, 7).map(d => sanitizeString(d, 15)).filter(Boolean)
    : ["Mon", "Tue", "Wed", "Thu", "Fri"];

  const periodsPerDay = Math.min(Math.max(1, parseInt(raw.periodsPerDay, 10) || 8), 24);
  const totalSessions = Math.min(Math.max(0, parseInt(raw.totalSessions, 10) || 0), 2000);
  const schedule = Array.isArray(raw.schedule)
    ? raw.schedule.slice(0, 1200).map(s => ({
        course: sanitizeString(s?.course, 30) || "Unknown",
        section: sanitizeString(s?.section, 30) || "Unknown",
        batch: sanitizeString(s?.batch, 30),
        teacher: sanitizeString(s?.teacher, 40) || "Unknown",
        room: sanitizeString(s?.room, 40) || "Unknown",
        day: sanitizeString(s?.day, 15) || "Unknown",
        periods: Array.isArray(s?.periods)
          ? [...new Set(s.periods.slice(0, 24).map(p => Math.min(24, Math.max(1, parseInt(p, 10) || 1))))]
          : [],
        times: Array.isArray(s?.times) ? s.times.slice(0, 24).map(t => sanitizeString(t, 20)).filter(Boolean) : []
      }))
    : [];
  const scheduleComplete = raw.scheduleComplete === true && schedule.length === totalSessions &&
    schedule.every(s => s.course !== "Unknown" && s.section !== "Unknown" && s.teacher !== "Unknown" &&
      s.room !== "Unknown" && s.day !== "Unknown" && s.periods.length > 0);
  const unavailable = Array.isArray(raw.unavailable)
    ? raw.unavailable.slice(0, 1200).map(u => ({
        teacher: sanitizeString(u?.teacher, 40) || "Unknown",
        day: sanitizeString(u?.day, 15) || "Unknown",
        periods: Array.isArray(u?.periods)
          ? [...new Set(u.periods.slice(0, 24).map(p => Math.min(24, Math.max(1, parseInt(p, 10) || 1))))]
          : []
      })).filter(u => u.periods.length)
    : [];

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
        periods: Math.max(0, parseInt(t?.periods ?? t?.sessions, 10) || 0)
      }))
    : [];

  const courseLoad = Array.isArray(raw.courseLoad)
    ? raw.courseLoad.slice(0, 50).map(c => ({
        course: sanitizeString(c?.course, 30) || "Unknown",
        periods: Math.max(0, parseInt(c?.periods ?? c?.sessions, 10) || 0)
      }))
    : [];

  const sectionLoad = Array.isArray(raw.sectionLoad)
    ? raw.sectionLoad.slice(0, 50).map(s => ({
        section: sanitizeString(s?.section, 30) || "Unknown",
        periods: Math.max(0, parseInt(s?.periods ?? s?.sessions, 10) || 0)
      }))
    : [];

  return {
    generation,
    days,
    periodsPerDay,
    totalSessions,
    schedule,
    scheduleComplete,
    unavailable,
    dailyDistribution,
    teacherHighlights,
    roomHighlights,
    studentHighlights,
    teacherLoad,
    courseLoad,
    sectionLoad
  };
}

const SYSTEM_PROMPT = `Independently audit the supplied timetable session placements and teacher unavailability. Do not rely on any precomputed conflict verdict or count.
Each session lists the 1-based periods it occupies on its day. Report a conflict when overlapping sessions have the same teacher, same room, or same student cohort. Sessions with the same section conflict if either batch is blank or both batch names match; two different named batches may run simultaneously. Also report sessions placed during the listed teacher unavailability.
If scheduleComplete is false, explicitly say the independent conflict review is incomplete and do not call it conflict-free. Otherwise, inspect every row and state clearly whether the timetable is conflict-free; if not, name the specific clashes with day/period and affected classes. Do not repeat a client-provided conflict count.
Return valid JSON only with exactly these string keys: "conflict", "improvements", and "summary". "improvements" gives at most two concise, actionable setup changes grounded in named teachers/days/rooms. Suggest spreading a busy day, adding room/period capacity, adjusting availability, or redistributing an existing class if qualifications permit. Never remove required meetings. If there is no clear improvement, say the setup looks good. "summary" is exactly two short sentences about schedule balance and workload. Do not repeat these instructions, describe reasoning, or add a preamble.`;

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  if (typeof res.status === "function") {
    res.status(statusCode);
  }
  if (typeof res.json === "function") {
    return res.json(data);
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(data));
}

module.exports = async function handler(req, res) {
  // Same-origin requests need no CORS headers. Cross-origin browser access is
  // allowed only for explicitly configured origins (comma-separated).
  const origin = req.headers.origin;
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map(value => value.trim()).filter(Boolean);
  const isLocalDevelopmentOrigin = process.env.NODE_ENV !== "production" &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "");
  const originAllowed = !!origin && (allowedOrigins.includes(origin) || isLocalDevelopmentOrigin);
  if (originAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  if (req.method === "OPTIONS") {
    res.statusCode = origin && !originAllowed ? 403 : 204;
    return res.end();
  }

  // Health check endpoint for testing in browser or monitoring
  if (req.method === "GET") {
    return sendJson(res, 200, {
      status: "ok",
      service: "Periodica AI Analysis API",
      groqConfigured: !!process.env.GROQ_API_KEY
    });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed. Use POST." });
  }

  // Rate Limiting Check
  const clientIp = getClientIp(req);
  const rateStatus = checkRateLimit(clientIp);
  if (rateStatus.limited) {
    res.setHeader("Retry-After", String(rateStatus.retryAfter || 60));
    return sendJson(res, 429, {
      error: `Too many requests. Rate limit is ${MAX_REQUESTS_PER_WINDOW} per minute. Please try again in ${rateStatus.retryAfter} seconds.`
    });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, {
      error: "GROQ_API_KEY is not configured. Add it in Vercel Project Settings > Environment Variables, then redeploy."
    });
  }

  try {
    const rawBody = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    
    // Strict Input Validation & Sanitization
    const sanitizedSummary = validateAndSanitizeSummary(rawBody.summary);
    const userMsg = `Review the full timetable data and independently produce all three requested report fields:\n` + JSON.stringify(sanitizedSummary, null, 2);

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
        temperature: 0.2,
        max_completion_tokens: 350,
        reasoning_effort: "low",
        include_reasoning: false,
        response_format: { type: "json_object" }
      })
    });

    const data = await groqResponse.json();
    if (!groqResponse.ok) {
      const errorMsg = data.error?.message || "Error calling Groq API";
      return sendJson(res, groqResponse.status, { error: errorMsg });
    }

    const msg = data.choices?.[0]?.message || {};
    const content = msg.content || "";
    
    return sendJson(res, 200, { content });
  } catch (err) {
    const status = err.message && err.message.startsWith("Invalid payload") ? 400 : 500;
    const errorMsg = err.message || "Internal server error";
    return sendJson(res, status, { error: errorMsg });
  }
};
