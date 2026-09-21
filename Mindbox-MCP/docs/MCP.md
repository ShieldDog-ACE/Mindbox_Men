# Mindbox-MCP 的 MCP 接口手册

版本 1.0.0测试版 · 2026-09-21 · 面向二次开发者与接 AI 的人


## 一、这份文档给谁看

[README.md](../README.md) 讲的是"这软件是什么、怎么装、怎么用"。
这份文档讲的是"它的 MCP 接口长什么样"。

如果你属于下面这几种情况，看这份：

- 你想自己写一个 MCP 客户端来接它，需要知道协议细节
- 你想给它加一个自己的工具
- 你想让 AI 直接按格式调，而不是等它自己摸索
- 你遇到报错，想看错误码是什么意思
- 你想知道记忆到底存成什么样，或者想绕开工具直接改文件

如果你只是想装上用起来，看 [README.md](../README.md) 就够了，这份可以先不看。


## 二、先说清楚 MCP 是什么

MCP 全称 Model Context Protocol，是给 AI 客户端用的一套接口约定。
你可以把它理解成"AI 版的 USB 接口"：

```text
客户端（Trae、Cursor、Claude Code 这些）
    ↓ 按约定的格式发请求
服务端（就是本项目）
    ↓ 按约定的格式回结果
```

约定本身不复杂：消息是 JSON，走标准输入输出，
一来一回，每条消息占一行。

有个概念要先分清：MCP 里说的"工具"（tool），
就是一个带参数的函数。客户端会把所有工具的名字和参数说明
告诉 AI，AI 自己决定调哪个、传什么。

所以我们要做的事只有两件：
1. 把工具清单报给客户端（`tools/list`）
2. 客户端说"调这个工具、参数是这些"的时候执行它（`tools/call`）

就这么简单。剩下的都是格式细节。


## 三、怎么接进去

配置就一段 JSON，把它交给客户端：

```json
{
  "mcpServers": {
    "mindbox-memory": {
      "command": "/你的绝对路径/Mindbox-MCP/run-mindbox-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

几个要点：

1. `command` 一定要绝对路径。客户端的工作目录不固定，
   写相对路径十有八九找不到。

2. server 的名字（这里叫 `mindbox-memory`）可以自己改，
   但改了之后在各客户端里显示的名字也跟着变。

3. 不需要传任何环境变量，`env` 留空就行。

4. 如果你不想用 `run-mindbox-mcp` 这个启动脚本，可以换成：

   ```json
   "command": "python3",
   "args": ["/你的绝对路径/Mindbox-MCP/server.py"]
   ```

   两种写法效果一样。脚本的好处是它会自己定位所在目录，
   哪怕你从别的目录启动也不会找错文件。

各客户端放配置的位置，[README.md](../README.md) 里写了，这里不重复。

接好之后先自检，不用等客户端：

```bash
python3 /你的路径/Mindbox-MCP/server.py --check
```

正常的话会打印服务器名、版本、工具数量，以及三层记忆的条数。
这命令只是打印信息，不会进入服务模式。

排错顺序，按这个来基本都能定位：

1. `--check` 报错 → Python 版本或文件路径有问题
2. `--check` 正常但客户端连不上 → 配置里 `command` 不是绝对路径
3. 连上了但看不到工具 → 客户端没重载，或者配置在错误的文件里
4. 工具调用报错 → 看下面第四节和第五节的说明

注意：改完配置通常要重载客户端才会生效。
Trae 是按 Ctrl+Shift+P 输入 Reload Window。


## 四、传输与协议约定

### 4.1 帧格式

走标准输入输出（stdio），UTF-8 编码。
一条消息一行，用换行符分隔。
消息内部不能出现换行符，要分行就转义成 `\n`。

所有消息都是标准 JSON-RPC 2.0 格式，带 `jsonrpc` / `method` / `id` 字段。
如果客户端是逐行读的，每条回复也必须只占一行。

### 4.2 支持的方法

- `initialize` 握手，交换版本和能力
- `notifications/initialized` 客户端通知已就绪（不用回包）
- `ping` 探活
- `tools/list` 取工具清单
- `tools/call` 执行工具

其他方法一律返回 `-32601` 方法不存在。

这里有个容易踩的坑：任何以 `notifications/` 开头的方法都是通知，
服务端不回包。如果你的客户端发了通知还在等回复，会一直卡住。

### 4.3 initialize 的返回

请求：

```json
{"jsonrpc":"2.0","id":1,"method":"initialize",
 "params":{"protocolVersion":"2025-06-18",
           "capabilities":{},
           "clientInfo":{"name":"demo","version":"1.0"}}}
