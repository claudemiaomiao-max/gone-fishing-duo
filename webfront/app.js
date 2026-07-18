"use strict";
/* Gone Fishing 我们的鱼塘 · 全屏沉浸版 2026-07-16
   一套玩法一套进度 共享存档；网页动作by=CONFIG.human 只用于动态脚印和甩竿账 */

var BY = CONFIG.human;
var BASE = (function () {
  var m = location.pathname.match(/^(.*?)\/(?:index\.html)?$/);
  return location.origin + (m && m[1] ? m[1] : "");
})();

var lastState = null;
var casting = false;
var pendingResult = null;
var selectedBait = null;
var castRound = 0;   // 轮次令牌：旧轮的定时器不许碰新轮

function h(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}
function clear(n) { n.replaceChildren(); return n; }
var ASSET_VER = "4";   // 素材更新时递增 破浏览器缓存
function assetUrl(p) { return BASE + "/assets/" + p + "?v=" + ASSET_VER; }
function img(src, cls) {
  var i = h("img", cls || "");
  i.src = src; i.loading = "lazy";
  i.addEventListener("error", function () { i.style.visibility = "hidden"; });
  return i;
}
function $(id) { return document.getElementById(id); }

function api(path, opts) {
  opts = opts || {};
  return fetch(BASE + path, {
    method: opts.method || "GET",
    headers: opts.body === undefined ? {} : { "Content-Type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (!j.ok) throw new Error(j.error || "请求失败");
    return j;
  });
}
function cmd(command) {
  return api("/api/cmd", { method: "POST", body: { command: command, by: BY } });
}

/* ---------- modal（结果卡） ---------- */
var modal = $("modal");
function openModal(title) { $("modal-title").textContent = title; clear($("modal-body")); modal.hidden = false; return $("modal-body"); }
function closeModal() { modal.hidden = true; clear($("modal-body")); }
$("modal-close").addEventListener("click", closeModal);
modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });

function rarLabel(k) {
  var m = { common: "常见", uncommon: "少见", rare: "稀有", epic: "史诗", legendary: "传说", mythic: "神话" };
  return m[k] || "";
}

var RAR_RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
function showResult(resp, title) {
  var body = openModal(title || "结果");
  var card = h("div", "catch-card");
  var top = "";
  ((resp.result || {}).new_catches || []).forEach(function (c) {
    if ((RAR_RANK[c.rarity] || 0) > (RAR_RANK[top] || 0)) top = c.rarity;
  });
  if (RAR_RANK[top] >= 3) card.classList.add("glow-" + top);
  var r = resp.result || {};
  if (r.new_catches && r.new_catches.length) {
    // 相同鱼合并显示（分裂鱼钩一竿多条 她要求不重复贴图 标×N）
    var grouped = [];
    r.new_catches.forEach(function (c) {
      var same = grouped.find(function (g) { return g.id === c.id && g.size === c.size; });
      if (same) same.n += 1;
      else grouped.push({ id: c.id, name: c.name, size: c.size, value: c.value, rarity: c.rarity, n: 1 });
    });
    grouped.forEach(function (c) {
      card.append(img(assetUrl("fish/" + c.name + ".png"), "fish-img"));
      var nameLine = h("div", "f-name", c.name + (c.n > 1 ? " ×" + c.n : ""));
      var isNew = (r.new_fish || []).some(function (f) { return f.id === c.id; });
      if (isNew) nameLine.append(h("span", "f-new", "NEW"));
      card.append(nameLine);
      card.append(h("div", "f-meta r-" + (c.rarity || "common"),
        rarLabel(c.rarity) + (c.size ? " · " + c.size + "cm" : "") + (c.value ? " · 值" + c.value : "")));
    });
  }
  // 钓上宝箱：亮闭箱图（她的反馈：宝箱只有emoji没排面）
  if ((r.new_chests || 0) > 0) {
    var m = /(锈迹宝箱|藤壶密箱|船长遗箱|海底宝库)/.exec(resp.text || "");
    var chestName = m ? m[1] : "锈迹宝箱";
    card.append(img(assetUrl("items/" + chestName + "_闭.png"), "fish-img"));
    card.append(h("div", "f-name", chestName));
  }
  // 漂流瓶：亮瓶子图
  if (/漂流瓶/.test(resp.text || "") && !(r.new_catches || []).length) {
    card.append(img(assetUrl("items/漂流瓶.png"), "fish-img"));
  }
  appendLoot(card, resp);
  body.append(card);
}

