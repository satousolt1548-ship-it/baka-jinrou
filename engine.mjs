// バカ人狼 ゲームエンジン（依存なし・純粋ロジック）
// 仕様: ~/workspace/baka_jinrou/plan.md（Feign方式）
// 乱数は差し替え可能（テスト用にseed付きRNGを渡せる）

export const FACTIONS = { INNOCENT: "innocent", IMPOSTOR: "impostor", NEUTRAL: "neutral" };
export const FACTION_LABEL = { innocent: "イノセント", impostor: "インポスター", neutral: "ニュートラル" };

// 役職定義。visit: 夜に相手の家を訪問するか / uses: 使用回数制限（null=無制限）
export const ROLES = {
  doctor:       { label: "ドクター",         factions: ["innocent"],            visit: true,  uses: null },
  blamer:       { label: "ブレイマー",       factions: ["impostor"],            visit: true,  uses: 2 },
  cleaner:      { label: "クリーナー",       factions: ["impostor"],            visit: false, uses: null },
  mouse:        { label: "ねずみ",           factions: ["innocent", "impostor"], visit: true,  uses: 1 },
  police:       { label: "ポリス",           factions: ["innocent", "impostor"], visit: true,  uses: null },
  trapper:      { label: "トラッパー",       factions: ["innocent", "impostor"], visit: true,  uses: null },
  lookout:      { label: "ルックアウト",     factions: ["innocent", "impostor"], visit: true,  uses: null },
  investigator: { label: "インベスティゲーター", factions: ["innocent", "impostor"], visit: true, uses: null },
  provoker:     { label: "挑発者",           factions: ["innocent", "impostor"], visit: true,  uses: 2 },
  tracker:      { label: "トラッカー",       factions: ["innocent", "impostor"], visit: true,  uses: null },
  serial_killer:{ label: "シリアルキラー",   factions: ["neutral"],             visit: true,  uses: null },
  bomber:       { label: "ボマー",           factions: ["neutral"],             visit: true,  uses: null },
  survivor:     { label: "サバイバー",       factions: ["neutral"],             visit: false, uses: null },
  thief:        { label: "シーフ",           factions: ["neutral"],             visit: true,  uses: null },
  magician:     { label: "魔術師",           factions: ["neutral"],             visit: false, uses: null },
  ghost:        { label: "ゴースト",         factions: ["neutral"],             visit: true,  uses: null },
};
export const ROLE_IDS = Object.keys(ROLES);
const DUAL_ROLES = ROLE_IDS.filter((r) => ROLES[r].factions.length === 2);
const INFO_ROLES = ["mouse", "investigator", "lookout", "tracker"];
const KILLER_NEUTRALS = ["serial_killer", "bomber", "magician"];
const NONKILLER_NEUTRALS = ["survivor", "thief", "ghost"];
const NEUTRAL_ROLES = [...KILLER_NEUTRALS, ...NONKILLER_NEUTRALS];
// バカが偽装できる役職（イノセントに見えるもの。挑発者はFeign準拠で除外）
const BAKA_FAKE_POOL = [...DUAL_ROLES.filter((r) => r !== "provoker"), "doctor"];

