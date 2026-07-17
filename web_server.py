#!/usr/bin/env python3
"""Gone Fishing 夫妻渔场 · 人类端服务壳
- 单线程HTTP：网页与AI指令天然串行，engine全局状态安全
- 动作走 engine.cmd() 文本；数据走存档投影；战绩账本（谁钓的）壳层维护
- 端口默认8768（环境变量FISHING_PORT可改）；nginx子路径反代时原样转发 由后端剥前缀（FISHING_PREFIX）
"""
import json
import os
import copy
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import engine
engine.cmd("status")  # 触发 _load()：import时 S=None，首次cmd才读存档

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "webfront"
ASSETS = ROOT / "webassets"
CREDITS_PATH = ROOT / "fishing_credits.json"
ACTIVITY_PATH = ROOT / "fishing_activity.json"
KEEPSAKES_PATH = ROOT / "fishing_keepsakes.json"


def load_keepsakes():
    """珍藏鱼的instance_id列表——sell all/species 自动跳过这些"""
    if KEEPSAKES_PATH.exists():
        try:
            with KEEPSAKES_PATH.open() as f:
                return json.load(f)
        except Exception:
            return []
    return []


def save_keepsakes(ids):
    tmp = str(KEEPSAKES_PATH) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(ids, f, ensure_ascii=False)
    os.replace(tmp, str(KEEPSAKES_PATH))


def log_activity(by, summary):
    import time
    rows = []
    if ACTIVITY_PATH.exists():
        try:
            with ACTIVITY_PATH.open() as f:
                rows = json.load(f)
        except Exception:
            rows = []
    rows.append({"ts": int(time.time()), "by": by or "?", "text": summary})
    rows = rows[-50:]
    tmp = str(ACTIVITY_PATH) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(rows, f, ensure_ascii=False)
    os.replace(tmp, str(ACTIVITY_PATH))

PREFIX = os.getenv("FISHING_PREFIX", "/fishing")   # nginx子路径反代时剥的前缀 直连不影响


def load_credits():
    if CREDITS_PATH.exists():
        with CREDITS_PATH.open() as f:
            return json.load(f)
    return {"fish": {}, "totals": {}}


def save_credits(data):
    tmp = str(CREDITS_PATH) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, str(CREDITS_PATH))


def snapshot():
    """动作前后对比用的存档快照（浅拷贝关心的键）"""
    S = engine.S
    return {
        "points": S["points"],
        "enc": set(S["encyclopedia"].keys()),
        "catch_n": len(S["catch_inventory"]),
        "items": copy.deepcopy(S.get("items", {})),
        "chests": len(S.get("pending_chests", [])),
        "turn": S["turn"],
        "fragments": copy.deepcopy(S.get("map_fragments", {})),
    }


def diff_after(before, by):
    """动作后的收获结算 + 战绩记账"""
    S = engine.S
    after_enc = set(S["encyclopedia"].keys())
    new_fish_ids = after_enc - before["enc"]
    new_fish = []
    for fid in new_fish_ids:
        f = engine.FISH.get(fid, {})
        new_fish.append({"id": fid, "name": f.get("name", fid), "rarity": f.get("rarity", "")})
    caught_delta = len(S["catch_inventory"]) - before["catch_n"]
    # 渔获明细：取catch_inventory尾部新增
    new_catches = []
    if caught_delta > 0:
        for c in S["catch_inventory"][-caught_delta:]:
            fid = c.get("fish_id") or c.get("id")
            f = engine.FISH.get(fid, {})
            new_catches.append({"id": fid, "name": f.get("name", fid), "size": c.get("size"),
                                "value": c.get("value"), "rarity": f.get("rarity", "")})
    # 战绩账本（渔获数+甩竿数）
    if by and (new_catches or S["turn"] > before["turn"]):
        credits = load_credits()
        for c in new_catches:
            entry = credits["fish"].setdefault(c["id"], {"first_by": by, "counts": {}})
            entry["counts"][by] = entry["counts"].get(by, 0) + 1
        if new_catches:
            credits["totals"][by] = credits["totals"].get(by, 0) + len(new_catches)
        turns = S["turn"] - before["turn"]
        if turns > 0:
            casts = credits.setdefault("casts", {})
            casts[by] = casts.get(by, 0) + turns
        save_credits(credits)
    # 碎片入账检测（她的反馈：钓到碎片毫无存在感）
    new_fragments = []
    after_frags = S.get("map_fragments", {})
    for lid, n in after_frags.items():
        delta = n - before["fragments"].get(lid, 0)
        if delta > 0:
            loc = engine.LOCATIONS.get(lid, {})
            need = engine._dive_frags_needed(loc) if loc else "?"
            new_fragments.append({"loc": loc.get("name", lid), "got": delta, "have": n, "need": need})
    # 宝物入账检测
    new_items = []
    for iid, qty in S.get("items", {}).items():
        delta = qty - before["items"].get(iid, 0)
        if delta > 0:
            it = engine.ITEMS.get(iid, {})
            new_items.append({"id": iid, "name": it.get("name", iid), "qty": delta})
    return {
        "points_delta": S["points"] - before["points"],
        "new_fish": new_fish,           # 图鉴新解锁
        "new_catches": new_catches,     # 本次渔获
        "new_chests": len(S.get("pending_chests", [])) - before["chests"],
        "new_fragments": new_fragments,
        "new_items": new_items,
        "turns": S["turn"] - before["turn"],
    }


