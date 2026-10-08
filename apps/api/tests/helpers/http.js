// Lightweight mock Express req/res/next, used to unit-test middleware and
// controllers directly without spinning up a full HTTP server (matching the
// existing test suite's style: direct calls against real Mongo models via
// mongodb-memory-server, no supertest).

export function makeReq(overrides = {}) {
  return {
    headers: {},
    params: {},
    query: {},
    body: {},
    ip: "127.0.0.1",
    ...overrides,
  };
}

export function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

// Runs an Express-style middleware `(req, res, next) => ...` and resolves
// with either { threw: Error } or { threw: null } once `next` is called or
// the middleware throws synchronously/asynchronously.
export function runMiddleware(middleware, req, res) {
  return new Promise((resolve) => {
    try {
      const maybePromise = middleware(req, res, (err) => {
        resolve({ threw: err || null });
      });
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(
          () => resolve({ threw: null }),
          (err) => resolve({ threw: err })
        );
      }
    } catch (err) {
      resolve({ threw: err });
    }
  });
}

// Runs an asyncHandler-wrapped controller `(req, res, next) => Promise`.
// asyncHandler itself never returns the inner promise (it fires-and-forgets
// with `.catch(next)`), so we resolve off of whichever happens first:
// res.json(...) being called (success) or next(err) being called (failure).
export function runController(controller, req, res) {
  return new Promise((resolve) => {
    const originalJson = res.json;
    res.json = (payload) => {
      res.body = payload;
      originalJson(payload);
      resolve({ res, error: null });
      return res;
    };
    const next = (err) => {
      if (err) resolve({ res, error: err });
    };
    controller(req, res, next);
  });
}