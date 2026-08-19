---
name: figma-use
description: "Gate and operating procedure for tasks that need the optional local Figma MCP server."
---

# Figma use

Use this skill whenever a task requires Figma nodes, screenshots, variables, styles, or assets.

1. Confirm the `figma` MCP server is enabled and reachable at its configured host endpoint.
2. If it is disabled or unreachable, stop before writing design-derived code and report: `Figma MCP is unavailable. Enable mcp_servers.figma in .codex/config.toml, start the local Figma MCP server, then retry.`
3. Request the exact node. If the response is truncated, get metadata and refetch only required children.
4. Obtain both structured design context and a screenshot before implementation.
5. Use returned assets as evidence; never invent placeholders for assets the server exposes.
6. Keep Figma reads bounded to the nodes required by the task.