/* ---------- 场景渲染 ---------- */
function renderScene(state) {
  lastState = state;
  var scene = $("scene");
  scene.style.backgroundImage = "url('" + assetUrl("scenes/" + state.location.name + ".jpg") + "')";
  $("loc-name").textContent = state.location.name + " · " + state.season;
  $("loc-name").parentNode.onclick = function () { showSpotTips(state); };
  $("pts").textContent = state.points;

  // 右侧悬浮：氧气 / 宝箱 / 潜水
  var oxy = $("oxy-chip");
  oxy.hidden = false;
  oxy.classList.toggle("dim", state.oxygen <= 0);
  $("oxy-n").textContent = "×" + state.oxygen;
  var chest = $("chest-chip");
  var n = (state.pending_chests || []).length;
  chest.hidden = n === 0;
  $("chest-n").textContent = "×" + n;
  var dive = $("dive-chip");
  dive.hidden = false;
  dive.classList.toggle("dim", !(state.dive_unlocked_here && state.oxygen > 0));

  $("enc").textContent = state.enc_count + "/" + state.enc_total;
  var casts = state.casts_by || {};
  $("casts-miao").textContent = "×" + (casts[CONFIG.human] || 0);
  $("casts-chen").textContent = "×" + (casts[CONFIG.ai] || 0);

  renderBaitCycle(state);
  buildTicker(state);

  // 远征进行中：抛竿键变身遗迹处理键（她被石坛锁死过 弹窗一关就找不到门）
  var castLabel = $("cast-label");
  var castBtn = $("cast-big");
  if (state.expedition && state.expedition.pending) {
    castLabel.textContent = "远征中";
    castBtn.classList.add("expedition");
  } else {
    castBtn.classList.remove("expedition");
    if (castLabel.textContent === "远征中") castLabel.textContent = "抛 竿";
  }
}

var baitOrder = [];
function renderBaitCycle(state) {
  var btn = clear($("bait-cycle"));
  baitOrder = state.baits.slice();  // 全部饵都在循环里 0个也能切到看到
  if (state.free_bait > 0) {
    btn.className = "free";
    btn.append(h("span", "b-name", "免饵竿"), h("span", "b-qty", "×" + state.free_bait));
    selectedBait = null;
    return;
  }
  if (!selectedBait || !baitOrder.some(function (b) { return b.id === selectedBait; })) {
    var firstStocked = baitOrder.filter(function (b) { return b.qty > 0; })[0];
    selectedBait = firstStocked ? firstStocked.id : (baitOrder[0] && baitOrder[0].id);
  }
  var cur = baitOrder.filter(function (b) { return b.id === selectedBait; })[0];
  if (!cur) return;
  btn.className = cur.qty > 0 ? "" : "empty";
  btn.append(img(assetUrl("items/" + baitImgName(cur.id) + ".png")));
  btn.append(h("span", "b-name", baitDisplayName(cur.name)), h("span", "b-qty", "×" + cur.qty));
  btn.append(h("span", "b-cycle", "⇄"));
}
$("bait-cycle").addEventListener("click", function () {
  if (!lastState) return;
  if (lastState.free_bait > 0) return;
  if (!baitOrder.length) { openPanel("shop"); return; }
  var idx = baitOrder.findIndex(function (b) { return b.id === selectedBait; });
  selectedBait = baitOrder[(idx + 1) % baitOrder.length].id;
  renderBaitCycle(lastState);
});

function baitDisplayName(name) { return name === "普通蚯蚓" ? "蚯蚓" : name; }
function baitImgName(id) {
  var m = { basic_worm: "虾饵", glow_bait: "夜光饵", golden_lure: "金色旋转亮片" };
  return m[id] || "虾饵";
}
function chestImgName(id) {
  var map = { rusty_chest: "锈迹宝箱", barnacle_chest: "藤壶密箱", ancient_captain_chest: "船长遗箱", seafloor_vault: "海底宝库" };
  return map[id] || "锈迹宝箱";
}

