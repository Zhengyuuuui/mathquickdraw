# react-demo — agent notes

数学手写答题白板。每页一个独立 URL（`/<11位短码>`），公式在画布左侧独立栏（KaTeX 渲染），整张纸都可写。

## 本地起服务

```bash
npm run dev:api        # Cloudflare Worker + D1，http://127.0.0.1:8790（apps/api/.dev.vars 里有本地 token）
npm run dev            # Vite 前端，http://localhost:5173
```

首次需先应用 D1 迁移：`cd apps/api && npx wrangler d1 migrations apply DB --local`

## Agent 主路径：HTTP API，不是 DOM

建页 / 写公式 / 改名 / 删页，全部走 API。DOM 选择器只是浏览器自动化的兜底。

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
| `board-canvas` | Quickdraw 宿主 div |
| `page-formula-input` | 公式 LaTeX 输入框（Enter/失焦提交，Esc 还原） |
| `page-formula-display` | 公式渲染区（KaTeX） |
| `page-name-input` | 页面名输入框 |
| `page-style-trigger` | 纸张样式胶囊（弹层选择） |
| `page-back-home` | 返回首页 |
| `toolbar-undo` / `toolbar-redo` / `toolbar-clear` | 工具栏撤销 / 重做 / 清空 |
| `page-not-found` / `page-not-found-home` | 深链 404 提示 / 其「返回首页」按钮 |

## 约定

- 路由只有两条：`/`（首页）与 `/<页面 id>`。旧 `p_<uuid>` 与新 11 位短码都能路由，不要假设 id 格式。
- 公式是纸外一栏（方案 B）：`PageFrame` / `usePageBoundary` 不管公式；整张纸都可写。
- AI 出题默认走 `MockAIAdapter`（无网络）；`DoubaoAdapter` 是未接入的桩。
- `packages/core`、`packages/react` 是 Quickdraw 引擎，零改动。