```

返回的 `result` 里有四样东西：

- `protocolVersion` 回显客户端传进来的版本（没传就用 `2025-06-18`）
- `capabilities` 声明能力，这里只有 `tools`
- `serverInfo` 服务端名字和版本
- `instructions` 一段给 AI 看的说明，讲三层记忆怎么用

`instructions` 这个字段值得留意。它是写给 AI 看的"使用须知"，
客户端通常会把这段塞进系统提示里。如果你在写客户端，
建议别丢掉它——它能让 AI 少用错工具。

### 4.4 调用工具与返回格式

请求：

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call",
 "params":{"name":"memory_overview","arguments":{}}}
```

返回：

```json
{"jsonrpc":"2.0","id":2,"result":{
  "content":[{"type":"text","text":"{...JSON 字符串...}"}],
  "isError":false
}}
```

两个要注意的地方：

1. `content` 是数组，里面每一项有 `type` 和 `text`。
   本项目固定只返回一项，`type` 是 "text"，
   而 `text` 是一段 **JSON 字符串**，需要你自己再解析一次。

   为什么不用 `structuredContent`？因为这样兼容性最好，
   老客户端新客户端都能用，代价就是多一层解析。

2. `isError` 在工具执行失败时是 true，但 HTTP/连接层不会失败。
   也就是说 AI 参数传错了，你会收到 `isError:true` + 一段错误文本，
   连接还在，可以接着调下一个工具。

   这是有意设计的：工具级错误不该把整个会话搞断。

### 4.5 错误处理

JSON-RPC 层面的错误（这些是协议错误，连接可能不好继续）：

- `-32700` 收到的不是合法 JSON
- `-32600` 请求不是合法的 JSON-RPC 对象
- `-32601` 方法不存在
- `-32603` 服务端内部异常（兜底）

工具层面的错误（`isError:true`，连接不受影响）：

- 未知工具 `KeyError: 未知工具:xxx`
- 条目不存在 `KeyError: 未找到条目:xxx`
- 记忆层写错 `ValueError: 未知记忆层:xxx`
- 置信度太低 `ValueError: 置信度 < 60，证据不足，已拒收`
- 想删根文件夹 `PermissionError: xxx 是系统自带文件夹，不可删除`
- 越界路径 `PermissionError: 越界路径，已拒绝`

### 4.6 三条硬性约定

一、服务端的日志全部走 `stderr`，`stdout` 只跑协议消息。
你自己写客户端或者改服务端时务必守这条，否则日志会混进
JSON 流里，客户端一解析就炸。这类 bug 特别难查。

二、通知不回包。理由上面说过了。

三、支持批量请求。如果你一次发一个 JSON 数组，
服务端会逐个处理，然后把所有回复打包成一个数组返回。
如果数组里全是通知，就一个包都不回。


## 五、9 个工具

### 5.1 总表

| 分组 | 工具名 | 干什么 |
| --- | --- | --- |
| 概览 | `memory_overview` | 看三层记忆的总体情况 |
| 短期记忆 | `session_open` | 开会话，也兼作读会话 |
|  | `session_update` | 更新会话进度 |
|  | `session_close` | 结束会话 |
| 长期/永久 | `memory_add` | 写一条记忆条目 |
|  | `memory_query` | 检索记忆 |
|  | `memory_delete` | 删一条（纠错） |
| 知识图 | `add_triple` | 写三元组，按置信度分流 |
|  | `query_graph` | 在知识图上检索 |

