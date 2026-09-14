# react-demo — agent notes

数学手写答题白板。每页一个独立 URL（`/<11位短码>`），公式在画布左侧独立栏（KaTeX 渲染），整张纸都可写。

## 本地起服务

```bash
npm run dev:api        # Cloudflare Worker + D1，http://127.0.0.1:8790（apps/api/.dev.vars 里有本地 token）
npm run dev            # Vite 前端，http://localhost:5173
```

首次需先应用 D1 迁移：`cd apps/api && npx wrangler d1 migrations apply DB --local`

## Agent 主路径：读 agent-context + PATCH API，不必驱动 DOM

页面里有一个机器可读的上下文岛，一次查询拿到全部信息：

```js
JSON.parse(document.querySelector('#agent-context').textContent)
// { phase, pageId, pageUrl, latex, apiBase, submissionPng, systemPrompt }
```

**它不含 token** —— 提示词会被截图，token 由用户在「页面设置」里生成后单独交给 agent。

建页 / 写公式 / 改名 / 删页，全部走 API。DOM 选择器只是浏览器自动化的兜底。

所有请求带鉴权头，二选一：

- `X-App-Token` —— 全局 token，全权限。本地在 `apps/api/.dev.vars`。
- `X-Page-Token` —— 每页 token，**只能读本页、只能写本页的 grading**。

### 阶段状态机

```
empty        无公式
   ↓  agent 出题 / 手填
ready        有公式，可写
   ↓  提交（前端渲染快照并上传）
submitted    已冻结，等批改
   ↓  agent PATCH grading
graded       有批改结果（仍冻结）
   ↓  学生点「继续作答」
ready        解冻（仅本次会话；刷新后回到 submitted）
```

纯派生，不落库：

```
phase = !formula ? 'empty' : !submittedAt ? 'ready' : !grading ? 'submitted' : 'graded'
```

### 每页 Token

```bash
curl -s -X POST http://127.0.0.1:8790/api/pages/<id>/token -H "X-App-Token: <全局token>"
# → { "token": "qd1.<pageId>.<jti>.<sig>", "jti": "…" }

curl -s http://127.0.0.1:8790/api/pages/<id>/token -H "X-App-Token: <全局token>"
# → 同一个 token（可反复取回）；从未签发过 → 404

curl -s -X DELETE http://127.0.0.1:8790/api/pages/<id>/token -H "X-App-Token: <全局token>"   # 作废
```

Token 形如 `qd1.<pageId>.<jti>.<sig>`（约 76 字符，不是 JWT）：签名只覆盖 `pageId` 与 `jti`，
所以同一对输入永远导出同一个串 —— 可随时取回，不必「只显示一次」。**没有过期时间**，
生命周期由作废控制：清空该页的 `token_jti`，之前签发的全部立即失效。


每页 token 能做：`GET /api/pages/:id`、`GET /api/pages/:id/submission.png`、`PATCH /api/pages/:id` **且 body 里只能有 `grading`**。
不能：删页、建页、改名/公式/样式/快照、上传快照、签发或作废 token、访问其它页。
带越权字段 → `403 FORBIDDEN`；token 无效/过期/已作废/页面不匹配 → `401 INVALID_PAGE_TOKEN`。

### 提交快照

```bash
curl -s -X POST http://127.0.0.1:8790/api/pages/<id>/submission \
  -H "X-App-Token: <全局token>" -F "image=@sheet.png;type=image/png"
# → { "submittedAt": 1726000000000 }   同时把 grading 置空（旧反馈作废）

curl -s -o sheet.png http://127.0.0.1:8790/api/pages/<id>/submission.png -H "X-Page-Token: <每页token>"
# 无快照 → 404。>6MB → 413
```

### 写批改（PATCH，`grading` 传 null 表示清除）

```bash
curl -s -X PATCH http://127.0.0.1:8790/api/pages/<id> \
  -H "X-Page-Token: <每页token>" -H "Content-Type: application/json" \
  -d '{
    "grading": {
      "readable": true,
      "overall": "correct",
      "transcription": "…",
      "firstError": null,
      "correctSolution": "…",
      "teacherComment": "…"
    }
  }'
```

`overall` ∈ `correct | incorrect | partial | unreadable`。服务端会归一化：非法枚举值在 `readable=false` 时落 `unreadable`、否则落 `incorrect`；`gradedAt` 一律用服务端时钟；三个长文本各截断到 8000 字符。


所有请求带 `X-App-Token` 头。本地 token 在 `apps/api/.dev.vars`（`APP_TOKEN=change-me`），前端自己的 token 在 `examples/react-demo/.env.local`（`VITE_APP_TOKEN`），两者要与 `VITE_API_BASE_URL` 指向的实例一致。

API base：`http://127.0.0.1:8790`（前端默认；`VITE_API_BASE_URL` 可覆盖）。

### 建页（可带公式）

```bash
curl -s -X POST http://127.0.0.1:8790/api/pages \
  -H "X-App-Token: change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "函数极限",
    "style": { "theme": "light", "grid": "ruled", "size": { "preset": "a4", "w": 794, "h": 1123 } },
    "formula": "\\displaystyle\\lim_{x\\to 0}\\frac{\\sin x}{x}=1"
  }'
```

返回 `201` 与页面元数据（`id` 即 URL 短码，`/api/pages/<id>` 同形）。`style` 可整个省略（缺省 `{theme:'light', grid:'ruled'}` 无边界）；`size` 用自定义值时 `w`/`h` 必填（200–8000px）。

### 写 / 清公式（PATCH，传 null 表示清空）

