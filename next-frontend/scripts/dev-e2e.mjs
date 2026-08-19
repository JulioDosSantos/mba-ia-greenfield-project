import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"

const host = "127.0.0.1"
const port = Number(process.env.E2E_UPSTREAM_PORT ?? 3002)

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}

function errorEnvelope(statusCode, error, message) {
  return { statusCode, error, message, code: null }
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

const upstream = createServer(async (request, response) => {
  if (request.method !== "POST") {
    response.writeHead(404).end()
    return
  }

  try {
    const body = await readJson(request)
    const email = typeof body.email === "string" ? body.email : ""

    if (request.url === "/auth/register") {
      if (email === "conflict@example.com") {
        sendJson(
          response,
          409,
          errorEnvelope(409, "EMAIL_ALREADY_REGISTERED", "Email already registered")
        )
        return
      }
      if (email === "badrequest@example.com") {
        sendJson(
          response,
          400,
          errorEnvelope(400, "VALIDATION_FAILED", "Validation failed")
        )
        return
      }
      sendJson(response, 201, { id: "user-fixture-id", email })
      return
    }

    if (request.url === "/auth/login") {
      if (email === "badrequest@example.com") {
        sendJson(
          response,
          400,
          errorEnvelope(400, "VALIDATION_FAILED", "Validation failed")
        )
        return
      }
      if (email === "invalid@example.com") {
        sendJson(
          response,
          401,
          errorEnvelope(401, "INVALID_CREDENTIALS", "Invalid email or password")
        )
        return
      }
      if (email === "unconfirmed@example.com") {
        sendJson(
          response,
          403,
          errorEnvelope(403, "EMAIL_NOT_CONFIRMED", "Email not confirmed")
        )
        return
      }
      sendJson(response, 200, {
        access_token: "fixture-access-token",
        refresh_token: "fixture-refresh-token",
      })
      return
    }

    if (request.url === "/auth/forgot-password") {
      if (email === "badrequest@example.com") {
        sendJson(
          response,
          400,
          errorEnvelope(400, "VALIDATION_FAILED", "Validation failed")
        )
        return
      }
      response.writeHead(204).end()
      return
    }

    if (request.url === "/auth/logout") {
      response.writeHead(204).end()
      return
    }

    if (request.url === "/auth/refresh") {
      sendJson(response, 200, {
        access_token: "new-fixture-access-token",
        refresh_token: "new-fixture-refresh-token",
      })
      return
    }

    response.writeHead(404).end()
  } catch {
    sendJson(response, 400, errorEnvelope(400, "INVALID_JSON", "Invalid JSON"))
  }
})

upstream.listen(port, host, () => {
  const nextBin = fileURLToPath(
    new URL("../node_modules/next/dist/bin/next", import.meta.url)
  )
  const next = spawn(
    process.execPath,
    [nextBin, "dev", "--webpack", ...process.argv.slice(2)],
    {
      env: {
        ...process.env,
        API_URL: `http://${host}:${port}`,
      },
      stdio: "inherit",
    }
  )

  let closing = false
  const close = (signal) => {
    if (closing) return
    closing = true
    next.kill(signal)
    upstream.close()
  }

  process.once("SIGINT", () => close("SIGINT"))
  process.once("SIGTERM", () => close("SIGTERM"))
  next.once("exit", (code, signal) => {
    upstream.close(() => {
      if (signal) process.kill(process.pid, signal)
      else process.exit(code ?? 1)
    })
  })
})

upstream.on("error", (error) => {
  console.error("Unable to start the E2E upstream fixture:", error)
  process.exit(1)
})