/* 钓点情报卡（她要的：随时看地图tips）*/
function showSpotTips(state) {
  var loc = state.location || {};
  var body = openModal(loc.name + " · " + state.season);
  var card = h("div", "catch-card");
  card.append(img(assetUrl("scenes/" + loc.name + ".jpg"), "spot-tip-img"));
  if (loc.desc) card.append(h("div", "f-desc", loc.desc));
  if (loc.character) card.append(h("div", "f-desc tip-char", loc.character));
  var intel = [];
  if (!loc.season_ok) intel.push("⚠️ 本季节这里没什么鱼，等换季或换个钓点。");
  else {
    if (loc.undiscovered > 0) intel.push("本季这里还有 " + loc.undiscovered + " 种没见过的鱼。");
    else intel.push("本季这里的常规鱼已集齐。");
    if (loc.undiscovered_legend > 0) intel.push("外加 " + loc.undiscovered_legend + " 种传说级潜伏。");
  }
  if (loc.dive_undiscovered > 0) intel.push("🤿 水下还有 " + loc.dive_undiscovered + " 种没见过的鱼。");
  else if (loc.dive_undiscovered === 0) intel.push("🤿 水下的鱼这季已集齐。");
  else if (state.map_fragments && (state.map_fragments[loc.id] || 0) > 0) intel.push("🧩 藏宝图碎片 " + state.map_fragments[loc.id] + " 片，凑齐开潜水。");
  card.append(h("div", "f-meta", intel.join(" ")));
  body.append(card);
}

/* ---------- ticker：氛围话 + 动态脚印 轮播 ---------- */
var tickerItems = [];
var tickerIdx = 0;
var tickerTimer = null;

function agoText(ts) {
  var s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return "刚刚";
  if (s < 3600) return Math.floor(s / 60) + "分钟前";
  if (s < 86400) return Math.floor(s / 3600) + "小时前";
  return Math.floor(s / 86400) + "天前";
}

function buildTicker(state) {
  var items = (state.ambience || []).map(function (t) { return { kind: "amb", text: t }; });
  // 状态信息作为轮播条目 不占常驻HUD（减法：水面留给水）
  items.push({ kind: "info", text: "图鉴 " + state.enc_count + " / " + state.enc_total + " 种" });
  var casts = state.casts_by || {};
  if (casts[CONFIG.human] || casts[CONFIG.ai]) {
    items.push({ kind: "info", text: "甩竿账：" + CONFIG.human + " " + (casts[CONFIG.human] || 0) + " 竿 · " + CONFIG.ai + " " + (casts[CONFIG.ai] || 0) + " 竿" });
  }
  api("/api/activity").then(function (payload) {
    (payload.data || []).slice(0, 5).forEach(function (a) {
      items.push({ kind: "act", text: a.by + " · " + agoText(a.ts) + " · " + a.text });
    });
    tickerItems = items;
    if (!tickerTimer) {
      rotateTicker();
      tickerTimer = setInterval(rotateTicker, 7000);
    }
  }).catch(function () { tickerItems = items; });
}

function rotateTicker() {
  if (!tickerItems.length) return;
  tickerIdx = (tickerIdx + 1) % tickerItems.length;
  var item = tickerItems[tickerIdx];
  var node = $("ticker-text");
  node.classList.remove("show");
  setTimeout(function () {
    node.textContent = item.text;
    node.className = item.kind === "act" ? "act show" : (item.kind === "info" ? "info show" : "show");
    // 两行字时整条下沉（她的要求：一行位置不动 两行别顶到鱼饵框）
    var oneLine = parseFloat(getComputedStyle(node).lineHeight) || 16;
    $("ticker").classList.toggle("two-line", node.scrollHeight > oneLine * 1.6);
  }, 350);
}