```bash
curl -s -X PATCH http://127.0.0.1:8790/api/pages/<id> \
  -H "X-App-Token: change-me" \
  -H "Content-Type: application/json" \
  -d '{ "formula": "x^2+y^2=z^2" }'

curl -s -X PATCH http://127.0.0.1:8790/api/pages/<id> \
  -H "X-App-Token: change-me" \
  -H "Content-Type: application/json" \
  -d '{ "formula": null }'
```

公式约束：`string | null`，最长 8000 字符（超限 400 BAD_REQUEST），纯空白归一化为 `null`。内容是 KaTeX 源码，服务端不转义不改写。

### 其它

```bash
curl -s http://127.0.0.1:8790/api/pages -H "X-App-Token: change-me"          # 列表（元数据含 formula）
curl -s http://127.0.0.1:8790/api/pages/<id> -H "X-App-Token: change-me"     # 详情（含 snapshot）
curl -s -X DELETE http://127.0.0.1:8790/api/pages/<id> -H "X-App-Token: change-me"
```

## DOM 选择器（兜底，优先用上面的 API）

| testid | 元素 |
|---|---|
| `home-new-page` | 首页「新建页面」按钮 |
| `ai-prompt-input` | 首页 AI 出题输入框 |
| `ai-generate` | 首页「AI 出题并新建」按钮 |
| `page-card` | 页面卡片（带 `data-page-id`） |
| `page-card-open` / `page-card-delete` | 卡片的打开 / 删除按钮 |
| `home-multi-select` | 首页「多选」开关（`aria-pressed` 表示是否进入多选） |
| `page-card-select` | 多选模式下卡片的选择按钮（替代 `page-card-open`） |
| `select-count` / `select-all` / `select-cancel` / `select-delete` | 多选操作条：已选计数 / 全选 / 取消 / 批量删除 |
| `board-canvas` | Quickdraw 宿主 div |
| `page-formula-input` | 公式 LaTeX 输入框（Enter/失焦提交，Esc 还原）；提交后只读 |
| `page-formula-display` | 公式渲染区（KaTeX） |
| `solution-input` | 「答案」tab 下的参考解法输入框（Enter/失焦提交，Esc 还原）；写回 `grading.correctSolution` |
| `page-name-input` | 页面名输入框 |
| `page-style-trigger` | 纸张样式胶囊（弹层选择） |
| `page-back-home` | 返回首页 |
| `toolbar-undo` / `toolbar-redo` / `toolbar-clear` | 工具栏撤销 / 重做 / 清空 |
| `page-not-found` / `page-not-found-home` | 深链 404 提示 / 其「返回首页」按钮 |
| `grade-submit` / `grade-continue` | 「提交批改」/「继续作答」 |
| `grade-preview-image` / `grade-preview-confirm` / `grade-preview-cancel` | 提交预览弹窗的图 / 确认 / 取消 |
| `grade-result` / `grade-overall` / `grade-transcription` / `grade-first-error` | 批改结果块 / 结论徽章 / 转写 / 第一个错误 |
| `tab-question` / `tab-answer` | 「题目」/「答案」两个独立视图（后者在 empty/ready 时禁用） |
| `answer-view` | 「答案」tab 的内容区。两个 tab 共用 `.formula-view` / `.formula-editor` 骨架，靠这个 testid 区分 |
| `board-snapshot` | 冻结后盖在画布上的快照 `<img>` |
| `page-settings-trigger` / `page-settings` | 顶栏齿轮 / 设置弹窗 |
| `token-generate` / `token-revoke` / `token-value` | 生成 token / 作废 token / 当前 token 值（长期可取回） |
| `agent-prompt` / `agent-copy` / `agent-panel-idle` | 当前阶段的指令文本 / 复制按钮 / 无需介入时的提示 |
| `agent-context` | `<script type="application/json">` 机器可读上下文（见上） |
| `dev-mock-grade` | **仅 `vite dev`**：不经 agent 直接写入一份批改结果 |

## 约定

- 路由只有两条：`/`（首页）与 `/<页面 id>`。旧 `p_<uuid>` 与新 11 位短码都能路由，不要假设 id 格式。
- 公式是纸外一栏（方案 B）：`PageFrame` / `usePageBoundary` 不管公式；整张纸都可写。
- **提交后画布与题目一起冻结**：`<Quickdraw readonly>` + 公式 textarea `readOnly`，并用上传的那张 PNG 盖住 canvas（`object-fit: contain`）。学生看到的 = agent 看到的，与视口/DPR/平移无关。「继续作答」只在本地解锁，刷新后回到 submitted —— 快照是历史，不删。题目跟着一起锁，是因为改了题就等于让批改结果对不上它批的那道题。
- AI 出题默认走 `MockAIAdapter`（无网络）；`DoubaoAdapter` 是未接入的桩。**前端从不调用批改模型**，批改由外部 agent 完成。
- `packages/core`、`packages/react` 是 Quickdraw 引擎，零改动。

### 改参考解法

「答案」tab 下有一个 textarea，直接改 `grading.correctSolution`。整份 grading 是一列 JSON，
所以这里是把整个对象回写（其余字段原样带回），而不是单独更新某个字段：

```bash
# 先 GET 拿到完整 grading，改掉 correctSolution 再 PATCH 回去
curl -s -X PATCH http://127.0.0.1:8790/api/pages/<id> \
  -H "X-App-Token: <全局token>" -H "Content-Type: application/json" \
  -d '{ "grading": { ...完整 grading，correctSolution 换成新的... } }'
```