// 人数別の陣営構成（plan.md の表）
export const COMPOSITION = {
  4:  { innocent: 3, impostor: 1, neutral: 0 },
  5:  { innocent: 3, impostor: 1, neutral: 1 },
  6:  { innocent: 4, impostor: 2, neutral: 0 },
  7:  { innocent: 4, impostor: 2, neutral: 1 },
  8:  { innocent: 5, impostor: 2, neutral: 1 },
  9:  { innocent: 6, impostor: 2, neutral: 1 },
  10: { innocent: 6, impostor: 3, neutral: 1 },
  11: { innocent: 7, impostor: 3, neutral: 1 },
  12: { innocent: 7, impostor: 3, neutral: 2 },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pick(arr, rnd) { return arr[Math.floor(rnd() * arr.length)]; }
function draw(arr, rnd) { // arrから1つ取り除いて返す
  const i = Math.floor(rnd() * arr.length);
  return arr.splice(i, 1)[0];
}

// 役職の割り当て。players: [{id, name, isBot}] を受け取り、
// 各プレイヤーに { role, faction, isBaka, displayRole } を割り当てた配列を返す。
export function assignRoles(playerIds, rnd) {
  const n = playerIds.length;
  const comp = COMPOSITION[n];
  if (!comp) throw new Error(`unsupported player count: ${n}`);
  const slots = []; // { role, faction, isBaka, displayRole }

  // --- ニュートラル（殺傷系は合計1人まで） ---
  if (comp.neutral > 0) {
    const killer = pick(KILLER_NEUTRALS, rnd);
    if (comp.neutral === 1) {
      const role = rnd() < 0.5 ? killer : pick(NONKILLER_NEUTRALS, rnd);
      slots.push({ role, faction: "neutral", isBaka: false, displayRole: role });
    } else {
      slots.push({ role: killer, faction: "neutral", isBaka: false, displayRole: killer });
      const other = pick(NONKILLER_NEUTRALS, rnd);
      slots.push({ role: other, faction: "neutral", isBaka: false, displayRole: other });
    }
  }

  // --- インポスター（2人以上なら専用役職を最低1つ） ---
  {
    const usedImp = new Set();
    const impPoolDual = () => DUAL_ROLES.filter((r) => !usedImp.has(r));
    for (let i = 0; i < comp.impostor; i++) {
      let role;
      if (i === 0 && comp.impostor >= 2) {
        role = pick(["blamer", "cleaner"], rnd);
      } else if (i === 0 && rnd() < 0.4) {
        role = pick(["blamer", "cleaner"], rnd);
      } else {
        role = draw(impPoolDual(), rnd) ?? pick(["blamer", "cleaner"], rnd);
      }
      if (DUAL_ROLES.includes(role)) usedImp.add(role);
      slots.push({ role, faction: "impostor", isBaka: false, displayRole: role });
    }
  }

  // --- イノセント ---
  {
    const usedInnocentReal = new Set(); // 同陣営の本物重複はなし（バカの偽装だけ被ってよい）
    const innoSlots = [];
    // バカの偽装先（6人以下ではドクターを外す）
    const fakePool = BAKA_FAKE_POOL.filter((r) => !(n <= 6 && r === "doctor"));
    const fakeRole = pick(fakePool, rnd);
    // 本物の情報系を1つ保証（バカではない）
    const infoRole = pick(INFO_ROLES, rnd);
    innoSlots.push({ role: infoRole, faction: "innocent", isBaka: false, displayRole: infoRole });
    usedInnocentReal.add(infoRole);
    // 6人以下ではドクター（本物）を保証
    if (n <= 6) {
      innoSlots.push({ role: "doctor", faction: "innocent", isBaka: false, displayRole: "doctor" });
      usedInnocentReal.add("doctor");
    }
    // バカ枠
    innoSlots.push({ role: "baka", faction: "innocent", isBaka: true, displayRole: fakeRole });
    // 残りを充填（本物の重複なし）
    const fillPool = ["doctor", ...DUAL_ROLES].filter((r) => !usedInnocentReal.has(r));
    while (innoSlots.length < comp.innocent) {
      const role = fillPool.length ? draw(fillPool, rnd) : pick(DUAL_ROLES, rnd);
      usedInnocentReal.add(role);
      innoSlots.push({ role, faction: "innocent", isBaka: false, displayRole: role });
    }
    slots.push(...innoSlots);
  }

  const shuffledSlots = shuffle(slots, rnd);
  const shuffledPlayers = shuffle(playerIds, rnd);
  return shuffledPlayers.map((id, i) => ({ playerId: id, ...shuffledSlots[i] }));
}

// ---------------- ゲーム状態 ----------------

export function createGame(playerList, rnd) {
  const assignments = assignRoles(playerList.map((p) => p.id), rnd);
  const byId = new Map(assignments.map((a) => [a.playerId, a]));
  const players = new Map();
  for (const p of playerList) {
    const a = byId.get(p.id);
    const uses = a.isBaka ? (ROLES[a.displayRole].uses ?? null) : (ROLES[a.role]?.uses ?? null);
    players.set(p.id, {
      id: p.id, name: p.name, isBot: !!p.isBot,
      role: a.role,                 // 本当の役職（バカは "baka"）
      faction: a.faction,            // 現在の所属陣営（シーフの盗みで変化）
      displayRole: a.displayRole,    // 本人が信じている役職
      displayFaction: a.faction,     // 本人が信じている陣営（バカはイノセント）
      isBaka: a.isBaka,
      alive: true,
      deathCause: null, diedOnDay: null,
      publicReveal: null,            // 公開された { roleLabel, factionLabel } or "unknown"
      usesLeft: uses,
      survivorCharges: a.role === "survivor" ? 3 : 0,
      lastVisitTarget: null,         // ドクター/ポリスの連続訪問制限
      bombs: [],                     // ボマー: 爆弾を仕掛けた相手のid
      candleTarget: null,            // ゴースト: 現在のろうそく対象
      cleanerMark: null,             // クリーナー: 現在のマーク対象
      lastProvoke: null,             // 挑発者: { targetId, day }
      provokedToday: 0,              // 今日背負っている挑発票（+2）
      privateLog: [],                // 個人宛ての通知（朝の結果など）
      stolenFrom: null,              // シーフが盗んだ元役職
    });
  }
  return {
    players,
    day: 1,
    actions: new Map(),
    votes: new Map(),
    publicLog: [],
    ghostDrag: null,      // { ghostId, targetId } 追放されたゴーストの道連れ予約
    mouseUsedLastNight: false,
    finished: false,
    endReason: null,
    winners: null,        // { faction: "innocent"|"impostor"|"neutral"|null, personal: [{playerId, reason}] }
    rnd,
  };
}

export function alivePlayers(game) {
  return [...game.players.values()].filter((p) => p.alive);
}
export function getPlayer(game, id) { return game.players.get(id); }

// そのプレイヤーが「行動する役職」として使う役職（バカは偽装先、シーフは盗んだ先）
export function actingRole(player) {
  return player.isBaka ? player.displayRole : player.role;
}

// 夜の行動入力の仕様（クライアントUI生成用）
export function nightActionSpec(game, player) {
  if (!player.alive || game.finished) return { canAct: false };
  const role = actingRole(player);
  const isImp = player.faction === "impostor" && !player.isBaka;
  const spec = {
    canAct: true,
    role, roleLabel: ROLES[role]?.label ?? role,
    isImpostor: isImp,
    canKill: isImp,
    usesLeft: player.usesLeft,
    kind: null, needsTarget: false, targetScope: "others", extra: null,
  };
  switch (role) {
    case "doctor": spec.kind = "doctor"; spec.needsTarget = true; break;
    case "police": spec.kind = "police"; spec.needsTarget = true; break;
    case "trapper": spec.kind = "trapper"; spec.needsTarget = true; spec.targetScope = "any"; break;
    case "lookout": spec.kind = "lookout"; spec.needsTarget = true; spec.targetScope = "any"; break;
    case "investigator": spec.kind = "investigator"; spec.needsTarget = true; break;
    case "mouse":
      if (player.usesLeft > 0) { spec.kind = "mouse"; spec.needsTarget = true; }
      break;
    case "tracker": spec.kind = "tracker"; spec.needsTarget = true; break;
    case "blamer":
      if (player.usesLeft > 0) { spec.kind = "blamer"; spec.needsTarget = true; }
      break;
    case "cleaner": spec.kind = "cleaner"; spec.needsTarget = true; spec.targetScope = "any"; break;
    case "provoker":
      if (player.usesLeft > 0) { spec.kind = "provoker"; spec.needsTarget = true; }
      break;
    case "serial_killer": spec.kind = "sk_kill"; spec.needsTarget = true; break;
    case "bomber":
      spec.kind = "bomber"; spec.needsTarget = true; spec.extra = "bomberMode";
      spec.bombsPlanted = player.bombs.length;
      break;
    case "thief": spec.kind = "thief_kill"; spec.needsTarget = true; break;
    case "magician": spec.kind = "magician"; spec.needsTarget = true; spec.extra = "predictRole"; break;
    case "ghost": spec.kind = "ghost"; spec.needsTarget = true; break;
    default: break; // survivor等は行動なし
  }
  if (isImp) spec.kind = spec.kind ?? "none"; // インポスターは仕事がなくても襲撃はできる
  spec.hasAction = isImp || spec.kind !== null;
  return spec;
}

const NO_SELF = new Set(["doctor", "police", "mouse", "investigator", "tracker", "blamer", "provoker", "sk_kill", "thief_kill", "magician", "ghost", "kill"]);

// 行動の正規化と検証。無効な行動は { type: "none" } に倒し、理由を返す。
export function normalizeAction(game, player, raw) {
  const none = (reason) => ({ type: "none", reason });
  if (!raw || typeof raw !== "object") return none("no input");
  const spec = nightActionSpec(game, player);
  if (!spec.canAct) return none("cannot act");

  // インポスターの襲撃
  if (spec.isImpostor && raw.mode === "kill") {
    const t = game.players.get(raw.targetId);
    if (!t || !t.alive || t.id === player.id) return none("invalid kill target");
    return { type: "kill", targetId: t.id };
  }

  const kind = spec.kind;
  if (!kind || kind === "none") return none("no role action");
  if (raw.mode === "stay" || raw.stay) return none("stayed home");

  if (kind === "bomber" && raw.bomberMode === "detonate") {
    if (player.bombs.length === 0) return none("no bombs planted");
    return { type: "bomber_detonate" };
  }

  const t = game.players.get(raw.targetId);
  if (!t || !t.alive) return none("invalid target");
  if (NO_SELF.has(kind) && t.id === player.id) return none("self target not allowed");

  // ドクター/ポリスの連続訪問制限
  if ((kind === "doctor" || kind === "police") && player.lastVisitTarget === t.id) {
    return none("same target two nights in a row");
  }
  // 使用回数
  if ((kind === "mouse" || kind === "blamer" || kind === "provoker") && !(player.usesLeft > 0)) {
    return none("no uses left");
  }
  const action = { type: kind, targetId: t.id };
  if (kind === "bomber") action.type = "bomber_plant";
  if (kind === "magician") {
    if (!ROLE_IDS.includes(raw.predictRole) && raw.predictRole !== "baka") return none("invalid prediction");
    action.predictRole = raw.predictRole;
  }
  return action;
}

export function submitAction(game, playerId, raw) {
  const player = game.players.get(playerId);
  if (!player) return;
  game.actions.set(playerId, normalizeAction(game, player, raw));
}

// ---------------- 夜の解決 ----------------

const VISIT_TYPES = new Set(["doctor", "police", "trapper", "lookout", "investigator", "mouse", "tracker", "blamer", "provoker", "kill", "sk_kill", "thief_kill", "ghost", "bomber_plant"]);
const INFO_TYPES = new Set(["mouse", "investigator", "lookout", "tracker"]);

function shownIdentity(game, target, { blamed, cleaned}) {
if (cleaned) return { unknown: true};
// バカは調査で「バカ」と判明する（本当の役職がないため）
const role = target.role;
let faction = target.faction;
if (blamed) {
faction = "impostor";
if (role === "doctor") return { role: "cleaner", faction};
if (role === "baka") return { role: pickFakeRole(game), faction};
if (NEUTRAL_ROLES.includes(role)) return { role: pickFakeRole(game), faction};
return { role, faction};
}
return { role, faction};
}
function pickFakeRole(game) {
return DUAL_ROLES[Math.floor(game.rnd() * DUAL_ROLES.length)];
}
function randomFakeIdentity(game) {
const role = pickFakeRole(game);
const f = ROLES[role].factions;
return { role, faction: f[Math.floor(game.rnd() * f.length)]};
}
function identityText(idn) {
if (!idn || idn.unknown) return "不明";
if (idn.role === "baka") return `バカ（${FACTION_LABEL[idn.faction]}）`;
return `${ROLES[idn.role]?.label?? idn.role}（${FACTION_LABEL[idn.faction]}）`;
}
function publicRevealOf(player) {
if (player.role === "baka") {
return { text: `バカ（${ROLES[player.displayRole]?.label}だと思い込んでいた）`, faction: "innocent"};
}
return { text: `${ROLES[player.role]?.label}（${FACTION_LABEL[player.faction]}）`, faction: player.faction};
}

export function resolveNight(game) {
const rnd = game.rnd;
const players = game.players;
const report = (p, text) => p.privateLog.push(`${text}`);
const alive = alivePlayers(game);
const actionOf = (p) => game.actions.get(p.id)?? { type: "none"};

// アクションを確定（提出がない者は帰宅）
const acts = new Map();
for (const p of alive) acts.set(p.id, actionOf(p));

// --- Stage 1: 訪問の確定 ---
const arrivals = new Map(); // houseId -> [visitorId]
const visitOf = new Map(); // visitorId -> houseId
for (const p of alive) {
const a = acts.get(p.id);
if (VISIT_TYPES.has(a.type) && a.targetId && players.get(a.targetId)?.alive) {
visitOf.set(p.id, a.targetId);
if (!arrivals.has(a.targetId)) arrivals.set(a.targetId, []);
arrivals.get(a.targetId).push(p.id);
}
}
const wentOut = (p) => visitOf.has(p.id);

// --- Stage 2a: ポリスの外出封じ（罠より先に確定する） ---
const blocked = new Set();
const policeActors = alive.filter((p) => acts.get(p.id).type === "police");
for (const p of shuffle(policeActors, rnd)) {
if (blocked.has(p.id)) continue; // 自分が封じられたポリスの封じは不発
if (p.isBaka) continue; // バカポリスの封じは空転（訪問はする）
const t = acts.get(p.id).targetId;
const target = players.get(t);
if (target && target.role!== "serial_killer" && actingRole(target)!== "magician") blocked.add(t);
// シリアルキラーと魔術師はポリスの妨害を受けない
}
// 封じられた者の訪問は取り消し
for (const id of blocked) {
const house = visitOf.get(id);
if (house) {
arrivals.set(house, arrivals.get(house).filter((v) => v!== id));
visitOf.delete(id);
}
}

// --- Stage 2b: トラッパーの罠 ---
const trapped = new Set();
const trapAt = new Map(); // houseId -> [trapperId]
for (const p of alive) {
const a = acts.get(p.id);
if (a.type === "trapper" &&!p.isBaka && visitOf.get(p.id) === a.targetId) {
if (!trapAt.has(a.targetId)) trapAt.set(a.targetId, []);
trapAt.get(a.targetId).push(p.id);
}
}
// 罠の所有者が他の罠にかかったら、その罠は無効になる（最大で数回反復すれば収束）
for (let iter = 0; iter < 4; iter++) {
trapped.clear();
for (const [house, owners] of trapAt) {
const visitors = (arrivals.get(house)?? []).filter((v) =>!owners.includes(v) && players.get(v).role!== "serial_killer");
const candidates = shuffle(visitors, rnd);
for (let i = 0; i < owners.length && i < candidates.length; i++) trapped.add(candidates[i]);
}
let changed = false;
for (const [house, owners] of [...trapAt]) {
const activeOwners = owners.filter((o) =>!trapped.has(o));
if (activeOwners.length!== owners.length) { trapAt.set(house, activeOwners); changed = true;}
}
if (!changed) break;
}

// 行動が有効かどうか（封じ・罠・バカで判定）
const visitHappened = (p) => visitOf.has(p.id);
const abilityFires = (p) => {
const a = acts.get(p.id);
if (a.type === "none") return false;
if (p.role === "serial_killer") return true; // 妨害を受けない
if (a.type === "cleaner" || a.type === "bomber_detonate" || a.type === "magician") {
return!p.isBaka; // 訪問しない能力は封じ・罠の対象外（バカは空転）
}
if (!visitHappened(p)) return false; // 封じられて外出できなかった
if (trapped.has(p.id)) return false; // 罠で能力不発
return true;
};

// --- クリーナーのマークとブレイマーの効果は今夜の調査に効く ---
const cleanerMarks = new Set();
for (const p of alive) if (p.cleanerMark) cleanerMarks.add(p.cleanerMark);
for (const p of alive) {
const a = acts.get(p.id);
if (a.type === "cleaner" && abilityFires(p)) cleanerMarks.add(a.targetId);
}
const blamedTonight = new Set();
for (const p of alive) {
const a = acts.get(p.id);
if (a.type === "blamer" && abilityFires(p)) blamedTonight.add(a.targetId);
}

// --- Stage 3: 情報の解決 ---
let mouseUsed = false;
for (const p of alive) {
const a = acts.get(p.id);
if (!INFO_TYPES.has(a.type)) continue;
const target = players.get(a.targetId);
if (!target) continue;
if (!visitHappened(p)) continue; // 外出できなかった者は結果なし
const isInfoBaka = p.isBaka;
if (a.type === "mouse") {
mouseUsed = true;
if (isInfoBaka) {
report(p, `${target.name}を占った結果： ${identityText(randomFakeIdentity(game))} だった。`);
} else if (!abilityFires(p)) {
report(p, `${target.name}を占おうとしたが、うまくいかなかった。`);
} else {
const idn = shownIdentity(game, target, { blamed: blamedTonight.has(target.id), cleaned: cleanerMarks.has(target.id)});
report(p, `${target.name}を占った結果： ${identityText(idn)} だった。`);
}
} else if (a.type === "investigator") {
if (isInfoBaka) {
const fake1 = randomFakeIdentity(game);
const fake2 = { role: "doctor", faction: "innocent"};
const pair = shuffle([fake1, fake2], rnd);
report(p, `${target.name}の調査結果： ${identityText(pair[0])} か ${identityText(pair[1])} のどちらかだ。`);
} else if (!abilityFires(p)) {
report(p, `${target.name}を調査しようとしたが、うまくいかなかった。`);
} else {
const idn = shownIdentity(game, target, { blamed: blamedTonight.has(target.id), cleaned: cleanerMarks.has(target.id)});
if (idn.unknown) {
report(p, `${target.name}の調査結果： 何かに邪魔されて、よくわからなかった。`);
} else {
let decoy;
if (idn.faction === "innocent") {
const pool = [...ROLE_IDS.filter((r) => ROLES[r].factions.includes("impostor")),...NEUTRAL_ROLES];
const dr = pool[Math.floor(rnd() * pool.length)];
decoy = { role: dr, faction: ROLES[dr].factions.includes("impostor") &&!NEUTRAL_ROLES.includes(dr)? "impostor": (NEUTRAL_ROLES.includes(dr)? "neutral": "impostor")};
} else {
decoy = { role: pickFakeRole(game), faction: "innocent"};
if (rnd() < 0.3) decoy = { role: "doctor", faction: "innocent"};
}
const pair = shuffle([idn, decoy], rnd);
report(p, `${target.name}の調査結果： ${identityText(pair[0])} か ${identityText(pair[1])} のどちらかだ。`);
}
}
} else if (a.type === "lookout") {
if (isInfoBaka) {
const others = alive.filter((x) => x.id!== p.id && x.id!== target.id);
const count = Math.floor(rnd() * 3); // 0〜2人（本物より少なく出る）
const names = shuffle(others, rnd).slice(0, count).map((x) => x.name);
report(p, `${target.name}の家を見張った。訪問者： ${names.length? names.join("、"): "なし"}。`);
} else if (!abilityFires(p)) {
report(p, `${target.name}の家を見張ろうとしたが、うまくいかなかった。`);
} else {
const visitors = (arrivals.get(target.id)?? [])
.filter((v) => v!== p.id &&!trapped.has(v) && players.get(v).role!== "serial_killer")
.map((v) => players.get(v).name);
report(p, `${target.name}の家を見張った。訪問者： ${visitors.length? visitors.join("、"): "なし"}。`);
}
} else if (a.type === "tracker") {
if (isInfoBaka) {
const others = alive.filter((x) => x.id!== p.id && x.id!== target.id);
if (others.length && rnd() < 0.6) {
report(p, `${target.name}の足跡を追った。${pick(others, rnd).name}の家へ行っていた。`);
} else {
report(p, `${target.name}の足跡を追った。外出していないようだ。`);
}
} else if (!abilityFires(p)) {
report(p, `${target.name}の足跡を追おうとしたが、うまくいかなかった。`);
} else if (target.role === "serial_killer") {
report(p, `${target.name}の足跡を追ったが、足跡が残っていなかった。`);
} else if (visitOf.has(target.id)) {
report(p, `${target.name}の足跡を追った。${players.get(visitOf.get(target.id)).name}の家へ行っていた。`);
} else {
report(p, `${target.name}の足跡を追った。外出していないようだ。`);
}
}
}
game.mouseUsedLastNight = mouseUsed;

// ポリスの結果（封じが確定した本物のみ）と訪問通知
for (const p of alive) {
const a = acts.get(p.id);
if (a.type!== "police" ||!visitHappened(p)) continue;
const target = players.get(a.targetId);
if (!target) continue;
report(target, `昨夜、ポリスがあなたの家を訪れた。`);
if (blocked.has(target.id)) report(target, `ポリスに止められて、昨夜は外出できなかった。`);
if (p.isBaka) {
const attempted = acts.get(target.id) && VISIT_TYPES.has(acts.get(target.id).type);
const fake = rnd() < 0.5? attempted:!attempted;
report(p, `${target.name}は昨夜、${fake? "外出していた": "外出していなかった"}。`);
} else if (abilityFires(p)) {
const attempted = acts.get(target.id) && VISIT_TYPES.has(acts.get(target.id).type) && acts.get(target.id).targetId;
report(p, `${target.name}は昨夜、${attempted? "外出していた（止めた）": "外出していなかった"}。`);
}
}
// ドクターの訪問通知（訪問の事実は本物・バカ共通に伝わる）
for (const p of alive) {
const a = acts.get(p.id);
if (a.type === "doctor" && visitHappened(p)) {
const target = players.get(a.targetId);
if (target) report(target, `昨夜、ドクターがあなたの家を訪れた。`);
}
if (trapped.has(p.id) && visitHappened(p)) {
report(p, `昨夜、罠にかかって能力が使えなかった。`);
}
}

// --- Stage 4: 殺害の解決 ---
const dead = new Map(); // id -> { cause, revivable, revealUnknown}
const kill = (targetId, cause, revivable, revealUnknown = false) => {
const t = players.get(targetId);
if (!t ||!t.alive) return;
if (actingRole(t) === "magician" && cause!== "ghost") return; // 魔術師は夜の攻撃から無敵
if (dead.has(targetId)) return;
dead.set(targetId, { cause, revivable, revealUnknown});
};
// インポスターの襲撃（有効な襲撃票からランダムで1件）
const killPicks = alive
.filter((p) => acts.get(p.id).type === "kill" && abilityFires(p))
.map((p) => acts.get(p.id).targetId);
if (killPicks.length) kill(pick(killPicks, rnd), "impostor", true);
// 個別の殺害
let thiefVictim = null;
for (const p of alive) {
const a = acts.get(p.id);
if (a.type === "sk_kill" && abilityFires(p)) kill(a.targetId, "serial_killer", true, true);
if (a.type === "thief_kill" && abilityFires(p)) { kill(a.targetId, "thief", true); thiefVictim = { thief: p, victimId: a.targetId};}
if (a.type === "magician" && abilityFires(p)) {
const t = players.get(a.targetId);
if (t) {
const trueRole = t.role;
if (a.predictRole === trueRole) kill(t.id, "magician", false);
else dead.set(p.id, { cause: "magician_backfire", revivable: false, revealUnknown: false});
}
}
if (a.type === "bomber_detonate" && abilityFires(p)) {
for (const vid of [...p.bombs]) kill(vid, "bomber", true);
p.bombs = [];
}
}
// ゴーストの道連れ（追放された翌夜に発動、蘇生・復活不可）
if (game.ghostDrag) {
const t = players.get(game.ghostDrag.targetId);
if (t && t.alive) dead.set(t.id, { cause: "ghost", revivable: false, revealUnknown: false});
}

// --- Stage 5: 蘇生の解決 ---
const revived = [];
for (const p of alive) {
const a = acts.get(p.id);
if (a.type === "doctor" && abilityFires(p) && dead.has(a.targetId) && dead.get(a.targetId).revivable) {
dead.delete(a.targetId);
revived.push(a.targetId);
report(players.get(a.targetId), `昨夜、死にかけたがドクターに蘇生された。`);
report(p, `昨夜、${players.get(a.targetId).name}を蘇生した。`);
}
}
for (const p of alive) {
if (p.role === "survivor" && dead.has(p.id) && dead.get(p.id).cause!== "ghost" && p.survivorCharges > 0) {
dead.delete(p.id);
p.survivorCharges -= 1;
revived.push(p.id);
report(p, `昨夜、殺されかけたが復活した（残り復活回数： ${p.survivorCharges}）。`);
}
}

// --- Stage 6: 付随効果 ---
for (const p of alive) {
const a = acts.get(p.id);
// 使用回数の消費（訪問が起きた分だけ）
if ((a.type === "mouse" || a.type === "blamer" || a.type === "provoker") && visitHappened(p)) {
if (p.usesLeft!== null && p.usesLeft > 0) p.usesLeft -= 1;
}
if (a.type === "cleaner" && abilityFires(p)) p.cleanerMark = a.targetId;
if (a.type === "provoker" && visitHappened(p) && abilityFires(p)) {
const t = players.get(a.targetId);
if (t) { t.provokedToday = 2; p.lastProvoke = { targetId: t.id, day: game.day};}
}
if (a.type === "bomber_plant" && abilityFires(p)) {
if (!p.bombs.includes(a.targetId)) p.bombs.push(a.targetId);
}
if (a.type === "ghost" && abilityFires(p)) p.candleTarget = a.targetId;
// 連続訪問制限の更新
if ((a.type === "doctor" || a.type === "police")) {
p.lastVisitTarget = visitHappened(p)? a.targetId: null;
}
}
// シーフの盗み（被害者が蘇生されずに死んだ場合のみ）
if (thiefVictim && dead.has(thiefVictim.victimId)) {
const thief = thiefVictim.thief;
const victim = players.get(thiefVictim.victimId);
thief.stolenFrom = victim.role;
thief.isBaka = victim.isBaka;
thief.role = victim.role;
thief.displayRole = victim.displayRole;
thief.faction = victim.faction;
thief.displayFaction = victim.faction;
thief.usesLeft = victim.isBaka? (ROLES[victim.displayRole].uses?? null): (ROLES[victim.role]?.uses?? null);
if (victim.role === "bomber") thief.bombs = [...victim.bombs];
if (victim.role === "survivor") thief.survivorCharges = 3;
report(thief, `シーフとして ${victim.name} の役職を盗んだ。あなたは今から ${ROLES[thief.displayRole]?.label?? thief.displayRole}（${FACTION_LABEL[thief.faction]}）として行動する。`);
}
// 死んだ人の爆弾は消える／死者への爆弾も消す
for (const p of players.values()) {
p.bombs = p.bombs.filter((id) => players.get(id)?.alive &&!dead.has(id));
if (dead.has(p.id)) p.bombs = [];
}

// --- Stage 7: 死亡の適用と朝の公表 ---
const deathNotices = [];
for (const [id, info] of dead) {
const p = players.get(id);
p.alive = false;
p.deathCause = info.cause;
p.diedOnDay = game.day;
const revealUnknown = info.revealUnknown || cleanerMarks.has(id);
p.publicReveal = revealUnknown? { text: "わからない", faction: null}: publicRevealOf(p);
deathNotices.push(`${p.name} が死亡しました（役職： ${p.publicReveal.text}）`);
if (info.cause === "ghost" && game.ghostDrag) game.ghostWon = game.ghostDrag.ghostId;
}
if (game.ghostDrag) game.ghostDrag = null;
for (const text of deathNotices) game.publicLog.push(`${text}`);
if (deathNotices.length === 0) game.publicLog.push(`昨夜は誰も死にませんでした。`);
if (mouseUsed) game.publicLog.push(`昨夜、ねずみが能力を使いました。`);

game.actions.clear();
checkEnd(game);
return { deaths: [...dead.keys()], revived};
}

// ---------------- 投票と勝敗 ----------------

const HOSTILE_ROLES = new Set(["serial_killer", "bomber", "magician", "thief"]);

export function submitVote(game, playerId, targetId) {
const p = game.players.get(playerId);
const t = game.players.get(targetId);
if (!p ||!p.alive) return;
if (targetId === null || targetId === "abstain") { game.votes.set(playerId, null); return;}
if (!t ||!t.alive || t.id === p.id) return;
game.votes.set(playerId, targetId);
}

export function resolveVote(game) {
const tally = new Map();
for (const p of alivePlayers(game)) {
if (p.provokedToday > 0) tally.set(p.id, (tally.get(p.id)?? 0) + p.provokedToday);
}
for (const [voterId, targetId] of game.votes) {
const voter = game.players.get(voterId);
if (!voter?.alive ||!targetId) continue;
const t = game.players.get(targetId);
if (!t?.alive) continue;
tally.set(targetId, (tally.get(targetId)?? 0) + 1);
}
game.votes.clear();
for (const p of game.players.values()) p.provokedToday = 0;

let exiled = null;
if (tally.size > 0) {
const max = Math.max(...tally.values());
const tied = [...tally.entries()].filter(([, c]) => c === max).map(([id]) => id);
const exiledId = tied[Math.floor(game.rnd() * tied.length)];
exiled = game.players.get(exiledId);
exiled.alive = false;
exiled.deathCause = "exile";
exiled.diedOnDay = game.day;
const cleaned = [...game.players.values()].some((c) => c.cleanerMark === exiled.id);
exiled.publicReveal = cleaned? { text: "わからない", faction: null}: publicRevealOf(exiled);
game.publicLog.push(`${exiled.name} が追放されました（役職： ${exiled.publicReveal.text}）`);
if (exiled.role === "ghost" && exiled.candleTarget) {
game.ghostDrag = { ghostId: exiled.id, targetId: exiled.candleTarget};
}
} else {
game.publicLog.push(`投票がなく、誰も追放されませんでした。`);
}
checkEnd(game);
return { exiledId: exiled?.id?? null, tally: Object.fromEntries(tally)};
}

export function checkEnd(game) {
if (game.finished) return;
const alive = alivePlayers(game);
const imp = alive.filter((p) => p.faction === "impostor").length;
const inno = alive.filter((p) => p.faction === "innocent").length;
const hostile = alive.filter((p) => p.faction === "neutral" && HOSTILE_ROLES.has(p.role));

let factionWin = null;
let neutralWinnerId = null;
if (imp === 0 && hostile.length === 0) {
factionWin = "innocent";
game.endReason = "インポスターと危険なニュートラルが全て排除された";
} else if (imp > 0 && imp >= inno) {
factionWin = "impostor";
game.endReason = "インポスターがイノセントと同数になった";
} else if (inno === 0 && imp === 0 && hostile.length === 1) {
neutralWinnerId = hostile[0].id;
game.endReason = `${ROLES[hostile[0].role].label}が最後の一人になった`;
} else if (alive.length <= 1) {
const last = alive[0];
if (last) {
if (last.faction === "neutral") neutralWinnerId = last.id;
else factionWin = last.faction;
game.endReason = "最後の一人になった";
}
}
if (!factionWin &&!neutralWinnerId) return;

const personal = [];
for (const p of game.players.values()) {
if (p.role === "survivor" && p.alive) personal.push({ playerId: p.id, reason: "サバイバーとして最後まで生き残った"});
if (game.ghostWon === p.id) personal.push({ playerId: p.id, reason: "ゴーストとして道連れを成功させた"});
if (actingRole(p) === "provoker" && p.alive && imp > 0 && p.lastProvoke && p.lastProvoke.day === game.day) {
const t = game.players.get(p.lastProvoke.targetId);
if (t && t.faction === "impostor") personal.push({ playerId: p.id, reason: "挑発者としてインポスターと共に生き残り、挑発を成功させた"});
}
}
game.finished = true;
game.winners = { faction: factionWin, neutralWinnerId, personal};
}

export function impostorTeammates(game, player) {
if (player.faction!== "impostor") return [];
return alivePlayers(game)
.filter((p) => p.faction === "impostor" && p.id!== player.id)
.map((p) => ({ id: p.id, name: p.name, roleLabel: ROLES[p.displayRole]?.label?? p.displayRole}));
}

// プレイヤーが勝者かどうか（終了後の表示用）
export function isWinner(game, player) {
if (!game.finished ||!game.winners) return false;
if (game.winners.personal.some((w) => w.playerId === player.id)) return true;
if (game.winners.neutralWinnerId === player.id) return true;
if (game.winners.faction && player.faction === game.winners.faction) {
// 陣営勝利。ただし個人勝利（挑発者など）が別にある場合も陣営側は勝ち扱いのまま
return true;
}
return false;
}