/* ---------- 甩竿演出 ---------- */
function resetCastBtn() {
  var btn = $("cast-big");
  btn.classList.remove("pull"); $("cast-label").textContent = "抛 竿"; btn.disabled = false;
  var rod = $("rod-img");
  rod.src = assetUrl("ui/鱼竿_收.png");
  rod.classList.remove("swing", "bite");
  $("bobber").style.visibility = "hidden";
  $("fishline").hidden = true;
  $("scene").classList.remove("waiting");
  casting = false;
}
function onCast() {
  var btn = $("cast-big");
  var label = $("cast-label");
  // 远征中：这颗键只管遗迹抉择 不甩竿（她在祭坛前纠结时被"上钩了"打断过）
  if (lastState && lastState.expedition && lastState.expedition.pending) {
    cmd("choose").then(function (resp) { showResult(resp, "水下远征 · 眼前的抉择"); })
      .catch(function (e) { openModal("哎呀").append(h("p", "error", e.message)); });
    return;
  }
  if (btn.classList.contains("pull")) {
    if (pendingResult) revealCatch();
    else resetCastBtn();   // 保险丝：闪烁卡死时点一下自动复位
    return;
  }
  if (casting || !lastState) return;
  if (lastState.free_bait <= 0) {
    var sel = (lastState.baits || []).filter(function (b) { return b.id === selectedBait; })[0];
    if (!sel || sel.qty <= 0) { openPanel("shop"); return; }
  }
  casting = true;
  $("scene").classList.add("waiting");
  btn.disabled = true; label.textContent = "等鱼…";
  var rod = $("rod-img");
  rod.src = assetUrl("ui/鱼竿_抛.png");
  rod.classList.remove("swing"); void rod.offsetWidth; rod.classList.add("swing");

  var bobber = $("bobber");
  var ripple = $("ripple");
  var line = $("fishline");
  // 每竿随机落点 水是活的
  var bx = 32 + Math.random() * 36;   // 32%~68%
  var by = 38 + Math.random() * 13;   // 38%~51%
  bobber.style.left = bx + "%"; bobber.style.top = by + "%";
  ripple.style.left = bx + "%"; ripple.style.top = by + "%";
  var splash = $("splash");
  splash.style.left = bx + "%"; splash.style.top = by + "%";
  // 斜钓线：竿(大按钮圆心)→浮标
  var sceneRect = $("scene").getBoundingClientRect();
  var btnRect = $("cast-big").getBoundingClientRect();
  var x1 = btnRect.left + btnRect.width / 2 - sceneRect.left;
  var y1 = btnRect.top + btnRect.height * 0.3 - sceneRect.top;
  var x2 = sceneRect.width * bx / 100;
  var y2 = sceneRect.height * by / 100;
  var dx = x2 - x1, dy = y2 - y1;
  var len = Math.sqrt(dx * dx + dy * dy);
  var ang = Math.atan2(dy, dx) * 180 / Math.PI;
  line.style.left = x1 + "px"; line.style.top = y1 + "px";
  line.style.width = len + "px"; line.style.height = "2px";
  line.style.transform = "rotate(" + ang + "deg)";
  bobber.src = assetUrl("items/浮标浮着.png");
  bobber.style.visibility = "visible";
  bobber.className = "bobber idle";
  line.hidden = false;
  ripple.classList.remove("go"); void ripple.offsetWidth; ripple.classList.add("go");

  castRound += 1;
  var round = castRound;
  var command = selectedBait ? "cast " + selectedBait : "cast";
  cmd(command).then(function (resp) {
    if (round !== castRound) return;
    pendingResult = resp;
    var wait = 1400 + Math.random() * 2200;
    setTimeout(function () {
      if (round !== castRound) return;
      var shadow = $("fish-shadow");
      shadow.classList.remove("swim"); void shadow.offsetWidth; shadow.classList.add("swim");
      setTimeout(function () {
        if (round !== castRound) return;
        bobber.src = assetUrl("items/浮标下沉.png");
        bobber.className = "bobber bite";
        btn.disabled = false;
        btn.classList.add("pull");
        $("rod-img").classList.add("bite");
        label.textContent = "拉竿！";
        setTimeout(function () { if (round === castRound && pendingResult) revealCatch(); }, 4000);
      }, 900);
    }, wait);
  }).catch(function (e) {
    casting = false; btn.disabled = false; label.textContent = "抛 竿";
    rod.src = assetUrl("ui/鱼竿_收.png");
    rod.classList.remove("swing", "bite");
    openModal("哎呀").append(h("p", "error", e.message));
  });
}