def project_state():
    S = engine.S
    loc = engine.LOCATIONS[S["location_id"]]
    season = engine.SEASONS[S["season_id"]]
    baits = []
    for bid, b in engine.BAITS.items():
        baits.append({"id": bid, "name": b["name"], "price": b.get("cost"),
                      "desc": b.get("description", ""), "qty": S["bait_inventory"].get(bid, 0)})
    locations = []
    for lid, l in engine.LOCATIONS.items():
        locations.append({"id": lid, "name": l["name"], "unlocked": lid in S["unlocked_locations"],
                          "current": lid == S["location_id"], "unlock_cost": l.get("unlock_cost", 0)})
    season_ok = S["season_id"] in loc.get("available_seasons", [])
    try:
        normal, legend = engine._undiscovered_here(S["location_id"], S["season_id"]) if season_ok else (0, 0)
    except Exception:
        normal, legend = 0, 0
    try:
        dive_n = engine._undiscovered_dive(S["location_id"], S["season_id"]) if engine._dive_unlocked(S["location_id"]) else -1
    except Exception:
        dive_n = -1
    # 本地独家鱼种（火系两点共享一批鱼 认地方要认独家）
    exclusive = []
    try:
        here = S["location_id"]
        for f in engine.FISH.values():
            flocs = f.get("locations", [])
            if here in flocs and len([x for x in flocs if x in engine.LOCATIONS]) == 1 and not f.get("dive_only"):
                exclusive.append({"name": f["name"], "rarity": f.get("rarity", ""),
                                  "in_season": ("all" in f.get("seasons", []) or S["season_id"] in f.get("seasons", [])),
                                  "caught": f["id"] in S["encyclopedia"]})
    except Exception:
        exclusive = []
    return {
        "points": S["points"],
        "turn": S["turn"],
        "season": season["name"],
        "location": {"id": S["location_id"], "name": loc["name"],
                     "desc": loc.get("description", ""), "character": loc.get("character", ""),
                     "season_ok": season_ok, "undiscovered": normal, "undiscovered_legend": legend,
                     "dive_undiscovered": dive_n, "exclusive_fish": exclusive},
        "locations": locations,
        "baits": baits,
        "hold": len(S["catch_inventory"]),
        "oxygen": S.get("oxygen", 0),
        "dive_unlocked_here": bool(engine._dive_unlocked(S["location_id"])),
        "pending_chests": [{"uid": c.get("chest_uid"), "event_id": c.get("event_id"),
                            "name": (engine.EVENTS.get(c.get("event_id"), {}) or engine.DIVE_EVENTS.get(c.get("event_id"), {})).get("name", "宝箱")}
                           for c in S.get("pending_chests", [])],
        "fever": S.get("fever", 0),
        "free_bait": S.get("free_bait", 0),
        "enc_count": len(S["encyclopedia"]),
        "enc_total": len(engine.FISH),
        "map_fragments": S.get("map_fragments", {}),
        "ambience": loc.get("ambience", []),
        "casts_by": load_credits().get("casts", {}),
        "expedition": ({"pending": S["expedition"].get("pending"), "oxygen_left": S["expedition"].get("left", 0)}
                       if S.get("expedition") else None),
    }


