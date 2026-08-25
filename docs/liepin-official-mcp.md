# 猎聘官方 MCP / CLI 配置说明（本仓库本地笔记）

## 官方入口
- 授权页：https://www.liepin.com/mcp/auth （或 https://www.liepin.com/mcp/server）
- Remote MCP：`https://open-agent.liepin.com/mcp/user`
- 鉴权头：`x-user-token: <token>`
- 官方 CLI 仓库：https://github.com/liepin-tech-2026/liepin-cil （文档中亦写作 liepin-cli）

## Cursor mcp.json 模板（仅职位搜索；勿配置简历/投递自动化）

将下面片段合并进 `%USERPROFILE%\.cursor\mcp.json`，**先完成授权拿到 token 再填入**：

```json
{
  "mcpServers": {
    "liepin-mcp": {
      "url": "https://open-agent.liepin.com/mcp/user",
      "headers": {
        "x-user-token": "PASTE_TOKEN_HERE"
      }
    }
  }
}
```

## 职位搜索分页（官方已提供）
- 工具：`user-search-job`
- 字段：`page`（number）
- 约定：**0 = 第 1 页**；不传则默认 0
- **无 cursor**；本仓库多页采集映射为 human page N → MCP `page = N-1`

## 允许 / 禁止
- **允许**：job search（职位搜索）
- **禁止**：resume get/update、job apply、发送消息

## CLI（可选）
```bash
cd <liepin-cli-repo>
python -m venv .venv
.\.venv\Scripts\activate
pip install -e .
liepin-cli setup          # 交互粘贴 token（须人工）
liepin-cli job search --job-name "用户研究" --address "北京" --page 1 --output json
```
