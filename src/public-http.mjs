import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { publicNetworkAddress } from "./public-image-probe.mjs";
import { ValidationError } from "./verification.mjs";
const fail = (s, status = 400) => {
  throw new ValidationError(s, status);
};
export function publicEndpoint(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    fail("请输入有效的 HTTPS 服务地址");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.hash ||
    u.search ||
    (u.port && u.port !== "443") ||
    !u.hostname.includes(".") ||
    /\.(?:local|internal|localhost)$/i.test(u.hostname)
  )
    fail("服务地址必须是公网 HTTPS，不能包含凭据、查询参数或内网端口");
  return u;
}
export function publicResource(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    fail("请输入有效的公开链接");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    fail("仅支持无内嵌凭据的 HTTPS 公开链接");
  u.hash = "";
  return u;
}
/** DNS is validated at connection time and pinned for the TLS request. */
export async function publicRequest(
  input,
  {
    method = "GET",
    headers = {},
    body,
    timeout = 60000,
    maxBytes = 12_000_000,
    resolve = lookup,
    transport = httpsRequest,
  } = {}
) {
  const url = input instanceof URL ? input : new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    fail("仅允许 HTTPS 公网请求");
  let deadline;
  const addresses = await Promise.race([
    resolve(url.hostname, { all: true, verbatim: true }),
    new Promise((_, reject) => {
      deadline = setTimeout(
        () => reject(new ValidationError("DNS 查询超时", 502)),
        2500
      );
    }),
  ]).finally(() => clearTimeout(deadline));
  if (
    !addresses.length ||
    addresses.length > 32 ||
    addresses.some((a) => !publicNetworkAddress(a.address))
  )
    fail("服务地址解析到了非公网地址", 403);
  const address = addresses[0];
  return new Promise((done, reject) => {
    let finished = false,
      timer;
    const end = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      error ? reject(error) : done(value);
    };
    const req = transport(
      url,
      {
        method,
        headers,
        rejectUnauthorized: true,
        servername: url.hostname,
        lookup: (_h, opts, cb) =>
          typeof opts === "object" && opts.all
            ? cb(null, [address])
            : cb(null, address.address, address.family),
      },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400) {
          response.destroy();
          end(new ValidationError("不跟随服务重定向", 502));
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            response.destroy();
            req.destroy();
            end(new ValidationError("服务响应过大", 502));
          } else chunks.push(chunk);
        });
        response.on("end", () =>
          end(
            null,
            new Response(
              [204, 205, 304].includes(response.statusCode)
                ? null
                : Buffer.concat(chunks),
              { status: response.statusCode, headers: response.headers }
            )
          )
        );
        response.on("error", () =>
          end(new ValidationError("服务响应中断", 502))
        );
      }
    );
    timer = setTimeout(() => {
      req.destroy();
      end(new ValidationError("服务请求超时，结果可能尚待核实", 504));
    }, timeout);
    req.on("error", () =>
      end(new ValidationError("无法连接服务，结果可能尚待核实", 502))
    );
    if (body) req.write(body);
    req.end();
  });
}

/** Same pinned public DNS/TLS boundary, with bounded backpressure for SSE. */
export async function publicRequestStream(
  input,
  {
    method = "POST",
    headers = {},
    body,
    timeout = 60000,
    maxBytes = 1500000,
    signal,
    resolve = lookup,
    transport = httpsRequest,
  } = {}
) {
  const url = input instanceof URL ? input : new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    fail("仅允许 HTTPS 公网请求");
  if (signal?.aborted) throw new ValidationError("请求已取消", 499);
  let dnsTimer;
  const addresses = await Promise.race([
    resolve(url.hostname, { all: true, verbatim: true }),
    new Promise((_, reject) => {
      dnsTimer = setTimeout(
        () => reject(new ValidationError("DNS 查询超时", 502)),
        2500
      );
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (
    !addresses.length ||
    addresses.length > 32 ||
    addresses.some((a) => !publicNetworkAddress(a.address))
  )
    fail("服务地址解析到了非公网地址", 403);
  if (signal?.aborted) throw new ValidationError("请求已取消", 499);
  const address = addresses[0];
  return new Promise((resolveResponse, reject) => {
    let req;
    let controller,
      response,
      finished = false,
      timer,
      bytes = 0;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const stop = (error) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) {
        if (controller) controller.error(error);
        else reject(error);
      } else controller?.close();
    };
    const abort = () => {
      stop(new ValidationError("请求已取消，费用可能待核实", 499));
      response?.destroy();
      req?.destroy();
    };
    req = transport(
      url,
      {
        method,
        headers,
        rejectUnauthorized: true,
        servername: url.hostname,
        lookup: (_h, opts, cb) =>
          typeof opts === "object" && opts.all
            ? cb(null, [address])
            : cb(null, address.address, address.family),
      },
      (incoming) => {
        response = incoming;
        if (incoming.statusCode >= 300 && incoming.statusCode < 400) {
          stop(new ValidationError("不跟随服务重定向", 502));
          incoming.destroy();
          req?.destroy();
          return;
        }
        incoming.pause();
        const stream = new ReadableStream({
          start(c) {
            controller = c;
          },
          pull() {
            incoming.resume();
          },
          cancel() {
            if (!finished) {
              finished = true;
              cleanup();
            }
            incoming.destroy();
            req.destroy();
          },
        });
        incoming.on("data", (chunk) => {
          if (finished) return;
          bytes += chunk.length;
          if (bytes > maxBytes) {
            stop(new ValidationError("服务响应过大", 502));
            incoming.destroy();
            req.destroy();
            return;
          }
          controller.enqueue(new Uint8Array(chunk));
          if (controller.desiredSize <= 0) incoming.pause();
        });
        incoming.on("end", () => stop());
        incoming.on("error", () =>
          stop(new ValidationError("服务响应中断", 502))
        );
        incoming.on("aborted", () =>
          stop(new ValidationError("服务响应中断", 502))
        );
        if ([204, 205, 304].includes(incoming.statusCode)) incoming.resume();
        resolveResponse(
          new Response(
            [204, 205, 304].includes(incoming.statusCode) ? null : stream,
            { status: incoming.statusCode, headers: incoming.headers }
          )
        );
      }
    );
    if (finished) {
      req.destroy();
      return;
    }
    timer = setTimeout(() => {
      stop(new ValidationError("服务请求超时，结果可能尚待核实", 504));
      response?.destroy();
      req.destroy();
    }, timeout);
    signal?.addEventListener("abort", abort, { once: true });
    req.on("error", () =>
      stop(new ValidationError("无法连接服务，结果可能尚待核实", 502))
    );
    if (signal?.aborted) {
      abort();
      return;
    }
    if (body) req.write(body);
    req.end();
  });
}