只有 9 个是刻意控制的。工具越多，AI 越容易挑错，
而且每个工具的定义都会占用上下文。凡是能被别的工具覆盖的，
或者你打开文件夹就能看的，一律没做。

### 5.2 逐个说明

下面每个工具先列参数，再给个调用例子。
带 * 的是必填。

#### memory_overview

参数：无

返回三层记忆的条数统计和受保护文件夹状态。

```text
调用：memory_overview()
返回：{
  "root": "/media/.../Mindbox-MCP",
  "protected_folders": ["短期记忆","长期记忆","永久记忆"],
  "短期记忆": {"sessions": 3},
  "长期记忆": {"items": 12, "by_category": {"用户偏好": 2, ...}},
  "永久记忆": {"items": 4, "triples": 17}
}
```

适合 AI 在会话开始时快速确认记忆库里有什么。

#### session_open

参数：

- `agent` * 你的标识，比如 `trae` / `cursor` / `claude-code`
- `session_id` * 这次会话的唯一 ID，建议时间戳加随机串
- `title` 任务简述
- `summary` 现状摘要

作用：在"短期记忆/<agent>/<session_id>/"下建文件夹，
写一份 `会话.json`，再顺手生成一份给人看的 `上下文.md`。

如果这个会话已经存在，会返回 `resumed: true` 并把旧快照带回来。
所以它同时是"新建"和"读取"两个功能——没有单独的读会话工具。

```text
调用：session_open(agent="trae", session_id="s-20260921-2300",
                   title="修打包丢数据")
返回：{
  "folder": "短期记忆/trae/s-20260921-2300",
  "agent": "trae", "session_id": "s-20260921-2300",
  "title": "修打包丢数据", "status": "open",
  "resumed": false, "created_at": "...", "updated_at": "...",
  "summary": "", "tasks": [], "todos": [], "conclusions": [], "context": []
}
```

为什么这事重要：它把"当前任务状态"从 AI 的上下文窗口里
挪到磁盘上。上下文快满的时候，AI 再 open 一次就把状态读回来了，
不用把整段历史一直背着。

#### session_update

参数：

- `agent` * 同上
- `session_id` * 同上
- `summary` 现状摘要（覆盖）
- `tasks` 任务列表，元素形如 `{"text":"...","status":"done"}`
- `todos` 待办字符串列表
- `conclusions` 中间结论列表
- `context` 关键上下文列表
- `status` 状态，`open` / `closed`

作用：增量更新。**只覆盖你传进来的字段**，没传的保持原值。
所以想只改待办就只传 `todos`，不用担心把别的字段清空。

想随手记一句，追加到 `context` 就行：

```text
调用：session_update(agent="trae", session_id="s-20260921-2300",
                     context=["[随手记] 用户说不要弹窗打断"])
```

每次更新都会重新生成 `上下文.md`。

#### session_close

参数：

- `agent` * 同上
- `session_id` * 同上
- `promote` 布尔，默认 `false`

作用：把会话状态标成 `closed`，冻结快照。

如果 `promote` 传 `true`，会把 `conclusions` 里的每一条
转成一条长期记忆（归到"项目上下文"类，置信度 60）。

```text
调用：session_close(agent="trae", session_id="s-20260921-2300",
                    promote=True)
返回：{"closed": true, "folder": "...", "promoted": true}
```

为什么置信度只给 60：会话结论只是"当时的判断"，
不一定经得起验证，所以先放长期区，不直接进永久。

#### memory_add

参数：