function revealCatch() {
  if (!pendingResult) return;
  var resp = pendingResult; pendingResult = null;
  casting = false;
  var btn = $("cast-big");
  $("scene").classList.remove("waiting");
  btn.classList.remove("pull"); $("cast-label").textContent = "抛 竿"; btn.disabled = false;
  var rod = $("rod-img");
  rod.src = assetUrl("ui/鱼竿_收.png");
  rod.classList.remove("swing", "bite");
  $("bobber").style.visibility = "hidden";
  $("fishline").hidden = true;
  // 水花炸开 鱼离水的那一下
  var splash = $("splash");
  splash.classList.remove("burst"); void splash.offsetWidth; splash.classList.add("burst");
  setTimeout(function () {
    showResult(resp, "上钩了！");
    refresh();
  }, 320);
}

/* ---------- 浮层面板 ---------- */
var panel = $("panel");
$("panel-close").addEventListener("click", function () { panel.hidden = true; });
panel.addEventListener("click", function (e) { if (e.target === panel) panel.hidden = true; });

function openPanel(kind) {
  var body = clear($("panel-body"));
  panel.hidden = false;
  if (kind === "codex") { $("panel-title").textContent = "图鉴"; fillCodex(body); }
  else if (kind === "bag") { $("panel-title").textContent = "渔篓"; fillBag(body); }
  else if (kind === "shop") { $("panel-title").textContent = "商店"; fillShop(body); }
  else if (kind === "map") { $("panel-title").textContent = "钓点"; fillMap(body); }
}

/* 图鉴（撤比分/首钓 一套进度） */
function fillCodex(body) {
  body.append(h("p", "loading", "正在翻图鉴…"));
  api("/api/encyclopedia").then(function (payload) {
    clear(body);
    var d = payload.data;
    var progressCard = h("section", "p-card");
    var head = h("h3", "", "物种发现进度");
    head.append(h("span", "codex-num", d.caught + " / " + d.total));
    progressCard.append(head);
    var bar = h("div", "codex-progress-bar");
    for (var i = 0; i < d.total; i += 1) bar.append(h("i", i < d.caught ? "on" : ""));
    progressCard.append(bar);
    body.append(progressCard);

    var filterRow = h("div", "chip-row");
    var RARS = [["all", "全部"], ["common", "常见"], ["uncommon", "少见"], ["rare", "稀有"], ["epic", "史诗"], ["legendary", "传说"], ["mythic", "神话"]];
    var curFilter = "all";
    RARS.forEach(function (pair) {
      var chip = h("button", "chip" + (pair[0] === "all" ? " on" : ""), pair[1]);
      chip.type = "button";
      chip.addEventListener("click", function () {
        curFilter = pair[0];
        Array.prototype.forEach.call(filterRow.children, function (c) { c.classList.remove("on"); });
        chip.classList.add("on");
        fillGrid();
      });
      filterRow.append(chip);
    });
    body.append(filterRow);

    var grid = h("div", "codex-grid fixed-h");
    function fillGrid() {
      clear(grid);
      d.fish.filter(function (f) { return curFilter === "all" || f.rarity === curFilter; }).forEach(function (f) {
        if (f.caught) {
          var cell = h("div", "codex-cell");
          cell.append(img(assetUrl("fish/" + f.name + ".png")));
          cell.append(h("div", "c-name", f.name));
          cell.append(h("div", "rar-dot r-" + (f.rarity || "common"), f.rarity_label || rarLabel(f.rarity)));
          cell.style.cursor = "pointer";
          cell.addEventListener("click", function () { fishDetail(f); });
          grid.append(cell);
        } else {
          var lock = h("div", "codex-cell locked");
          var sil = img(assetUrl("fish/" + f.name + ".png"), "silhouette");
          lock.append(sil);
          lock.append(h("div", "c-name sil-name", "？？？"));
          grid.append(lock);
        }
      });
    }
    fillGrid();
    body.append(grid);
  }).catch(function (e) { clear(body).append(h("p", "error", e.message)); });
}

function fishDetail(f) {
  var body = openModal(f.name);
  var card = h("div", "catch-card");
  card.append(img(assetUrl("fish/" + f.name + ".png"), "fish-img"));
  card.append(h("div", "f-meta r-" + (f.rarity || "common"), f.rarity_label || rarLabel(f.rarity)));
  var meta = [];
  if (f.best_size) meta.push("最大 " + f.best_size + "cm");
  if (f.count) meta.push("共捕获 " + f.count + " 次");
  card.append(h("div", "f-meta", meta.join(" · ")));
  if (f.desc) card.append(h("div", "f-desc", f.desc));
  body.append(card);
}

