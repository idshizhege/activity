import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "activity-planner.json");
const DIST_DIR = path.resolve(__dirname, "../hermes_cli/web_dist");
const PORT = Number(process.env.PORT || 9119);
const ADMIN_KEY = String(process.env.ADMIN_KEY || "changeme-admin-key").trim();

const defaultState = {
  eventInfo: {
    title: "五一回来一起聚一聚",
    category: "吃饭 / 小聚 / 续摊自由",
    date: "2025-05-05",
    startTime: "18:30",
    endTime: "22:30",
    location: "市中心商圈 · 地点待最终确认",
    description:
      "大家按自己的情况填写就行，能不能来、几点到、什么时候走、卡在哪一步都写清楚。右侧会自动汇总整体情况，方便群里快速决策。",
  },
  participants: [
    {
      id: randomUUID(),
      token: randomUUID(),
      name: "阿哲",
      status: "yes",
      eta: "18:40",
      leaveAt: "22:30",
      obstacle: "",
      note: "下班直接过去。",
      updatedAt: new Date().toISOString(),
    },
    {
      id: randomUUID(),
      token: randomUUID(),
      name: "小北",
      status: "maybe",
      eta: "19:20",
      leaveAt: "21:40",
      obstacle: "家里有点事，处理完就来。",
      note: "如果能出发会提前在群里说。",
      updatedAt: new Date().toISOString(),
    },
    {
      id: randomUUID(),
      token: randomUUID(),
      name: "可乐",
      status: "no",
      eta: "",
      leaveAt: "",
      obstacle: "当天还在外地。",
      note: "这次不行，下次约。",
      updatedAt: new Date().toISOString(),
    },
  ],
};

let writeQueue = Promise.resolve();

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function sanitizeParticipant(participant) {
  const { token, ...safe } = participant;
  return safe;
}

function formatValidationError(message) {
  return { error: message };
}

function getAdminKey(request) {
  const auth = String(request.headers.authorization || "").trim();
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function assertAdmin(request) {
  const provided = getAdminKey(request);
  return Boolean(ADMIN_KEY && provided && provided === ADMIN_KEY);
}

async function ensureStateFile() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await stat(DATA_FILE);
  } catch {
    await writeFile(DATA_FILE, JSON.stringify(defaultState, null, 2), "utf8");
  }
}

async function loadState() {
  await ensureStateFile();
  const raw = await readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed?.eventInfo || !Array.isArray(parsed?.participants)) {
    return structuredClone(defaultState);
  }
  return parsed;
}

async function saveState(nextState) {
  writeQueue = writeQueue.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(nextState, null, 2), "utf8");
  });
  return writeQueue;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

function findParticipantByToken(participants, token) {
  if (!token) return null;
  return participants.find((item) => item.token === token) ?? null;
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return json(response, 200, { ok: true });
  }

  if (request.method === "GET" && url.pathname === "/api/activity") {
    const state = await loadState();
    const viewerToken = url.searchParams.get("token") || "";
    const mine = findParticipantByToken(state.participants, viewerToken);
    return json(response, 200, {
      eventInfo: state.eventInfo,
      participants: state.participants.map(sanitizeParticipant),
      mySubmission: mine ? sanitizeParticipant(mine) : null,
      viewerToken: mine ? viewerToken : "",
      serverTime: new Date().toISOString(),
    });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/activity") {
    if (!assertAdmin(request)) {
      return json(response, 401, formatValidationError("管理员验证失败"));
    }

    const state = await loadState();
    return json(response, 200, {
      eventInfo: state.eventInfo,
      participants: state.participants.map(sanitizeParticipant),
      serverTime: new Date().toISOString(),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/activity/submissions") {
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return json(response, 400, formatValidationError(error.message));
    }

    const draft = body?.draft ?? {};
    const token = String(body?.token || "").trim();
    const name = String(draft.name || "").trim();
    const status = String(draft.status || "").trim();

    if (!name) {
      return json(response, 400, formatValidationError("请先填写昵称"));
    }

    if (!["yes", "maybe", "no"].includes(status)) {
      return json(response, 400, formatValidationError("参与状态不正确"));
    }

    const state = await loadState();
    const now = new Date().toISOString();
    const normalized = normalizeName(name);
    const existingByToken = findParticipantByToken(state.participants, token);
    const existingByName = state.participants.find((item) => normalizeName(item.name) === normalized) ?? null;
    const target = existingByToken ?? existingByName;
    const nextToken = target?.token || randomUUID();

    const participant = {
      id: target?.id || randomUUID(),
      token: nextToken,
      name,
      status,
      eta: String(draft.eta || "").trim(),
      leaveAt: String(draft.leaveAt || "").trim(),
      obstacle: String(draft.obstacle || "").trim(),
      note: String(draft.note || "").trim(),
      updatedAt: now,
    };

    const participants = target
      ? state.participants.map((item) => (item.id === target.id ? participant : item))
      : [...state.participants, participant];

    const nextState = { ...state, participants };
    await saveState(nextState);

    return json(response, 200, {
      ok: true,
      token: nextToken,
      participant: sanitizeParticipant(participant),
      eventInfo: nextState.eventInfo,
      participants: nextState.participants.map(sanitizeParticipant),
      mySubmission: sanitizeParticipant(participant),
      serverTime: now,
    });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/event") {
    if (!assertAdmin(request)) {
      return json(response, 401, formatValidationError("管理员验证失败"));
    }

    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return json(response, 400, formatValidationError(error.message));
    }

    const eventInfo = body?.eventInfo ?? {};
    const title = String(eventInfo.title || "").trim();
    if (!title) {
      return json(response, 400, formatValidationError("请填写活动标题"));
    }

    const state = await loadState();
    const nextState = {
      ...state,
      eventInfo: {
        title,
        category: String(eventInfo.category || "").trim(),
        date: String(eventInfo.date || "").trim(),
        startTime: String(eventInfo.startTime || "").trim(),
        endTime: String(eventInfo.endTime || "").trim(),
        location: String(eventInfo.location || "").trim(),
        description: String(eventInfo.description || "").trim(),
      },
    };

    await saveState(nextState);
    return json(response, 200, {
      ok: true,
      eventInfo: nextState.eventInfo,
      participants: nextState.participants.map(sanitizeParticipant),
      serverTime: new Date().toISOString(),
    });
  }

  json(response, 404, { error: "接口不存在" });
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  let filePath = path.join(DIST_DIR, url.pathname === "/" ? "/index.html" : url.pathname);

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    filePath = path.join(DIST_DIR, "index.html");
  }

  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
    });
    response.end(data);
  } catch {
    response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("前端静态文件还没构建。先在 web 目录运行 npm run build。");
  }
}

const server = createServer(async (request, response) => {
  if (!request.url || !request.method) {
    return json(response, 400, { error: "无效请求" });
  }

  try {
    if (request.url.startsWith("/api/")) {
      return await handleApi(request, response);
    }
    return await serveStatic(request, response);
  } catch (error) {
    return json(response, 500, { error: error instanceof Error ? error.message : "服务异常" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Activity planner server listening on http://0.0.0.0:${PORT}`);
});
