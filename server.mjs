// バカ人狼 サーバー（依存なし・Node 18+）
// ルームはメモリ保持。フェーズ進行はサーバのタイマーが自律駆動する。クライアントはポーリング。
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createGame, resolveNight, resolveVote, submitAction, submitVote,
  nightActionSpec, alivePlayers, impostorTeammates, isWinner,
  ROLES, FACTION_LABEL, mulberry32,
} from "./engine.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const NIGHT_MS = Number(process.env.NIGHT_MS || 75_000);
const MORNING_MS = Number(process.env.MORNING_MS || 12_000);
const DISCUSS_MS = Number(process.env.DISCUSS_MS || 120_000);
const VOTE_MS = Number(process.env.VOTE_MS || 60_000);
const EXILE_MS = Number(process.env.EXILE_MS || 8_000);

const rooms = new Map();
const BOT_NAMES = ["ボット・タロウ", "ボット・ハナ", "ボット・ジロウ", "ボット・ユキ", "ボット・ケン", "ボット・ミカ", "ボット・ソラ", "ボット・リン", "ボット・ダイ", "ボット・メイ", "ボット・シュン"];

function newCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""); } while (rooms.has(code));
  return code;
}
function newPlayer(name, isBot = false) {
  return { id: randomUUID().slice(0, 8), name: String(name || "名無し").slice(0, 16), isBot, token: randomUUID() };
}
function makeRoom(hostName) {
  const host = newPlayer(hostName);
  const room = {
    code: newCode(), hostId: host.id, players: [host],
    phase: "lobby", phaseEndsAt: null, game: null,
    ready: new Set(), createdAt: Date.now(), botCounter: 0,
    lastExile: null,
  };
  rooms.set(room.code, room);
  return room;
}
function auth(room, playerId, token) {
  const p = room?.players.find((x) => x.id === playerId);
  return p && p.token === token ? p : null;
}

// ---------- ボット ----------
function botRandomAction(room, bot) {
  const g = room.game;
  const me = g.players.get(bot.id);
  const rnd = Math.random;
  const spec = nightActionSpec(g, me);
  if (!spec.hasAction) return { stay: true };
  const others = alivePlayers(g).filter((x) => x.id !== me.id);
  const anyone = alivePlayers(g);
  if (spec.isImpostor && rnd() < 0.5 && others.length) {
    return { mode: "kill", targetId: others[Math.floor(rnd() * others.length)].id };
  }
  if (!spec.kind) return { stay: true };
  if (spec.kind === "bomber" && spec.bombsPlanted > 0 && rnd() < 0.3) return { bomberMode: "detonate" };
  const pool = spec.targetScope === "any" ? anyone : others;
  if (!pool.length) return { stay: true };
  const t = pool[Math.floor(rnd() * pool.length)];
  const act = { targetId: t.id };
  if (spec.extra === "predictRole") {
    const ids = [...Object.keys(ROLES), "baka"];
    act.predictRole = ids[Math.floor(rnd() * ids.length)];
  }
  // ドクター/ポリスの連続制限を避ける
  if ((spec.kind === "doctor" || spec.kind === "police") && me.lastVisitTarget === t.id && pool.length > 1) {
    act.targetId = pool.find((x) => x.id !== me.lastVisitTarget)?.id ?? t.id;
  }
  return act;
}
function scheduleBots(room) {
  const g = room.game;
  if (!g) return;
  for (const p of room.players) {
    if (!p.isBot) continue;
    const gp = g.players.get(p.id);
    if (!gp?.alive) continue;
    if (room.phase === "night" && !g.actions.has(p.id)) {
      setTimeout(() => {
        if (room.phase !== "night" || room.game !== g) return;
        submitAction(g, p.id, botRandomAction(room, p));
      }, 1500 + Math.random() * 6000);
    }
    if (room.phase === "voting" && !g.votes.has(p.id)) {
      setTimeout(() => {
        if (room.phase !== "voting" || room.game !== g) return;
        const others = alivePlayers(g).filter((x) => x.id !== p.id);
        if (others.length) submitVote(g, p.id, others[Math.floor(Math.random() * others.length)].id);
      }, 1500 + Math.random() * 5000);
    }
    if (room.phase === "discussion") room.ready.add(p.id);
  }
}