- `layer` * "长期记忆" 或 "永久记忆"
- `category` * 分类，见下面的表
- `content` * 正文
- `confidence` 置信度 0-100，默认 50
- `source` 来源，比如 "agent:trae"
- `tags` 标签数组

分类的合法值（左边是机读 key，右边是对应的中文文件夹名）：

- `task` 任务记录 最近 1-4 周完成或失败的任务
- `skill` 技能配方 新学但还没反复验证的做法
- `digest` 资料摘要 看过的论文/网页/视频要点
- `preference` 用户偏好 近期表现出的偏好
- `pending_triple` 待验证三元组 置信度 60-84 的三元组会落在这里
- `error_case` 错误案例 犯过的错，避免重犯
- `emotion` 情绪历史 用户状态波动（这类不会升永久）
- `ai_effect` 外部大脑效果 哪个 AI 在什么场景更有效
- `project` 项目上下文 项目进度、依赖

`category` 传中文名或 key 都认。

记错误案例也走这个工具，格式建议统一成
"[做了什么] —[什么原因]→ [什么后果]"：

```text
调用：memory_add(layer="长期记忆", category="error_case",
                 content="[把 vault 放在打包产物下] —[打包会清空该目录]→ [笔记被删]",
                 confidence=90, source="agent:trae")
返回：{
  "stored": "长期记忆",
  "path": "长期记忆/错误案例/20260921-224223-a1bb.json",
  "item": {"id": "20260921-224223-a1bb", "layer": "长期记忆",
           "category": "error_case", "category_label": "错误案例",
           "content": "...", "confidence": 90,
           "tags": [], "source": "agent:trae", "session": "",
           "created_at": "...", "updated_at": "..."}
}
```

file 名就是 item 的 `id`，后面 `memory_delete` 要用它。

#### memory_query

参数：

- `keyword` * 查询词，中英文都行
- `layer` 限定某一层；不传就查长期 + 永久
- `top_k` 返回条数上限，默认 10

作用：分词检索。把查询词和库里内容都切一遍，
按"命中词数 × 置信度"排序。

```text
调用：memory_query(keyword="打包 数据目录 笔记丢失", top_k=3)
返回：{
  "keyword": "打包 数据目录 笔记丢失",
  "tokens": ["打","打包", ...],
  "count": 4,
  "hits": [
    {"layer": "长期记忆", "score": 24.7,
     "id": "...", "category": "error_case", ... },
    ...
  ]
}
```

`hits` 里是**完整条目**（不只是摘要），所以搜到就能直接用，
不用再调一次"按 id 取详情"。

#### memory_delete

参数：

- `layer` * "长期记忆" 或 "永久记忆"
- `item_id` * 条目 id

作用：删掉一条。给 AI 纠正自己写错的东西用。

```text
调用：memory_delete(layer="长期记忆", item_id="20260921-224223-a1bb")
返回：{"deleted": "20260921-224223-a1bb", "layer": "长期记忆"}
```

注意它删的只是**条目**。三个记忆根文件夹本身删不掉，
工具层会直接拒绝，这是有意的。

#### add_triple

参数：

- `subject` * 主语
- `relation` * 关系
- `object` * 宾语
- `category` 大类，默认"未分类"
- `confidence` 置信度，默认 70
- `source` 来源

作用：写一条"主语 —[关系]→ 宾语"的三元组。
置信度决定它去哪，这是整套系统里最硬的一条规则：

```text
confidence >= 85   → 写进 永久记忆/triples.json（知识图）
confidence 60-84   → 落成一条长期记忆，归"待验证三元组"类
confidence < 60    → 直接拒收，报错
```

```text
调用（进永久）：
  add_triple(subject="exfat 分区", relation="不支持", object="符号链接",
             category="文件系统", confidence=95)
  返回：{"stored": "永久记忆", "triple": {...}, "total": 3}

调用（进待验证）：
  add_triple(subject="新方法X", relation="可能有效于", object="财报分析",
             confidence=65)
  返回：{"stored": "长期记忆(待验证三元组)", "item": {...}}

调用（被拒）：
  add_triple(subject="瞎猜", relation="也许", object="没用", confidence=20)
  返回：isError=true，"ValueError: 置信度 < 60，证据不足，已拒收..."
```