/* 渔篓 */
function fillBag(body) {
  body.append(h("p", "loading", "正在翻渔篓…"));
  api("/api/inventory").then(function (payload) {
    clear(body);
    var d = payload.data;
    var card = h("section", "p-card");
    var head = h("h3", "", "渔获");
    head.append(h("span", "codex-num", "点数 " + d.points));
    card.append(head);
    if (d.catches.length) {
      d.catches.forEach(function (c) {
        var row = h("div", "bag-row" + (c.kept ? " kept" : ""));
        row.append(img(assetUrl("fish/" + c.name + ".png")));
        row.append(h("span", "", c.name + (c.size ? " " + c.size + "cm" : "")));
        row.append(h("span", "dots"));
        row.append(h("span", "val", "" + (c.value || "")));
        var star = h("button", "keep-btn" + (c.kept ? " on" : ""), c.kept ? "★" : "☆");
        star.type = "button";
        star.title = c.kept ? "取消珍藏" : "珍藏（全部卖掉时会跳过它）";
        star.addEventListener("click", function () {
          api("/api/keep", { method: "POST", body: { instance_id: c.instance_id, on: !c.kept } })
            .then(function () { fillBag(clear($("panel-body"))); });
        });
        row.append(star);
        if (c.kept) {
          row.append(h("span", "kept-tag", "珍藏"));
        } else {
          var sbtn = h("button", "sell-btn", "卖");
          sbtn.type = "button";
          sbtn.addEventListener("click", function () {
            cmd("sell " + c.instance_id).then(function (resp) { showResult(resp, "出货！"); fillBag(clear($("panel-body"))); refresh(); });
          });
          row.append(sbtn);
        }
        card.append(row);
      });
      var sellBtn = h("button", "sell-btn all", "全部卖掉");
      sellBtn.type = "button";
      sellBtn.addEventListener("click", function () {
        cmd("sell all").then(function (resp) { showResult(resp, "出货！"); fillBag(clear($("panel-body"))); refresh(); });
      });
      card.append(sellBtn);
    } else {
      card.append(h("p", "muted", "空空如也，该去甩两竿了。"));
    }
    body.append(card);

    var itemCard = h("section", "p-card");
    itemCard.append(h("h3", "", "宝物"));
    if (d.items.length) {
      d.items.forEach(function (it) {
        var row = h("div", "bag-row");
        row.append(img(assetUrl("items/" + it.name + ".png")));
        row.append(h("span", "", it.name + " ×" + it.qty));
        row.append(h("span", "dots"));
        row.append(h("span", "val", it.value ? "值" + it.value : ""));
        if (it.sellable) {
          var ibtn = h("button", "sell-btn", "卖");
          ibtn.type = "button";
          ibtn.addEventListener("click", function () {
            cmd("sell item " + it.id).then(function (resp) { showResult(resp, "出货！"); fillBag(clear($("panel-body"))); refresh(); });
          });
          row.append(ibtn);
        }
        itemCard.append(row);
      });
    } else {
      itemCard.append(h("p", "muted", "还没有宝物，钓鱼偶尔会带上来惊喜。"));
    }
    body.append(itemCard);
  }).catch(function (e) { clear(body).append(h("p", "error", e.message)); });
}

/* 商店 */
function fillShop(body) {
  if (!lastState) return;
  clear(body);
  var card = h("section", "p-card");
  var head = h("h3", "", "鱼饵铺");
  head.append(h("span", "codex-num", "点数 " + lastState.points));
  card.append(head);
  var goods = lastState.baits.map(function (b) {
    return { id: b.id, name: b.name, desc: b.desc, price: b.price, qty: b.qty, img: "items/" + baitImgName(b.id) + ".png" };
  });
  goods.push({ id: "oxygen", name: "氧气瓶", desc: "潜水消耗品，一瓶潜一次。买5瓶8折，10瓶7折。", price: 45, qty: lastState.oxygen, img: "items/氧气瓶.png" });
  goods.forEach(function (b) {
    var row = h("div", "bag-row");
    row.append(img(assetUrl(b.img)));
    var info = h("span", "shop-info");
    info.append(h("b", "", baitDisplayName(b.name)), h("small", "", b.desc || ""));
    row.append(info);
    card.append(row);
    var btnRow = h("div", "bag-row tight");
    btnRow.append(h("span", "val", b.price + "点/个 现有×" + b.qty));
    btnRow.append(h("span", "dots"));
    [1, 5, 10].forEach(function (n) {
      var btn = h("button", "buy-btn", "买" + n);
      btn.type = "button";
      btn.addEventListener("click", function () {
        cmd("buy " + b.id + " " + n).then(function (resp) {
          showResult(resp, "进货！");
          refresh().then(function () { fillShop(clear($("panel-body"))); });
        }).catch(function (e) { openModal("买不了").append(h("p", "error", e.message)); });
      });
      btnRow.append(btn);
    });
    card.append(btnRow);
  });
  body.append(card);
}