// ---------- フェーズ進行 ----------
function setPhase(room, phase, ms) {
  room.phase = phase;
  room.phaseEndsAt = ms ? Date.now() + ms : null;
  room.ready.clear();
  if (phase === "night" || phase === "voting" || phase === "discussion") scheduleBots(room);
}
function advance(room) {
  const g = room.game;
  const now = Date.now();
  const timedOut = room.phaseEndsAt && now >= room.phaseEndsAt;
  if (room.phase === "night") {
    const alive = alivePlayers(g);
    if (alive.every((p) => g.actions.has(p.id)) || timedOut) {
      resolveNight(g);
      if (g.finished) return setPhase(room, "finished", null);
      setPhase(room, "morning", MORNING_MS);
    }
  } else if (room.phase === "morning") {
    if (timedOut) setPhase(room, "discussion", DISCUSS_MS);
  } else if (room.phase === "discussion") {
    const alive = alivePlayers(g);
    if (alive.every((p) => room.ready.has(p.id)) || timedOut) setPhase(room, "voting", VOTE_MS);
  } else if (room.phase === "voting") {
    const alive = alivePlayers(g);
    if (alive.every((p) => g.votes.has(p.id)) || timedOut) {
      const res = resolveVote(g);
      room.lastExile = res;
      if (g.finished) return setPhase(room, "finished", null);
      setPhase(room, "exile", EXILE_MS);
    }
  } else if (room.phase === "exile") {
    if (timedOut) {
      g.day += 1;
      setPhase(room, "night", NIGHT_MS);
    }
  }
}
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.game && !["lobby", "finished"].includes(room.phase)) advance(room);
    if (Date.now() - room.createdAt > 1000 * 60 * 60 * 6) rooms.delete(room.code);
  }
}, 500);

// ---------- 状態ビュー（プレイヤーごとに情報を絞る） ----------
function stateFor(room, me) {
  const g = room.game;
  const base = {
    code: room.code, phase: room.phase, phaseEndsAt: room.phaseEndsAt,
    isHost: room.hostId === me.id,
    players: room.players.map((p) => {
      const gp = g?.players.get(p.id);
      return {
        id: p.id, name: p.name, isBot: p.isBot, isMe: p.id === me.id,
        alive: gp ? gp.alive : true,
        publicReveal: gp?.publicReveal ?? null,
        acted: g ? (room.phase === "night" ? g.actions.has(p.id) : room.phase === "voting" ? g.votes.has(p.id) : null) : null,
      };
    }),
    publicLog: g ? g.publicLog : [],
    day: g ? g.day : 0,
    lastExile: room.lastExile,
  };
  if (!g) return base;
  const meG = g.players.get(me.id);
  base.me = {
    id: me.id, alive: meG.alive,
    roleLabel: ROLES[meG.displayRole]?.label ?? meG.displayRole,
    factionLabel: FACTION_LABEL[meG.displayFaction],
    faction: meG.displayFaction,
    usesLeft: meG.usesLeft,
    survivorCharges: meG.role === "survivor" || meG.displayRole === "survivor" ? meG.survivorCharges : null,
    bombsPlanted: meG.bombs.length,
    teammates: impostorTeammates(g, meG),
    privateLog: meG.privateLog,
    myActionDone: g.actions.has(me.id),
    myVoteDone: g.votes.has(me.id),
    iAmReady: room.ready.has(me.id),
  };
  if (room.phase === "night" && meG.alive) {
    base.nightSpec = nightActionSpec(g, meG);
    base.targets = alivePlayers(g).map((p) => ({ id: p.id, name: p.name, isMe: p.id === me.id }));
  }
  if (room.phase === "voting" && meG.alive) {
    base.targets = alivePlayers(g).filter((p) => p.id !== me.id).map((p) => ({ id: p.id, name: p.name }));
  }
  if (g.finished) {
    base.finished = {
      endReason: g.endReason,
      winners: g.winners,
      iWon: isWinner(g, meG),
      reveal: [...g.players.values()].map((p) => ({
        id: p.id, name: p.name, alive: p.alive,
        trueRole: p.role === "baka" ? `バカ（${ROLES[p.displayRole]?.label}だと思い込んでいた）` : (ROLES[p.role]?.label ?? p.role),
        factionLabel: FACTION_LABEL[p.faction],
        won: isWinner(g, p),
      })),
    };
  }
  return base;
}

