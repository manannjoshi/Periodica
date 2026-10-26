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
    generation,
    days,
    periodsPerDay,
    totalSessions,
    clashCount,
    dailyDistribution,
    teacherHighlights,
    roomHighlights,
    studentHighlights,
    teacherLoad,
    courseLoad,
    sectionLoad
  };
}

const SYSTEM_PROMPT = `You are a principal academic scheduling analyst providing a thorough executive briefing on a generated timetable.
CRITICAL RULES:
1. Course hours and teacher assignments are FIXED academic requirements mandated by syllabus and department curriculum—never suggest cutting sessions, adding credits, or swapping assigned faculty.
2. Deliver a comprehensive, in-depth analytical summary (approximately 250 to 350 words) organized into four clear sections:
   - SCHEDULE INTEGRITY & PACING: Confirm conflict-free status, evaluate week-wide session distribution, and overall timetable balance.
   - FACULTY WORKLOAD & CONTINUITY: Highlight specific teachers with peak day loads or consecutive period streaks by name, and analyze teaching continuity.
   - ROOM & FACILITY UTILIZATION: Analyze space utilization rates, call out high-demand rooms or underutilized labs by name, and note turnaround windows.
   - STUDENT COHORT RHYTHM & OPERATIONAL ADVICE: Note cohort heavy/light days, any idle gaps between classes, and provide 2-3 concrete operational tips for campus administrators.
3. Always reference specific teacher names, section labels, room names, and days from the data to keep the analysis concrete and insightful.
Format: Plain text only, organized with clear capitalized section headers as shown above. No markdown asterisks, no bullet asterisks, no bold syntax, no underscores.`;

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
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
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
      error: "GROQ_API_KEY is not configured on Vercel. Please go to Vercel Project Settings > Environment Variables, add GROQ_API_KEY, and redeploy."
    });
  }

  try {
    const rawBody = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    
    // Strict Input Validation & Sanitization
    const sanitizedSummary = validateAndSanitizeSummary(rawBody.summary);
    const userMsg = `Timetable Generation Run: #${sanitizedSummary.generation}\n\nComprehensive Schedule Metrics & Detected Patterns:\n` + JSON.stringify(sanitizedSummary, null, 2);

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
        temperature: 0.7,
        max_completion_tokens: 4096
      })
    });

    const data = await groqResponse.json();
    if (!groqResponse.ok) {
      const errorMsg = data.error?.message || "Error calling Groq API";
      return sendJson(res, groqResponse.status, { error: errorMsg });
    }

    const msg = data.choices?.[0]?.message || {};
    const content = msg.content || msg.reasoning || "No analysis generated.";
    
    return sendJson(res, 200, { content });
  } catch (err) {
    const status = err.message && err.message.startsWith("Invalid payload") ? 400 : 500;
    const errorMsg = err.message || "Internal server error";
    return sendJson(res, status, { error: errorMsg });
  }
};