/* 地图（钓点） */
function fillMap(body) {
  if (!lastState) return;
  clear(body);
  var card = h("section", "p-card");
  card.append(h("h3", "", "当前在 " + lastState.location.name));
  var grid = h("div", "spot-grid");
  lastState.locations.forEach(function (l) {
    var cell = h("div", "spot-card" + (l.unlocked ? "" : " locked") + (l.current ? " current" : ""));
    if (l.unlocked) {
      cell.style.backgroundImage = "url('" + assetUrl("scenes/" + l.name + ".jpg") + "')";
      cell.append(h("div", "s-name", l.name));
    } else {
      cell.append(h("div", "s-mystery", "？？？"));
      cell.append(h("span", "s-lock", "🔒"));
      cell.append(h("div", "s-name", "未探明 · " + l.unlock_cost + " 点"));
      cell.addEventListener("click", function () {
        var body2 = openModal("解锁新水域？");
        var card2 = h("div", "catch-card");
        card2.append(h("p", "", "花 " + l.unlock_cost + " 点数探明这片水域？现有 " + lastState.points + " 点。"));
        var btn = h("button", "sell-btn all", "解 锁");
        btn.type = "button";
        btn.addEventListener("click", function () {
          cmd("goto " + l.id).then(function (resp) {
            panel.hidden = true;
            showResult(resp, "新水域！");
            refresh();
          }).catch(function (e) { openModal("解锁失败").append(h("p", "error", e.message)); });
        });
        card2.append(btn);
        body2.append(card2);
      });
    }
    if (l.current) cell.append(h("span", "s-cur", "当前"));
    if (l.unlocked && !l.current) {
      cell.addEventListener("click", function () {
        cmd("goto " + l.id).then(function (resp) {
          panel.hidden = true;
          showResult(resp, "换地方！");
          refresh();
        }).catch(function (e) { openModal("走不过去").append(h("p", "error", e.message)); });
      });
    }
    grid.append(cell);
  });
  card.append(grid);
  body.append(card);
}

/* ---------- 动作 ---------- */
function openChests() {
  if (!lastState || !(lastState.pending_chests || []).length) return;
  var body = openModal("待开的宝箱");
  var card = h("div", "catch-card");
  lastState.pending_chests.forEach(function (c) {
    var row = h("div", "bag-row");
    row.append(img(assetUrl("items/" + chestImgName(c.event_id) + "_闭.png")));
    row.append(h("span", "", c.name));
    row.append(h("span", "dots"));
    var btn = h("button", "sell-btn", "开箱");
    btn.type = "button";
    btn.addEventListener("click", function () {
      cmd("open " + c.uid).then(function (resp) {
        showChestOpen(resp, c.event_id);
        refresh();
      }).catch(function (e) { openModal("开不动").append(h("p", "error", e.message)); });
    });
    row.append(btn);
    card.append(row);
  });
  body.append(card);
}

/* 开箱仪式：闭箱图→0.5秒→弹开换开箱图+战利品 */
function showChestOpen(resp, eventId) {
  var body = openModal("开箱！");
  var card = h("div", "catch-card");
  var chestImg = img(assetUrl("items/" + chestImgName(eventId) + "_闭.png"), "fish-img chest-anim");
  card.append(chestImg);
  body.append(card);
  setTimeout(function () {
    chestImg.src = assetUrl("items/" + chestImgName(eventId) + "_开.png");
    chestImg.classList.add("opened");
    setTimeout(function () {
      appendLoot(card, resp);
    }, 250);
  }, 550);
}

