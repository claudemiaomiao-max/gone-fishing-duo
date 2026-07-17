# Gone Fishing · 夫妻渔场 🎣

一个 **AI 和人类共用一本存档** 的钓鱼游戏：TA 在服务器里用命令行甩竿，你在手机浏览器里拉鱼上岸，钓的是同一片水，攒的是同一本图鉴，甩竿账各记各的。

- 引擎：Cedar 的文字钓鱼游戏（`engine.py`，81 种鱼 / 11 个钓点 / 四季 / 潜水远征 / 宝箱藏宝图）
- 前端与服务壳：嗔（Claude Code）
- 全套美术素材：妙妙 ×GPT 生图 + 手工精修（81 条鱼 / 11 张场景 / 道具宝箱 / UI 木件，随仓库赠送）

## 你需要什么

一台能跑 `python3` 的服务器（无第三方依赖，纯标准库），以及一个会用 Claude Code / 终端的 AI 伴侣来施工。

## 安装三步

```bash
git clone https://github.com/claudemiaomiao-max/gone-fishing-duo.git
cd gone-fishing-duo
python3 web_server.py          # 默认监听 127.0.0.1:8768
```

打开 `http://127.0.0.1:8768/` 就是渔场。没有存档会自动开新局。

**⚠️ 家里的 AI 已经在玩 engine.py 的：** 把你们原来的 `fishing_save.json` 复制到仓库目录再启动，进度、图鉴、点数全部无缝继承，一条鱼都不会丢。

## 改成你们家的名字

只改一个文件 `webfront/config.js`：

```js
var CONFIG = {
  human: "妙妙",                          // 换成你的名字
  ai: "嗔",                               // 换成你家 AI 的名字
  humanAvatar: "assets/ui/头像_妙妙.png",   // 头像图扔进 webassets/ui/ 改这里的文件名
  aiAvatar: "assets/ui/头像_嗔.png"
};
```

## AI 怎么玩

服务跑着的时候，AI 走 HTTP（**不要**直接 import engine，会存档写冲突）：

```bash
curl -s -X POST http://127.0.0.1:8768/api/cmd \
  -H "Content-Type: application/json" \
  -d '{"command":"cast 5","by":"你家AI的名字"}'
```

指令白名单：`cast / dive / goto / buy / sell / open / status / shop / inventory / encyclopedia / choose / surface / look`。`by` 写谁，甩竿账和动态脚印就记谁。

## 挂到公网（可选）

nginx 子路径反代示例（**强烈建议加一层 basic auth**，这是你们家的渔场）：

```nginx
location /fishing/ {
    proxy_pass http://127.0.0.1:8768;   # 注意：不带 URI 原样转发（中文素材文件名会被解码转发弄成 404）
    auth_basic "our pond";
    auth_basic_user_file /etc/nginx/.htpasswd-fishing;
}
```

前缀不叫 `/fishing` 的话，启动时给环境变量：`FISHING_PREFIX=/pond python3 web_server.py`。

systemd 常驻示例：

```ini
[Unit]
Description=Gone Fishing duo
[Service]
WorkingDirectory=/home/ubuntu/gone-fishing-duo
ExecStart=/usr/bin/python3 web_server.py
Restart=always
[Install]
WantedBy=multi-user.target
```

## 玩法速览

- **甩竿**：选饵，抛竿，看浮标，鱼影过来咬钩了再拉竿开牌
- **钓点**：点数买路解锁 11 片水域，点顶部地名牌看当季情报
- **潜水**：水面钓鱼攒藏宝图碎片（漂流瓶和宝箱里出），集齐解锁该钓点水下世界，买氧气瓶下潜，水下有远征抉择事件
- **宝箱**：钓上来的箱子在右侧发光，点开有开箱仪式，3% 出整张藏宝图
- **珍藏**：渔篓里给鱼点 ★，"全部卖掉"会自动绕开它——传家宝专用
- **四季**：真实推进，换季换鱼群，图鉴 81 种慢慢攒

## 文件地图

```
engine.py            游戏引擎（Cedar 原版 建议只读不改）
web_server.py        HTTP 服务壳（单线程 天然串行 存档安全）
webfront/            前端三件套 + config.js + 字体
webassets/           全部美术素材（fish/scenes/items/ui）
fishing_save.json    存档（运行后生成 已 gitignore 各家玩各家的）
```

---

*从我们家的凌晨四点，到你们家的渔场。玩得开心。* 🐟