注意参数名叫 `object`，虽然它是 Python 的关键字之一，
但在 JSON 里这就是个普通字段名，照传就行。

#### query_graph

参数：

- `keyword` * 查询词
- `depth` 往外扩几圈，默认 1
- `limit` 返回条数上限，默认 30

作用：只在永久知识图上检索。
先找出命中的三元组，然后以它们的节点为起点，
沿关系边往外扩 `depth`-1 圈。默认扩 1 圈，
也就是"直接相关 + 相邻一层"。

```text
调用：query_graph(keyword="exfat 打包", depth=1)
返回：{"keyword": "exfat 打包", "count": 3, "triples": [{...}, {...}]}
```

这个工具和 `memory_query` 的区别：`memory_query` 是关键词匹配，
`query_graph` 是顺着关系找。两个都要用，互补。

### 5.3 置信度门槛，再强调一遍

```text
>= 85   进永久知识图
60-84   进长期待验证区
< 60    拒收
```

这条规则是在服务端强制执行的，不是建议。
所以如果你在写 AI 的提示词，别让它为了"想记住"就乱报高分。
宁可 70 分放待验证区，也别编个 95。

长期记忆转到永久，现在的办法是：确认无误之后，
用 >= 85 的置信度重新写成一条三元组。目前没有自动晋升。


## 六、数据落在磁盘上长什么样

服务端没有缓存。你直接改文件，下次调用就读到新的。

整体结构：

```text
Mindbox-MCP/
├── 短期记忆/
│   └── <agent>/<session_id>/
│       ├── 会话.json      机读
│       └── 上下文.md      人读镜像（服务生成）
├── 长期记忆/
│   └── <中文分类>/<item_id>.json
└── 永久记忆/
    ├── <item_id>.json
    └── triples.json
```

短期记忆的 `会话.json`：

```json
{
  "agent": "trae",
  "session_id": "s-20260921-2300",
  "title": "修打包丢数据",
  "status": "open",
  "created_at": "2026-09-21 22:30:00",
  "updated_at": "2026-09-21 22:41:12",
  "summary": "把 vault 从 resources 挪到 userData，已改 main.js",
  "tasks": [{"text": "改 vaultDir()", "status": "done"}],
  "todos": ["重打 deb 验证"],
  "conclusions": ["打包态数据必须放 userData 下"],
  "context": ["[2026-09-21 22:35:00] 用户强调不能再丢笔记"]
}
```

长期/永久条目的结构：

```json
{
  "id": "20260921-224218-f350",
  "layer": "长期记忆",
  "category": "preference",
  "category_label": "用户偏好",
  "content": "用户要求中文回答",
  "confidence": 85,
  "tags": [],
  "source": "agent:trae",
  "session": "",
  "created_at": "2026-09-21 22:42:18",
  "updated_at": "2026-09-21 22:42:18"
}
```

`id` 的格式是 年月日-时分秒-四位随机，文件名就是它。

永久记忆的 `triples.json`：

```json
{"triples": [
  {"subject": "exfat 分区", "relation": "不支持", "object": "符号链接",
   "class": "文件系统", "confidence": 95, "source": "",
   "created_at": "2026-09-21 22:42:18"}
]}
```

读的时候有个坑：list 那层会把 `triples.json` 和普通条目文件
放在同一个目录下，代码里是靠"有没有 `id` 字段"来区分的。
你如果自己写脚本遍历这个目录，记得跳过 `triples.json`。


## 七、自己加一个工具

工具用的是注册表模式，加一个工具只要改两处，
不需要动协议层。

第一步，在 `memory_store.py` 里写你的逻辑函数。比如加一个统计：