/* 战利品明细：宝物图+碎片高亮 */
/* 抉择事件：解析选项做成按钮（choose指令 潜水大遗迹等）*/
function appendChoices(card, text) {
  if (!/〔抉择〕|choose <编号>/.test(text || "")) return false;
  var lines = String(text).split("\n");
  var box = h("div", "choice-box");
  lines.forEach(function (ln) {
    var m = /^\s*(\d+)[.、]\s*(.+)$/.exec(ln.trim());
    if (!m) return;
    var locked = /氧气不足|🔒/.test(m[2]);
    var btn = h("button", "choice-btn" + (locked ? " locked" : ""), m[1] + ". " + m[2].replace(/🔒|氧气不足/g, "").trim());
    btn.type = "button";
    if (!locked) {
      btn.addEventListener("click", function () {
        cmd("choose " + m[1]).then(function (resp2) {
          showResult(resp2, "抉择");
          refresh();
        }).catch(function (e) { openModal("哎呀").append(h("p", "error", e.message)); });
      });
    }
    box.append(btn);
  });
  if (!box.childElementCount) return false;
  var srf = h("button", "choice-btn surface", "🌊 上浮，结束这趟远征");
  srf.type = "button";
  srf.addEventListener("click", function () {
    cmd("surface").then(function (resp2) { showResult(resp2, "上岸结算"); refresh(); });
  });
  box.append(srf);
  card.append(box);
  return true;
}

function appendLoot(card, resp) {
  var r = resp.result || {};
  (r.new_items || []).forEach(function (it) {
    var row = h("div", "loot-row");
    row.append(img(assetUrl("items/" + it.name + ".png")));
    row.append(h("span", "", it.name + (it.qty > 1 ? " ×" + it.qty : "")));
    card.append(row);
  });
  (r.new_fragments || []).forEach(function (fg) {
    var row = h("div", "loot-row frag");
    row.append(img(assetUrl("items/发光碎片.png")));
    row.append(h("span", "", "藏宝图碎片 +" + fg.got + "（" + fg.loc + " " + fg.have + "/" + fg.need + "）"));
    card.append(row);
  });
  card.append(h("div", "event-text", resp.text || ""));
  appendChoices(card, resp.text);
}

function doDive() {
  if (lastState && !lastState.dive_unlocked_here) {
    var frag = (lastState.map_fragments || {})[lastState.location.id] || 0;
    openModal("这里还潜不了").append(h("p", "", "这片水下还没探明。在水面钓鱼偶尔会钓到藏宝图碎片" + (frag ? "（这里已集 " + frag + " 片）" : "") + "，拼出完整地图就能解锁潜水。"));
    return;
  }
  if (lastState && lastState.oxygen <= 0) {
    openModal("没氧气了").append(h("p", "", "氧气瓶用完了，去商店买，45点一瓶，买5瓶打8折，买10瓶打7折。"));
    return;
  }
  cmd("dive 1").then(function (resp) {
    showResult(resp, "潜水归来");
    refresh();
  }).catch(function (e) { openModal("哎呀").append(h("p", "error", e.message)); });
}

/* ---------- 主循环 ---------- */
function refresh() {
  return api("/api/state").then(function (payload) {
    renderScene(payload.data);
    return payload.data;
  }).catch(function () {});
}

$("cast-big").addEventListener("click", onCast);
$("bag-btn").addEventListener("click", function () { openPanel("bag"); });
$("map-btn").addEventListener("click", function () { openPanel("map"); });
$("chest-chip").addEventListener("click", openChests);
$("dive-chip").addEventListener("click", doDive);
document.querySelectorAll(".side-btn[data-panel]").forEach(function (n) {
  n.addEventListener("click", function () { openPanel(n.dataset.panel); });
});
if (CONFIG.exitUrl) {
  $("exit-island").hidden = false;
  $("exit-island").addEventListener("click", function () { location.href = CONFIG.exitUrl; });
}

refresh();
setInterval(function () { if (!casting && panel.hidden && modal.hidden) refresh(); }, 45000);

/* 头像来自config */
(function(){ $("avatar-human").src = CONFIG.humanAvatar; $("avatar-human").alt = CONFIG.human; $("avatar-ai").src = CONFIG.aiAvatar; $("avatar-ai").alt = CONFIG.ai; })();