// ---------- HTTP ----------
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { return {}; }
}
function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      let html;
      try { html = await readFile(path.join(__dir, "public", "index.html"), "utf-8"); }
      catch { html = await readFile(path.join(__dir, "index.html"), "utf-8"); } // GitHub直置き構成のフォールバック
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "POST" && url.pathname === "/api/create") {
      const { name } = await readJson(req);
      const room = makeRoom(name);
      const host = room.players[0];
      return send(res, 200, { code: room.code, playerId: host.id, token: host.token });
    }
    if (req.method === "POST" && url.pathname === "/api/join") {
      const { name, code } = await readJson(req);
      const room = rooms.get(String(code || "").toUpperCase());
      if (!room) return send(res, 404, { error: "ルームが見つかりません" });
      if (room.phase !== "lobby") return send(res, 400, { error: "ゲームが始まっています" });
      if (room.players.length >= 12) return send(res, 400, { error: "満員です" });
      const p = newPlayer(name);
      room.players.push(p);
      return send(res, 200, { code: room.code, playerId: p.id, token: p.token });
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      const room = rooms.get(url.searchParams.get("room") || "");
      if (!room) return send(res, 404, { error: "ルームが見つかりません" });
      const me = auth(room, url.searchParams.get("player"), url.searchParams.get("token"));
      if (!me) return send(res, 403, { error: "認証エラー" });
      return send(res, 200, stateFor(room, me));
    }
    const body = await readJson(req);
    const room = rooms.get(String(body.code || "").toUpperCase());
    if (!room) return send(res, 404, { error: "ルームが見つかりません" });
    const me = auth(room, body.playerId, body.token);
    if (!me) return send(res, 403, { error: "認証エラー" });

    if (req.method === "POST" && url.pathname === "/api/addbot") {
      if (room.hostId !== me.id || room.phase !== "lobby") return send(res, 400, { error: "ホストのみ／ロビーでのみ可能" });
      if (room.players.length >= 12) return send(res, 400, { error: "満員です" });
      const bot = newPlayer(BOT_NAMES[room.botCounter++ % BOT_NAMES.length], true);
      room.players.push(bot);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/start") {
      if (room.hostId !== me.id || room.phase !== "lobby") return send(res, 400, { error: "ホストのみ開始できます" });
      if (room.players.length < 4) return send(res, 400, { error: "4人以上必要です" });
      room.game = createGame(room.players.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot })), mulberry32(Date.now() % 2147483647));
      room.lastExile = null;
      setPhase(room, "night", NIGHT_MS);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/action") {
      if (room.phase !== "night" || !room.game) return send(res, 400, { error: "夜フェーズではありません" });
      submitAction(room.game, me.id, body.action ?? {});
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/vote") {
      if (room.phase !== "voting" || !room.game) return send(res, 400, { error: "投票フェーズではありません" });
      submitVote(room.game, me.id, body.targetId ?? null);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/ready") {
      if (room.phase !== "discussion") return send(res, 400, { error: "議論フェーズではありません" });
      room.ready.add(me.id);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/rematch") {
      if (room.hostId !== me.id || room.phase !== "finished") return send(res, 400, { error: "ホストのみ／終了後のみ可能" });
      room.game = null;
      room.lastExile = null;
      setPhase(room, "lobby", null);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: String(e?.message ?? e) });
  }
});
server.listen(PORT, () => console.log(`baka-jinrou server on :${PORT}`));