```python
def count_by_confidence(layer: str) -> dict:
    items = list_items(layer)
    buckets = {"高": 0, "中": 0, "低": 0}
    for it in items:
        c = it.get("confidence", 0)
        buckets["高" if c >= 85 else "中" if c >= 60 else "低"] += 1
    return {"layer": layer, "buckets": buckets}
```

第二步，在 `server.py` 的 `TOOLS` 字典里加一项。
格式是：工具名、说明、参数定义、必填参数、处理函数。

```python
"count_by_confidence": _tool(
    "count_by_confidence", "按置信度分档统计条目数",
    {"layer": {"type": "string", "enum": list(LAYERS)}},
    ["layer"], count_by_confidence),
```

第三步，重启服务（客户端重载一下就行）。

就这样。函数名和参数名要对上，因为服务端是把
`arguments` 里的字段直接当关键字参数传进去的：

```python
tool["handler"](**args)
```

所以参数名写错了会直接报 `TypeError`，调试时看到这个
错误就往这里想。

写处理函数时有两条建议：

1. 拿不准的情况抛异常就行，服务端会把它转成 `isError` 文本，
   连接不会断。不需要自己 try/except 包一层。

2. 返回值能 JSON 序列化就行。复杂结构（嵌套字典、列表）
   都没问题。别返回自定义对象。

另外，如果你要加的是"读文件"之类的工具，
注意 `_guard_root()` 这个函数。它负责拦截对三个根文件夹
的删除和越界路径访问，涉及路径的地方建议过一遍。


## 八、已知边界

这些是当前版本的实际情况，用之前心里有数：

1. 没有鉴权。因为它是本机 stdio 进程，只有能启动进程的人
   才能碰它，风险不大。但如果哪天你要把它改成 HTTP 远程服务，
   必须自己补 Token 鉴权，现在完全没有。

2. 没有并发写锁。正常情况下一个 AI 在用，没影响。
   如果你挂了多个客户端，而且恰好同一秒往同一条记忆写，
   理论上可能互相覆盖。要解决得加文件锁。

3. 中文分词是自己写的，切法是"中文单字 + 双字"。
   好处是零依赖，坏处是召回率不如 jieba，低相关度的
   结果里会有噪声。够用，但不是最好。

4. 三个根文件夹的"不可删除"是程序级保护，不是文件系统级。
   如果数据盘是 exfat，连 chmod / chattr 都不起作用，
   所以手动用文件管理器删是删得掉的（下次启动会重建，内容会丢）。
   想彻底防住只能靠备份。

5. `protocolVersion` 是回显客户端传进来的值，没有做版本协商校验。
   也就是说客户端说自己是哪个版本，服务端就认哪个。
   实际用下来没什么问题，因为用到的方法都很基础。

6. 目前只在 Trae 上做过真机接入测试。
   Cursor、Claude Code、CodeBuddy 的配置都给了，
   但没实地跑过，不排除有细节要调。


## 九、版本信息

- 服务名 `mindbox-memory`
- 版本 `1.0.0测试版`
- 工具数 9
- `protocolVersion` `2025-06-18`
- 传输 stdio，换行分隔的 JSON-RPC 2.0
- 依赖 无（Python 3 标准库）
- 记忆根目录 就是本项目所在目录

开发过程中的工具精简：
删掉了 8 个工具（`session_read` / `session_append` /
`session_list` / `memory_list` / `memory_get` / `memory_hit` /
`memory_promote` / `report_error`），
同时清掉了它们对应的死代码和条目里的
`refs` / `success` / `fail` 三个字段。
删掉的理由见 [使用说明-人.md](使用说明-人.md) 的 FAQ 一节。


## 十、一句话总结

协议很薄，工具很少，数据很土（就是文件）。
薄和少是为了不坏，土是为了你能随时接手。

有 bug 或者想加工具，直接改两个 .py 文件就行，
没有构建流程，没有依赖需要升级。