def project_encyclopedia():
    S = engine.S
    credits = load_credits()
    fish = []
    for fid, f in engine.FISH.items():
        rec = S["encyclopedia"].get(fid)
        credit = credits["fish"].get(fid, {})
        fish.append({
            "id": fid, "name": f.get("name", fid),
            "rarity": f.get("rarity", ""),
            "rarity_label": engine.RARITY.get(f.get("rarity", ""), {}).get("label", ""),
            "tags": f.get("tags", []),
            "caught": bool(rec),
            "best_size": (rec or {}).get("max_size"),
            "count": (rec or {}).get("count", 0),
            "first_by": credit.get("first_by"),
            "counts_by": credit.get("counts", {}),
            "desc": f.get("description", "") if rec else "",
        })
    return {"total": len(engine.FISH), "caught": len(S["encyclopedia"]), "fish": fish,
            "totals_by": credits.get("totals", {})}


def project_inventory():
    S = engine.S
    kept = set(load_keepsakes())
    catches = []
    for c in S["catch_inventory"]:
        fid = c.get("fish_id") or c.get("id")
        f = engine.FISH.get(fid, {})
        catches.append({"id": fid, "name": f.get("name", fid), "size": c.get("size"),
                        "value": c.get("value"), "rarity": f.get("rarity", ""),
                        "instance_id": c.get("instance_id"),
                        "kept": c.get("instance_id") in kept})
    items = []
    for iid, qty in S.get("items", {}).items():
        it = engine.ITEMS.get(iid, {})
        if qty > 0:
            items.append({"id": iid, "name": it.get("name", iid), "qty": qty,
                          "value": it.get("value", 0), "desc": it.get("description", ""),
                          "sellable": bool(it.get("sellable"))})
    return {"catches": catches, "items": items, "points": S["points"]}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path):
        if path == "/":
            target = WEB / "index.html"
        elif path in ("/app.js", "/style.css", "/config.js"):
            target = WEB / path[1:]
        elif path.startswith("/fonts/"):
            rel = urllib.parse.unquote(path[len("/fonts/"):])
            target = WEB / "fonts" / rel
            try:
                target.resolve().relative_to((WEB / "fonts").resolve())
            except (OSError, ValueError):
                return self._json(404, {"ok": False, "error": "not found"})
        elif path.startswith("/assets/"):
            rel = urllib.parse.unquote(path[len("/assets/"):])
            target = ASSETS / rel
            try:
                target.resolve().relative_to(ASSETS.resolve())
            except (OSError, ValueError):
                return self._json(404, {"ok": False, "error": "not found"})
        else:
            return self._json(404, {"ok": False, "error": "not found"})
        if not target.is_file():
            return self._json(404, {"ok": False, "error": "not found"})
        body = target.read_bytes()
        import mimetypes
        mime = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache" if target.suffix in (".html", ".js", ".css") else "public, max-age=86400")
        self.end_headers()
        self.wfile.write(body)

    def _strip(self):
        if self.path == PREFIX or self.path.startswith(PREFIX + "/") or self.path.startswith(PREFIX + "?"):
            self.path = self.path[len(PREFIX):] or "/"

    def do_GET(self):
        try:
            self._strip()
            p = urllib.parse.urlsplit(self.path)
            if p.path == "/api/health":
                return self._json(200, {"ok": True, "service": "fishing-standalone"})
            if p.path == "/api/state":
                return self._json(200, {"ok": True, "data": project_state()})
            if p.path == "/api/encyclopedia":
                return self._json(200, {"ok": True, "data": project_encyclopedia()})
            if p.path == "/api/inventory":
                return self._json(200, {"ok": True, "data": project_inventory()})
            if p.path == "/api/activity":
                rows = []
                if ACTIVITY_PATH.exists():
                    try:
                        with ACTIVITY_PATH.open() as f:
                            rows = json.load(f)
                    except Exception:
                        rows = []
                return self._json(200, {"ok": True, "data": rows[::-1]})
            return self._file(p.path)
        except Exception as exc:
            self._json(500, {"ok": False, "error": str(exc)})

    def do_POST(self):
        try:
            self._strip()
            p = urllib.parse.urlsplit(self.path)
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            if p.path == "/api/cmd":
                command = str(body.get("command", "")).strip()
                by = str(body.get("by", "")).strip() or None
                ALLOWED = ("cast", "dive", "goto", "buy", "sell", "open", "status", "shop", "inventory", "encyclopedia", "choose", "surface", "look")
                if not command or command.split()[0] not in ALLOWED:
                    return self._json(400, {"ok": False, "error": "指令不在白名单"})
                # 珍藏保护：sell all / sell species 前把珍藏的鱼临时摘出渔篓，卖完塞回
                kept_ids = set(load_keepsakes())
                stashed = []
                if command.startswith("sell") and kept_ids:
                    target = command[4:].strip()
                    if target in kept_ids:
                        return self._json(400, {"ok": False, "error": "这条鱼被珍藏着，先取消珍藏才能卖"})
                    if target == "all" or target.startswith("species"):
                        inv = engine.S["catch_inventory"]
                        stashed = [c for c in inv if c.get("instance_id") in kept_ids]
                        engine.S["catch_inventory"] = [c for c in inv if c.get("instance_id") not in kept_ids]
                before = snapshot()
                try:
                    text = engine.cmd(command)
                    result = diff_after(before, by)
                finally:
                    if stashed:
                        engine.S["catch_inventory"].extend(stashed)
                        engine._save()
                if stashed:
                    text += "\n🔒 珍藏的 %d 条鱼安然待在篓底，没动。" % len(stashed)
                try:
                    if result["new_catches"]:
                        # 同名同尺寸聚合（渔获热潮一竿双倍时别把名字念两遍）
                        agg = []
                        for c in result["new_catches"]:
                            label = c["name"] + (("(" + str(c["size"]) + "cm)") if c.get("size") else "")
                            if agg and agg[-1][0] == label:
                                agg[-1][1] += 1
                            else:
                                agg.append([label, 1])
                        names = "、".join(l + (("×" + str(n)) if n > 1 else "") for l, n in agg[:3])
                        more = len(agg) - 3
                        log_activity(by, "钓到了 " + names + (("等" + str(len(result["new_catches"])) + "条") if more > 0 else ""))
                    elif command.startswith("goto") and result.get("turns", 0) >= 0 and "来到" in text:
                        log_activity(by, "去了 " + engine.LOCATIONS[engine.S["location_id"]]["name"])
                    elif command.startswith("open"):
                        log_activity(by, "开了一个宝箱")
                    elif command.startswith("dive"):
                        log_activity(by, "潜了一次水")
                    elif command.startswith("sell") and result["points_delta"] > 0:
                        log_activity(by, "卖了渔获，进账 " + str(result["points_delta"]) + " 点")
                    elif command.startswith("buy") and result["points_delta"] < 0:
                        log_activity(by, "进了一批货，花了 " + str(-result["points_delta"]) + " 点")
                except Exception:
                    pass
                return self._json(200, {"ok": True, "text": text, "result": result,
                                        "state": project_state()})
            if p.path == "/api/keep":
                iid = str(body.get("instance_id", "")).strip()
                on = bool(body.get("on"))
                if not any(c.get("instance_id") == iid for c in engine.S["catch_inventory"]):
                    return self._json(400, {"ok": False, "error": "渔篓里没有这条鱼"})
                ids = load_keepsakes()
                if on and iid not in ids:
                    ids.append(iid)
                if not on:
                    ids = [x for x in ids if x != iid]
                save_keepsakes(ids)
                return self._json(200, {"ok": True, "kept": ids})
            return self._json(404, {"ok": False, "error": "not found"})
        except Exception as exc:
            self._json(500, {"ok": False, "error": str(exc)})


if __name__ == "__main__":
    host = os.getenv("FISHING_HOST", "127.0.0.1")
    port = int(os.getenv("FISHING_PORT", "8768"))
    print(f"Gone Fishing 独立服务: http://{host}:{port}")
    HTTPServer((host, port), Handler).serve_forever()
