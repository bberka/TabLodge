// Generated from server/src by server/scripts/cloudflare-deploy.ts. Do not edit; see README.md to update.
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.ts
import { DurableObject } from "cloudflare:workers";

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/http-exception.js
var HTTPException = class extends Error {
  static {
    __name(this, "HTTPException");
  }
  res;
  status;
  /**
  * Creates an instance of `HTTPException`.
  * @param status - HTTP status code for the exception. Defaults to 500.
  * @param options - Additional options for the exception.
  */
  constructor(status = 500, options) {
    super(options?.message, { cause: options?.cause });
    this.res = options?.res;
    this.status = status;
  }
  /**
  * Returns the response object associated with the exception.
  * If a response object is not provided, a new response is created with the error message and status code.
  * @returns The response object.
  */
  getResponse() {
    if (this.res) return new Response(this.res.body, {
      status: this.status,
      headers: this.res.headers
    });
    return new Response(this.message, { status: this.status });
  }
};

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/utils/crypto.js
var sha256 = /* @__PURE__ */ __name(async (data) => {
  return await createHash(data, {
    name: "SHA-256",
    alias: "sha256"
  });
}, "sha256");
var createHash = /* @__PURE__ */ __name(async (data, algorithm) => {
  let sourceBuffer;
  if (ArrayBuffer.isView(data) || data instanceof ArrayBuffer) sourceBuffer = data;
  else {
    if (typeof data === "object") data = JSON.stringify(data);
    sourceBuffer = new TextEncoder().encode(String(data));
  }
  if (crypto && crypto.subtle) {
    const buffer = await crypto.subtle.digest({ name: algorithm.name }, sourceBuffer);
    return Array.prototype.map.call(new Uint8Array(buffer), (x) => ("00" + x.toString(16)).slice(-2)).join("");
  }
  return null;
}, "createHash");

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/utils/buffer.js
var constantTimeEqualString = /* @__PURE__ */ __name((a, b) => {
  const aLen = a.length;
  const bLen = b.length;
  const maxLen = Math.max(aLen, bLen);
  let out = aLen ^ bLen;
  for (let i = 0; i < maxLen; i++) {
    const aChar = i < aLen ? a.charCodeAt(i) : 0;
    const bChar = i < bLen ? b.charCodeAt(i) : 0;
    out |= aChar ^ bChar;
  }
  return out === 0;
}, "constantTimeEqualString");
var timingSafeEqualString = /* @__PURE__ */ __name(async (a, b, hashFunction) => {
  if (!hashFunction) hashFunction = sha256;
  const [sa, sb] = await Promise.all([hashFunction(a), hashFunction(b)]);
  if (sa == null || sb == null || typeof sa !== "string" || typeof sb !== "string") return false;
  const hashEqual = constantTimeEqualString(sa, sb);
  const originalEqual = constantTimeEqualString(a, b);
  return hashEqual && originalEqual;
}, "timingSafeEqualString");
var timingSafeEqual = /* @__PURE__ */ __name(async (a, b, hashFunction) => {
  if (typeof a === "string" && typeof b === "string") return timingSafeEqualString(a, b, hashFunction);
  if (!hashFunction) hashFunction = sha256;
  const [sa, sb] = await Promise.all([hashFunction(a), hashFunction(b)]);
  if (!sa || !sb || typeof sa !== "string" || typeof sb !== "string") return false;
  return timingSafeEqualString(sa, sb);
}, "timingSafeEqual");
var bufferToFormData = /* @__PURE__ */ __name((arrayBuffer, contentType) => {
  return new Response(arrayBuffer, { headers: { "Content-Type": contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase()) } }).formData();
}, "bufferToFormData");

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/utils/body.js
var MAX_NESTED_OBJECTS = 1e4;
var isRawRequest = /* @__PURE__ */ __name((request) => "headers" in request, "isRawRequest");
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const mediaType = (isRawRequest(request) ? request.headers : request.raw.headers).get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded") return parseFormData(request, {
    all,
    dot
  });
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  if (!isRawRequest(request) && request.bodyCache.formData) return convertFormDataToBodyData(await request.bodyCache.formData, options);
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const arrayBuffer = await request.arrayBuffer();
  const formDataPromise = bufferToFormData(arrayBuffer, headers.get("Content-Type") || "");
  if (!isRawRequest(request)) request.bodyCache.formData = formDataPromise;
  const formData = await formDataPromise;
  if (formData) return convertFormDataToBodyData(formData, options);
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  const nestingState = { count: 0 };
  formData.forEach((value, key) => {
    if (!(options.all || key.endsWith("[]"))) form[key] = value;
    else handleParsingAllValues(form, key, value);
  });
  if (options.dot) Object.entries(form).forEach(([key, value]) => {
    if (key.includes(".")) {
      handleParsingNestedValues(form, key, value, nestingState);
      delete form[key];
    }
  });
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) form[key].push(value);
    else form[key] = [form[key], value];
  } else if (!key.endsWith("[]")) form[key] = value;
  else form[key] = [value];
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value, state) => {
  if (/(?:^|\.)__proto__\./.test(key)) return;
  let nestedForm = form;
  const keys = key.split(".", 34);
  if (keys.length > 33) throwNestingLimitExceeded();
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) nestedForm[key2] = value;
    else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        if (state.count++ >= MAX_NESTED_OBJECTS) throwNestingLimitExceeded();
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");
var throwNestingLimitExceeded = /* @__PURE__ */ __name(() => {
  throw new Error("Nesting limit exceeded");
}, "throwNestingLimitExceeded");

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/utils/url.js
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") paths.shift();
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return {
    groups,
    path
  };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) if (paths[j].includes(mark)) {
      paths[j] = paths[j].replace(mark, groups[i][1]);
      break;
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") return "*";
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [
        cacheKey,
        match2[1],
        new RegExp(`^${match2[2]}(?=/${next})`)
      ] : [
        label,
        match2[1],
        new RegExp(`^${match2[2]}$`)
      ];
      else patternCache[cacheKey] = [
        label,
        match2[1],
        true
      ];
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) break;
  }
  return url.slice(start, i);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var stripPathPrefix = /* @__PURE__ */ __name((rawPath, decodedPath, prefixLength) => {
  if (rawPath.at(-1) === "/" && decodedPath.at(-1) !== "/") rawPath = rawPath.slice(0, -1);
  let index = 0;
  for (let i = decodedPath.indexOf("/"); i !== -1 && i < prefixLength; i = decodedPath.indexOf("/", i + 1)) {
    index = rawPath.indexOf("/", index + 1);
    if (index === -1) return "/";
  }
  return rawPath.slice(index) || "/";
}, "stripPathPrefix");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) sub = mergePath(sub, ...rest);
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) return null;
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) basePath += "/" + segment;
    else if (/\:/.test(segment)) {
      if (segment.charCodeAt(segment.length - 1) === 63) {
        if (results.length === 0 && basePath === "") results.push("/");
        else results.push(basePath);
        const optionalSegment = segment.slice(0, -1);
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else basePath += "/" + segment;
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => str.indexOf("%") !== -1 ? tryDecode(str, decodeURIComponent_) : str, "tryDecodeURIComponent");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (value.indexOf("+") !== -1) value = value.replace(/\+/g, " ");
  return tryDecodeURIComponent(value);
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  const hashIndex = url.indexOf("#", 8);
  if (hashIndex !== -1) url = url.slice(0, hashIndex);
  let encoded;
  if (!multiple && key && !/[%+&=]/.test(key)) {
    const queryIndex = url.indexOf("?", 8);
    let keyIndex2 = queryIndex;
    if (keyIndex2 === -1) return;
    if (!url.startsWith(key, keyIndex2 + 1)) keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61 || trailingKeyCode === 38 || isNaN(trailingKeyCode)) {
        if (keyIndex2 > queryIndex && /(?:^|&)[^=&]*[%+]/.test(url.slice(queryIndex + 1, keyIndex2))) break;
        if (trailingKeyCode === 61) {
          const valueIndex = keyIndex2 + key.length + 2;
          const endIndex = url.indexOf("&", valueIndex);
          return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
        }
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) return;
  }
  const results = /* @__PURE__ */ Object.create(null);
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) valueIndex = -1;
    let name = url.slice(keyIndex + 1, valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex);
    if (encoded) name = _decodeURI(name);
    keyIndex = nextKeyIndex;
    if (name === "") continue;
    let value;
    if (valueIndex === -1) value = "";
    else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) value = _decodeURI(value);
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) results[name] = [];
      results[name].push(value);
    } else results[name] ??= value;
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/request.js
var HonoRequest = class {
  static {
    __name(this, "HonoRequest");
  }
  /**
  * `.raw` can get the raw Request object.
  *
  * @see {@link https://hono.dev/docs/api/request#raw}
  *
  * @example
  * ```ts
  * // For Cloudflare Workers
  * app.post('/', async (c) => {
  *   const metadata = c.req.raw.cf?.hostMetadata?
  *   ...
  * })
  * ```
  */
  raw;
  #validatedData;
  #matchResult;
  routeIndex = 0;
  /**
  * `.path` can get the pathname of the request.
  *
  * @see {@link https://hono.dev/docs/api/request#path}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const pathname = c.req.path // `/about/me`
  * })
  * ```
  */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex]?.[1][key];
    const param = this.#getParamValue(paramKey);
    return param && tryDecodeURIComponent(param);
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex]?.[1] ?? {});
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) decoded[key] = tryDecodeURIComponent(value);
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) return this.raw.headers.get(name) ?? void 0;
    const headerData = /* @__PURE__ */ Object.create(null);
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = /* @__PURE__ */ __name((key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) return cachedBody;
    for (const anyCachedKey in bodyCache) return bodyCache[anyCachedKey].then((body) => {
      if (anyCachedKey === "json") body = JSON.stringify(body);
      const contentType = anyCachedKey === "formData" ? void 0 : raw2.headers.get("content-type");
      return new Response(body, { headers: contentType ? { "Content-Type": contentType } : void 0 })[key]();
    });
    return bodyCache[key] = raw2[key]();
  }, "#cachedBody");
  /**
  * `.json()` can parse Request body of type `application/json`
  *
  * @see {@link https://hono.dev/docs/api/request#json}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.json()
  * })
  * ```
  */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
  * `.text()` can parse Request body of type `text/plain`
  *
  * @see {@link https://hono.dev/docs/api/request#text}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.text()
  * })
  * ```
  */
  text() {
    return this.#cachedBody("text");
  }
  /**
  * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
  *
  * @see {@link https://hono.dev/docs/api/request#arraybuffer}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.arrayBuffer()
  * })
  * ```
  */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
  * `.bytes()` parses the request body as a `Uint8Array`.
  *
  * @see {@link https://hono.dev/docs/api/request#bytes}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.bytes()
  * })
  * ```
  */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
  }
  /**
  * Parses the request body as a `Blob`.
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.blob();
  * });
  * ```
  * @see https://hono.dev/docs/api/request#blob
  */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
  * Parses the request body as `FormData`.
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.formData();
  * });
  * ```
  * @see https://hono.dev/docs/api/request#formdata
  */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
  * Adds validated data to the request.
  *
  * @param target - The target of the validation.
  * @param data - The validated data to add.
  */
  addValidatedData(target, data) {
    (this.#validatedData ??= {})[target] = data;
  }
  valid(target) {
    return this.#validatedData?.[target];
  }
  /**
  * `.url` can get the request url strings.
  *
  * @see {@link https://hono.dev/docs/api/request#url}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const url = c.req.url // `http://localhost:8787/about/me`
  *   ...
  * })
  * ```
  */
  get url() {
    return this.raw.url;
  }
  /**
  * `.method` can get the method name of the request.
  *
  * @see {@link https://hono.dev/docs/api/request#method}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const method = c.req.method // `GET`
  * })
  * ```
  */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
  * `.matchedRoutes` can return a matched route in the handler
  *
  * @deprecated
  *
  * Use matchedRoutes helper defined in "hono/route" instead.
  *
  * @see {@link https://hono.dev/docs/api/request#matchedroutes}
  *
  * @example
  * ```ts
  * app.use('*', async function logger(c, next) {
  *   await next()
  *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
  *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
  *     console.log(
  *       method,
  *       ' ',
  *       path,
  *       ' '.repeat(Math.max(10 - path.length, 0)),
  *       name,
  *       i === c.req.routeIndex ? '<- respond from here' : ''
  *     )
  *   })
  * })
  * ```
  */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
  * `.routePath` can retrieve the path registered within the handler
  *
  * @deprecated
  *
  * Use routePath helper defined in "hono/route" instead.
  *
  * @see {@link https://hono.dev/docs/api/request#routepath}
  *
  * @example
  * ```ts
  * app.get('/posts/:id', (c) => {
  *   return c.json({ path: c.req.routePath })
  * })
  * ```
  */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) str = str.toString();
    if (str instanceof Promise) str = await str;
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) return Promise.resolve(str);
  if (buffer) buffer[0] += str;
  else buffer = [str];
  const resStr = Promise.all(callbacks.map((c) => c({
    phase,
    buffer,
    context
  }))).then((res) => Promise.all(res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))).then(() => buffer[0]));
  if (preserveCallbacks) return raw(await resStr, callbacks);
  else return resStr;
}, "resolveCallback");

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var createResponseInstance = /* @__PURE__ */ __name((body, init) => new Response(body, init), "createResponseInstance");
var Context = class {
  static {
    __name(this, "Context");
  }
  #rawRequest;
  #req;
  /**
  * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
  *
  * @see {@link https://hono.dev/docs/api/context#env}
  *
  * @example
  * ```ts
  * // Environment object for Cloudflare Workers
  * app.get('*', async c => {
  *   const counter = c.env.COUNTER
  * })
  * ```
  */
  env = {};
  #var;
  finalized = false;
  /**
  * `.error` can get the error object from the middleware if the Handler throws an error.
  *
  * @see {@link https://hono.dev/docs/api/context#error}
  *
  * @example
  * ```ts
  * app.use('*', async (c, next) => {
  *   await next()
  *   if (c.error) {
  *     // do something...
  *   }
  * })
  * ```
  */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
  * Creates an instance of the Context class.
  *
  * @param req - The Request object.
  * @param options - Optional configuration options for the context.
  */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
  * `.req` is the instance of {@link HonoRequest}.
  */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#event}
  * The FetchEvent associated with the current request.
  *
  * @throws Will throw an error if the context does not have a FetchEvent.
  */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) return this.#executionCtx;
    else throw Error("This context has no FetchEvent");
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#executionctx}
  * The ExecutionContext associated with the current request.
  *
  * @throws Will throw an error if the context does not have an ExecutionContext.
  */
  get executionCtx() {
    if (this.#executionCtx) return this.#executionCtx;
    else throw Error("This context has no ExecutionContext");
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#res}
  * The Response object for the current request.
  */
  get res() {
    return this.#res ||= createResponseInstance(null, { headers: this.#preparedHeaders ??= new Headers() });
  }
  /**
  * Sets the Response object for the current request.
  *
  * @param _res - The Response object to set.
  */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") continue;
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) _res.headers.append("set-cookie", cookie);
        } else _res.headers.set(k, v);
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
  * `.render()` can create a response within a layout.
  *
  * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
  *
  * @example
  * ```ts
  * app.get('/', (c) => {
  *   return c.render('Hello!')
  * })
  * ```
  */
  render = /* @__PURE__ */ __name((...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  }, "render");
  /**
  * Sets the layout for the response.
  *
  * @param layout - The layout to set.
  * @returns The layout function.
  */
  setLayout = /* @__PURE__ */ __name((layout) => this.#layout = layout, "setLayout");
  /**
  * Gets the current layout for the response.
  *
  * @returns The current layout function.
  */
  getLayout = /* @__PURE__ */ __name(() => this.#layout, "getLayout");
  /**
  * `.setRenderer()` can set the layout in the custom middleware.
  *
  * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
  *
  * @example
  * ```tsx
  * app.use('*', async (c, next) => {
  *   c.setRenderer((content) => {
  *     return c.html(
  *       <html>
  *         <body>
  *           <p>{content}</p>
  *         </body>
  *       </html>
  *     )
  *   })
  *   await next()
  * })
  * ```
  */
  setRenderer = /* @__PURE__ */ __name((renderer) => {
    this.#renderer = renderer;
  }, "setRenderer");
  /**
  * `.header()` can set headers.
  *
  * @see {@link https://hono.dev/docs/api/context#header}
  *
  * @example
  * ```ts
  * app.get('/welcome', (c) => {
  *   // Set headers
  *   c.header('X-Message', 'Hello!')
  *   c.header('Content-Type', 'text/plain')
  *
  *   // Append multiple headers using the append option (e.g. Vary)
  *   c.header('Vary', 'Accept-Encoding', { append: true })
  *   c.header('Vary', 'User-Agent', { append: true })
  *
  *   return c.body('Thank you for coming')
  * })
  * ```
  */
  header = /* @__PURE__ */ __name((name, value, options) => {
    if (this.finalized && !this.#res.bodyUsed) this.#res = createResponseInstance(this.#res.body, this.#res);
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) headers.delete(name);
    else if (options?.append) headers.append(name, value);
    else headers.set(name, value);
  }, "header");
  status = /* @__PURE__ */ __name((status) => {
    this.#status = status;
  }, "status");
  /**
  * `.set()` can set the value specified by the key.
  *
  * @see {@link https://hono.dev/docs/api/context#set-get}
  *
  * @example
  * ```ts
  * app.use('*', async (c, next) => {
  *   c.set('message', 'Hono is hot!!')
  *   await next()
  * })
  * ```
  */
  set = /* @__PURE__ */ __name((key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  }, "set");
  /**
  * `.get()` can use the value specified by the key.
  *
  * @see {@link https://hono.dev/docs/api/context#set-get}
  *
  * @example
  * ```ts
  * app.get('/', (c) => {
  *   const message = c.get('message')
  *   return c.text(`The message is "${message}"`)
  * })
  * ```
  */
  get = /* @__PURE__ */ __name((key) => {
    return this.#var ? this.#var.get(key) : void 0;
  }, "get");
  /**
  * `.var` can access the value of a variable.
  *
  * @see {@link https://hono.dev/docs/api/context#var}
  *
  * @example
  * ```ts
  * const result = c.var.client.oneMethod()
  * ```
  */
  get var() {
    if (!this.#var) return {};
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    let responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders;
    if (typeof arg === "object" && arg.headers) {
      responseHeaders ??= new Headers();
      for (const [key, value] of new Headers(arg.headers)) if (key === "set-cookie") responseHeaders.append(key, value);
      else responseHeaders.set(key, value);
    }
    if (headers) {
      if (!responseHeaders) {
        let count = 0;
        for (const k in headers) if (++count > 1 || typeof headers[k] !== "string") {
          responseHeaders = new Headers();
          break;
        }
      }
      if (responseHeaders) for (const k in headers) {
        const v = headers[k];
        if (typeof v === "string") responseHeaders.set(k, v);
        else {
          responseHeaders.delete(k);
          for (const v2 of v) responseHeaders.append(k, v2);
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, {
      status,
      headers: responseHeaders ?? headers
    });
  }
  newResponse = /* @__PURE__ */ __name((...args) => this.#newResponse(...args), "newResponse");
  /**
  * `.body()` can return the HTTP response.
  * You can set headers with `.header()` and set HTTP status code with `.status`.
  * This can also be set in `.text()`, `.json()` and so on.
  *
  * @see {@link https://hono.dev/docs/api/context#body}
  *
  * @example
  * ```ts
  * app.get('/welcome', (c) => {
  *   // Set headers
  *   c.header('X-Message', 'Hello!')
  *   c.header('Content-Type', 'text/plain')
  *   // Set HTTP status code
  *   c.status(201)
  *
  *   // Return the response body
  *   return c.body('Thank you for coming')
  * })
  * ```
  */
  body = /* @__PURE__ */ __name((data, arg, headers) => this.#newResponse(data, arg, headers), "body");
  /**
  * `.text()` can render text as `Content-Type:text/plain`.
  *
  * @see {@link https://hono.dev/docs/api/context#text}
  *
  * @example
  * ```ts
  * app.get('/say', (c) => {
  *   return c.text('Hello!')
  * })
  * ```
  */
  text = /* @__PURE__ */ __name((text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(text, arg, setDefaultContentType(TEXT_PLAIN, headers));
  }, "text");
  /**
  * `.json()` can render JSON as `Content-Type:application/json`.
  *
  * @see {@link https://hono.dev/docs/api/context#json}
  *
  * @example
  * ```ts
  * app.get('/api', (c) => {
  *   return c.json({ message: 'Hello!' })
  * })
  * ```
  */
  json = /* @__PURE__ */ __name((object, arg, headers) => {
    return this.#newResponse(JSON.stringify(object), arg, setDefaultContentType("application/json", headers));
  }, "json");
  html = /* @__PURE__ */ __name((html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  }, "html");
  /**
  * `.redirect()` can Redirect, default status code is 302.
  *
  * @see {@link https://hono.dev/docs/api/context#redirect}
  *
  * @example
  * ```ts
  * app.get('/redirect', (c) => {
  *   return c.redirect('/')
  * })
  * app.get('/redirect-permanently', (c) => {
  *   return c.redirect('/', 301)
  * })
  * ```
  */
  redirect = /* @__PURE__ */ __name((location, status) => {
    const locationString = String(location);
    this.header("Location", !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString));
    return this.newResponse(null, status ?? 302);
  }, "redirect");
  /**
  * `.notFound()` can return the Not Found Response.
  *
  * @see {@link https://hono.dev/docs/api/context#notfound}
  *
  * @example
  * ```ts
  * app.get('/notfound', (c) => {
  *   return c.notFound()
  * })
  * ```
  */
  notFound = /* @__PURE__ */ __name(() => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  }, "notFound");
};

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/compose.js
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) throw new Error("next() called multiple times");
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else handler = i === middleware.length && next || void 0;
      if (handler) try {
        res = await handler(context, () => dispatch(i + 1));
      } catch (err) {
        if (err instanceof Error && onError) {
          context.error = err;
          res = await onError(err, context);
          isError = true;
        } else throw err;
      }
      else if (context.finalized === false && onNotFound) res = await onNotFound(context);
      if (res && (context.finalized === false || isError)) context.res = res;
      return context;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/router.js
var METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "options",
  "patch",
  "query"
];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
  static {
    __name(this, "UnsupportedPathError");
  }
};

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/utils/mount.js
var getPathPrefixLength = /* @__PURE__ */ __name((c, pathPrefix, routePath) => {
  if (!/[:*]/.test(pathPrefix)) return pathPrefix.length;
  const path = c.req.path;
  const matchResult = c.req[GET_MATCH_RESULT];
  const paramNames = /* @__PURE__ */ new Set();
  let length = 0;
  for (const part of splitRoutingPath(pathPrefix)) {
    const pattern = getPattern(part);
    if (pattern && pattern !== "*") {
      const name = pattern[1];
      if (paramNames.has(name)) throw new Error(`mount(): Duplicate path parameter "${name}" in "${routePath}".`);
      paramNames.add(name);
    }
    if (pattern && pattern !== "*" && pattern[2] !== true) {
      const value = matchResult.length === 2 ? matchResult[1][matchResult[0][c.req.routeIndex][1][pattern[1]]] : matchResult[0][c.req.routeIndex][1][pattern[1]];
      length += value.length + 1;
    } else if (pattern || part.endsWith("*")) {
      const end = path.indexOf("/", length + 1);
      length = end === -1 ? path.length : end;
    } else length += part.length + 1;
  }
  return length;
}, "getPathPrefixLength");
var createMountedRequest = /* @__PURE__ */ __name((c, pathPrefix, routePath) => {
  if (/[^/]\*$/.test(routePath)) throw new Error(`mount(): Wildcard must follow "/" in "${routePath}".`);
  const url = new URL(c.req.raw.url);
  url.pathname = stripPathPrefix(url.pathname, c.req.path, getPathPrefixLength(c, pathPrefix, routePath));
  return new Request(url, c.req.raw);
}, "createMountedRequest");

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = class Hono2 {
  static {
    __name(this, "Hono");
  }
  get;
  post;
  put;
  delete;
  options;
  patch;
  query;
  all;
  on;
  use;
  router;
  getPath;
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    [...METHODS, "all"].forEach((method) => {
      this[method] = (args1, ...args) => {
        const methodName = method.toUpperCase();
        if (typeof args1 === "string") this.#path = args1;
        else this.#addRoute(methodName, this.#path, args1);
        args.forEach((handler) => {
          this.#addRoute(methodName, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          const methodName = m.toUpperCase();
          for (const handler of handlers) this.#addRoute(methodName, this.#path, handler);
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") this.#path = arg1;
      else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute("ALL", this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new Hono2({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  errorHandler = errorHandler;
  /**
  * `.route()` allows grouping other Hono instance in routes.
  *
  * @see {@link https://hono.dev/docs/api/routing#grouping}
  *
  * @param {string} path - base Path
  * @param {Hono} app - other Hono instance
  * @returns {Hono} routed Hono instance
  *
  * @example
  * ```ts
  * const app = new Hono()
  * const app2 = new Hono()
  *
  * app2.get("/user", (c) => c.text("user"))
  * app.route("/api", app2) // GET /api/user
  * ```
  */
  route(path, app) {
    const subApp = this.basePath(path);
    app.routes.map((r) => {
      let handler;
      if (app.errorHandler === errorHandler) handler = r.handler;
      else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler, r.basePath);
    });
    return this;
  }
  /**
  * `.basePath()` allows base paths to be specified.
  *
  * @see {@link https://hono.dev/docs/api/routing#base-path}
  *
  * @param {string} path - base Path
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * const api = new Hono().basePath('/api')
  * ```
  */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
  * `.onError()` handles an error and returns a customized Response.
  *
  * @see {@link https://hono.dev/docs/api/hono#error-handling}
  *
  * @param {ErrorHandler} handler - request Handler for error
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * app.onError((err, c) => {
  *   console.error(`${err}`)
  *   return c.text('Custom Error Message', 500)
  * })
  * ```
  */
  onError = /* @__PURE__ */ __name((handler) => {
    this.errorHandler = handler;
    return this;
  }, "onError");
  /**
  * `.notFound()` allows you to customize a Not Found Response.
  *
  * @see {@link https://hono.dev/docs/api/hono#not-found}
  *
  * @param {NotFoundHandler} handler - request handler for not-found
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * app.notFound((c) => {
  *   return c.text('Custom 404 Message', 404)
  * })
  * ```
  */
  notFound = /* @__PURE__ */ __name((handler) => {
    this.#notFoundHandler = handler;
    return this;
  }, "notFound");
  /**
  * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
  *
  * @deprecated Use `mount()` from `hono/mount` instead. `.mount()` will be removed in v5.
  *
  * @see {@link https://hono.dev/docs/api/hono#mount}
  *
  * @param {string} path - base Path
  * @param {Function} applicationHandler - other Request Handler
  * @param {MountOptions} [options] - options of `.mount()`
  * @returns {Hono} mounted Hono instance
  *
  * @example
  * ```ts
  * import { Router as IttyRouter } from 'itty-router'
  * import { Hono } from 'hono'
  * // Create itty-router application
  * const ittyRouter = IttyRouter()
  * // GET /itty-router/hello
  * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
  *
  * const app = new Hono()
  * app.mount('/itty-router', ittyRouter.handle)
  * ```
  *
  * @example
  * ```ts
  * const app = new Hono()
  * // Send the request to another application without modification.
  * app.mount('/app', anotherApp, {
  *   replaceRequest: (req) => req,
  * })
  * ```
  */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") optionHandler = options;
      else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        else replaceRequest = options.replaceRequest;
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    const mergedPath = mergePath(this._basePath, path);
    const defaultReplaceRequest = /* @__PURE__ */ __name((c) => createMountedRequest(c, mergedPath.replace(/\/$/, ""), mergePath(mergedPath, "*")), "defaultReplaceRequest");
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest ? replaceRequest(c.req.raw) : defaultReplaceRequest(c), ...getOptions(c));
      if (res) return res;
      await next();
    }, "handler");
    this.#addRoute("ALL", mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler, baseRoutePath) {
    path = mergePath(this._basePath, path);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path,
      method,
      handler
    };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) return this.errorHandler(err, c);
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then((resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) throw new Error("Context is not finalized. Did you forget to return a Response object or `await next()`?");
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
  * `.fetch()` will be entry point of your app.
  *
  * @see {@link https://hono.dev/docs/api/hono#fetch}
  *
  * @param {Request} request - request Object of request
  * @param {Env} env - env Object
  * @param {ExecutionContext} executionCtx - context of execution
  * @returns {Response | Promise<Response>} response of request
  *
  */
  fetch = /* @__PURE__ */ __name((request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  }, "fetch");
  /**
  * `.request()` is a useful method for testing.
  * You can pass a URL or pathname to send a GET request.
  * app will return a Response object.
  * ```ts
  * test('GET /hello is ok', async () => {
  *   const res = await app.request('/hello')
  *   expect(res.status).toBe(200)
  * })
  * ```
  * @see https://hono.dev/docs/api/hono#request
  */
  request = /* @__PURE__ */ __name((input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    input = input.toString();
    return this.fetch(new Request(/^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`, requestInit), Env, executionCtx);
  }, "request");
  /**
  * `.fire()` automatically adds a global fetch event listener.
  * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
  * @deprecated
  * Use `fire` from `hono/service-worker` instead.
  * ```ts
  * import { Hono } from 'hono'
  * import { fire } from 'hono/service-worker'
  *
  * const app = new Hono()
  * // ...
  * fire(app)
  * ```
  * @see https://hono.dev/docs/api/hono#fire
  * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
  * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
  */
  fire = /* @__PURE__ */ __name(() => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  }, "fire");
};

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/router/utils.js
var createNullObject = /* @__PURE__ */ __name(() => /* @__PURE__ */ Object.create(null), "createNullObject");

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name(((method2, path2) => {
    const matcher = matchers[method2] || matchers["ALL"];
    const staticMatch = matcher[2][path2];
    if (staticMatch) return staticMatch;
    const match3 = path2.match(matcher[0]);
    if (!match3) return [[], emptyParam];
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  }), "match");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = "[^]*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/[^]*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = /* @__PURE__ */ new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) return b.length === 1 ? a < b ? -1 : 1 : -1;
  if (b.length === 1) return 1;
  if (a === "[^]*" || a === "(?:|/[^]*)") return b === "[^]*" ? -1 : 1;
  else if (b === "[^]*" || b === "(?:|/[^]*)") return -1;
  if (a === "[^/]+") return 1;
  else if (b === "[^/]+") return -1;
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
__name(compareKey, "compareKey");
var Node = class Node2 {
  static {
    __name(this, "Node");
  }
  #index;
  #varIndex;
  #children = createNullObject();
  insert(tokens, index, paramMap, context, keys) {
    let node = this;
    for (let i = 0, len = tokens.length; i < len; i++) {
      const token = tokens[i];
      const pattern = token.length === 1 ? token === "*" ? i === len - 1 ? [
        "",
        "",
        ONLY_WILDCARD_REG_EXP_STR
      ] : [
        "",
        "",
        LABEL_REG_EXP_STR
      ] : null : token === "/*" ? [
        "",
        "",
        TAIL_WILDCARD_REG_EXP_STR
      ] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
      let nextNode;
      if (pattern) {
        const name = pattern[1];
        let regexpStr = pattern[2] || "[^/]+";
        if (name && pattern[2]) {
          if (new RegExp(regexpStr).test("")) throw PATH_ERROR;
          regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
          if (/\((?!\?:)/.test(regexpStr)) throw PATH_ERROR;
          if (regexpStr.length === 1 && regExpMetaChars.has(regexpStr)) throw PATH_ERROR;
        }
        keys.push(regexpStr);
        nextNode = node.#children[regexpStr];
        if (!nextNode) {
          if (regexpStr !== "[^]*" && regexpStr !== "(?:|/[^]*)") {
            for (const k in node.#children) if ((regexpStr.length > 1 || k.length > 1) && k !== "[^]*" && k !== "(?:|/[^]*)") throw PATH_ERROR;
          }
          nextNode = node.#children[regexpStr] = new Node2();
        }
        if (name !== "") {
          nextNode.#varIndex ??= context.varIndex++;
          paramMap.push([name, nextNode.#varIndex]);
        }
      } else {
        keys.push(token);
        nextNode = node.#children[token];
        if (!nextNode) {
          for (const k in node.#children) if (k.length > 1 && k !== "[^]*" && k !== "(?:|/[^]*)") throw PATH_ERROR;
          nextNode = node.#children[token] = new Node2();
        }
      }
      node = nextNode;
    }
    if (node.#index !== void 0) throw PATH_ERROR;
    node.#index = index;
  }
  buildRegExpStr() {
    const strList = Object.keys(this.#children).sort(compareKey).map((k) => {
      const c = this.#children[k];
      const childStr = c.buildRegExpStr();
      return childStr === "" ? "" : (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + childStr;
    }).filter(Boolean);
    if (typeof this.#index === "number" && this.#index !== -1) strList.unshift(`#${this.#index}`);
    if (strList.length === 0) return "";
    if (strList.length === 1) return strList[0];
    return "(?:" + strList.join("|") + ")";
  }
};

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  static {
    __name(this, "Trie");
  }
  #context = { varIndex: 0 };
  #root = new Node();
  #index = 0;
  paths = createNullObject();
  insert(path, isStatic) {
    const keys = [];
    if (isStatic) {
      this.#root.insert(path.split(""), -1, [], this.#context, keys);
      this.paths[path] = [
        -1,
        [],
        keys
      ];
      return;
    }
    const paramAssoc = [];
    const groups = [];
    let markedPath = path;
    for (let i = 0; ; ) {
      let replaced = false;
      markedPath = markedPath.replace(/\{(?:\{[\d,]+\}|[^}])+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) break;
    }
    const tokens = markedPath.match(/(?::[^\/]+)|(?:\/\*$)|./gs) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) if (tokens[j].indexOf(mark) !== -1) {
        tokens[j] = tokens[j].replace(mark, groups[i][1]);
        break;
      }
    }
    this.#root.insert(tokens, this.#index, paramAssoc, this.#context, keys);
    this.paths[path] = [
      this.#index++,
      paramAssoc,
      keys
    ];
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") return [
      /^$/,
      [],
      []
    ];
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [
      new RegExp(`^${regexp}`),
      indexReplacementMap,
      paramReplacementMap
    ];
  }
};

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/router/reg-exp-router/router.js
function endsWithWildcard(keys) {
  const tail = keys[keys.length - 1];
  return tail === "[^]*" || tail === "(?:|/[^]*)";
}
__name(endsWithWildcard, "endsWithWildcard");
function covers(wildcard, target) {
  const last = wildcard.length - 1;
  for (let i = 0; i < last; i++) if (wildcard[i] !== target[i]) return false;
  return wildcard[last] === "[^]*" || target.length === last || target[last] === "/";
}
__name(covers, "covers");
var RegExpRouter = class {
  static {
    __name(this, "RegExpRouter");
  }
  name = "RegExpRouter";
  #handlers;
  #tries;
  constructor() {
    this.#handlers = { ["ALL"]: [] };
    this.#tries = { ["ALL"]: new Trie() };
  }
  #insertPath(method, path) {
    try {
      this.#tries[method].insert(path, !/\*|\/:/.test(path));
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
  }
  add(method, path, handler) {
    const handlers = this.#handlers;
    if (!handlers) throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    const tries = this.#tries;
    if (!handlers[method]) {
      tries[method] = new Trie();
      handlers[method] = [...handlers["ALL"]];
      for (const p in tries["ALL"].paths) this.#insertPath(method, p);
    }
    if (path === "/*") path = "*";
    const methods = method === "ALL" ? Object.keys(handlers) : [method];
    const paths = checkOptionalParameter(path) || [path];
    for (const path2 of paths) for (const m of methods) {
      if (!tries[m].paths[path2]) this.#insertPath(m, path2);
      handlers[m].push([handler, path2]);
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = createNullObject();
    for (const method of Object.keys(this.#handlers)) matchers[method] = this.#buildMatcher(method);
    this.#handlers = this.#tries = void 0;
    return matchers;
  }
  #buildMatcher(method) {
    const handlers = this.#handlers[method];
    const trie = this.#tries[method];
    const staticMap = createNullObject();
    const handlerData = [];
    const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
    const own = createNullObject();
    const entries = handlers.map(([h, p], i) => {
      (own[p] ??= []).push(i);
      return [h, trie.paths[p][1].reduceRight((map, [key, varIndex]) => {
        map[key] = paramReplacementMap[varIndex];
        return map;
      }, createNullObject())];
    });
    const wildcards = Object.keys(own).filter((p) => endsWithWildcard(trie.paths[p][2]));
    for (const path in trie.paths) {
      const [index, , keys] = trie.paths[path];
      const indexes = [...own[path]];
      for (const p of wildcards) if (p !== path && covers(trie.paths[p][2], keys)) indexes.push(...own[p]);
      const data = indexes.sort((a, b) => a - b).map((i) => entries[i]);
      if (index === -1) {
        const last = Math.max(-1, ...data.flatMap(([, map]) => Object.values(map)));
        staticMap[path] = [data, last === -1 ? emptyParam : path.match(regexp).slice(0, last + 1)];
      } else handlerData[index] = data;
    }
    return [
      regexp,
      indexReplacementMap.map((i) => handlerData[i]),
      staticMap
    ];
  }
};

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  static {
    __name(this, "SmartRouter");
  }
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    this.#routes.push([
      method,
      path,
      handler
    ]);
  }
  match(method, path) {
    if (!this.#routes) throw new Error("Fatal error");
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) router.add(...routes[i2]);
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) continue;
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) throw new Error("Fatal error");
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) throw new Error("No active router has been determined yet.");
    return this.#routers[0];
  }
};

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/router/trie-router/node.js
var emptyParams = createNullObject();
var order = 0;
var Node3 = class Node4 {
  static {
    __name(this, "Node");
  }
  #methods = [];
  #children = createNullObject();
  #patterns = [];
  #pattern;
  #params = emptyParams;
  insert(method, path, handler) {
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = /* @__PURE__ */ new Set();
    let i = 0;
    for (const p of parts) {
      const nextP = parts[++i];
      const pattern = getPattern(p, nextP) || (nextP === void 0 && p && p.indexOf("*") === p.length - 1 ? p : null);
      const isParam = Array.isArray(pattern);
      const key = isParam ? pattern[0] : pattern || p;
      const child = curNode.#children[key] ||= new Node4();
      if (pattern && !child.#pattern) {
        child.#pattern = pattern;
        curNode.#patterns.push(child);
      }
      curNode = child;
      if (isParam) possibleKeys.add(pattern[1]);
    }
    curNode.#methods.push({ [method]: {
      handler,
      possibleKeys: [...possibleKeys],
      score: ++order
    } });
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m["ALL"];
      if (handlerSet) {
        handlerSet.params = createNullObject();
        handlerSets.push(handlerSet);
        for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
          const key = handlerSet.possibleKeys[i2];
          handlerSet.params[key] = params?.[key] && !i2 ? params[key] : nodeParams[key] ?? params?.[key];
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    let curNodes = [this];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else tempNodes.push(nextNode);
        }
        for (const child of node.#patterns) {
          const pattern = child.#pattern;
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (typeof pattern === "string") {
            if (pattern === "*" || part.startsWith(pattern.slice(0, -1))) {
              this.#pushHandlerSets(handlerSets, child, method, node.#params);
              if (pattern === "*") {
                child.#params = params;
                tempNodes.push(child);
              }
            }
            continue;
          }
          const [, name, matcher] = pattern;
          if (!part && matcher === true) continue;
          if (matcher !== true) {
            if (!partOffsets) {
              partOffsets = [];
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.slice(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              if (!Object.hasOwn(params, name)) params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (m[0].length === restPathString.length && child.#children["*"]) this.#pushHandlerSets(handlerSets, child.#children["*"], method, node.#params, params);
              for (const _ in child.#children) {
                child.#params = params;
                const componentCount = m[0].match(/\//g)?.length ?? 0;
                (curNodesQueue[componentCount] ||= []).push(child);
                break;
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            if (!Object.hasOwn(params, name)) params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) this.#pushHandlerSets(handlerSets, child.#children["*"], method, params, node.#params);
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets[1]) handlerSets.sort((a, b) => {
      return a.score - b.score;
    });
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  static {
    __name(this, "TrieRouter");
  }
  name = "TrieRouter";
  #node = new Node3();
  add(method, path, handler) {
    for (const result of checkOptionalParameter(path) || [path]) this.#node.insert(method, result, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/hono.js
var Hono3 = class extends Hono {
  static {
    __name(this, "Hono");
  }
  /**
  * Creates an instance of the Hono class.
  *
  * @param options - Optional configuration options for the Hono instance.
  */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] });
  }
};

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/middleware/bearer-auth/index.js
var TOKEN_STRINGS = "[A-Za-z0-9._~+/-]+=*";
var PREFIX = "Bearer";
var HEADER = "Authorization";
var bearerAuth = /* @__PURE__ */ __name((options) => {
  if (!("token" in options || "verifyToken" in options)) throw new Error('bearer auth middleware requires options for "token" or "verifyToken"');
  if (!options.realm) options.realm = "";
  if (options.prefix === void 0) options.prefix = PREFIX;
  const realm = options.realm?.replace(/[\\"]/g, "\\$&");
  const prefix = options.prefix;
  const tokenRegexp = new RegExp(`^${TOKEN_STRINGS}$`);
  const wwwAuthenticatePrefix = prefix === "" ? "" : `${prefix} `;
  const throwHTTPException = /* @__PURE__ */ __name(async (c, status, wwwAuthenticateHeader, messageOption) => {
    const wwwAuthenticateHeaderValue = typeof wwwAuthenticateHeader === "function" ? await wwwAuthenticateHeader(c) : wwwAuthenticateHeader;
    const headers = { "WWW-Authenticate": typeof wwwAuthenticateHeaderValue === "string" ? wwwAuthenticateHeaderValue : `${wwwAuthenticatePrefix}${Object.entries(wwwAuthenticateHeaderValue).map(([key, value]) => `${key}="${value}"`).join(",")}` };
    const responseMessage = typeof messageOption === "function" ? await messageOption(c) : messageOption;
    if (responseMessage instanceof Response) {
      const resHeaders = new Headers(responseMessage.headers);
      if (!resHeaders.has("WWW-Authenticate")) resHeaders.set("WWW-Authenticate", headers["WWW-Authenticate"]);
      throw new HTTPException(responseMessage.status, { res: new Response(responseMessage.body, {
        status: responseMessage.status,
        headers: resHeaders
      }) });
    }
    const res = typeof responseMessage === "string" ? new Response(responseMessage, {
      status,
      headers
    }) : new Response(JSON.stringify(responseMessage), {
      status,
      headers: {
        ...headers,
        "content-type": "application/json"
      }
    });
    throw new HTTPException(status, { res });
  }, "throwHTTPException");
  return /* @__PURE__ */ __name(async function bearerAuth2(c, next) {
    const headerToken = c.req.header(options.headerName || HEADER);
    if (!headerToken) await throwHTTPException(c, 401, options.noAuthenticationHeader?.wwwAuthenticateHeader || `${wwwAuthenticatePrefix}realm="${realm}"`, options.noAuthenticationHeader?.message || options.noAuthenticationHeaderMessage || "Unauthorized");
    else {
      let tokenValue;
      if (prefix === "") tokenValue = headerToken;
      else {
        const headerLower = headerToken.toLowerCase();
        const prefixLower = prefix.toLowerCase();
        if (headerLower.startsWith(prefixLower) && headerToken[prefix.length] === " ") tokenValue = headerToken.slice(prefix.length).trimStart();
      }
      if (!tokenValue || !tokenRegexp.test(tokenValue)) await throwHTTPException(c, 400, options.invalidAuthenticationHeader?.wwwAuthenticateHeader || `${wwwAuthenticatePrefix}error="invalid_request"`, options.invalidAuthenticationHeader?.message || options.invalidAuthenticationHeaderMessage || "Bad Request");
      else {
        let equal = false;
        if ("verifyToken" in options) equal = await options.verifyToken(tokenValue, c);
        else if (typeof options.token === "string") equal = await timingSafeEqual(options.token, tokenValue, options.hashFunction);
        else if (Array.isArray(options.token) && options.token.length > 0) {
          for (const token of options.token) if (await timingSafeEqual(token, tokenValue, options.hashFunction)) {
            equal = true;
            break;
          }
        }
        if (!equal) await throwHTTPException(c, 401, options.invalidToken?.wwwAuthenticateHeader || `${wwwAuthenticatePrefix}error="invalid_token"`, options.invalidToken?.message || options.invalidTokenMessage || "Unauthorized");
      }
    }
    await next();
  }, "bearerAuth");
}, "bearerAuth");

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/middleware/body-limit/index.js
var ERROR_MESSAGE = "Payload Too Large";
var bodyLimit = /* @__PURE__ */ __name((options) => {
  const onError = options.onError || (() => {
    const res = new Response(ERROR_MESSAGE, { status: 413 });
    throw new HTTPException(413, { res });
  });
  const maxSize = options.maxSize;
  return /* @__PURE__ */ __name(async function bodyLimit2(c, next) {
    if (!c.req.raw.body) return next();
    const hasTransferEncoding = c.req.raw.headers.has("transfer-encoding");
    if (c.req.raw.headers.has("content-length") && !hasTransferEncoding) return parseInt(c.req.raw.headers.get("content-length") || "0", 10) > maxSize ? onError(c) : next();
    let size = 0;
    const chunks = [];
    const rawReader = c.req.raw.body.getReader();
    for (; ; ) {
      const { done, value } = await rawReader.read();
      if (done) break;
      size += value.length;
      if (size > maxSize) return onError(c);
      chunks.push(value);
    }
    const requestInit = {
      body: new ReadableStream({ start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      } }),
      duplex: "half"
    };
    c.req.raw = new Request(c.req.raw, requestInit);
    return next();
  }, "bodyLimit");
}, "bodyLimit");

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/middleware/combine/index.js
var some = /* @__PURE__ */ __name((...middleware) => {
  return /* @__PURE__ */ __name(async function some2(c, next) {
    let isNextCalled = false;
    const wrappedNext = /* @__PURE__ */ __name(() => {
      isNextCalled = true;
      return next();
    }, "wrappedNext");
    let lastError;
    let response;
    for (const handler of middleware) try {
      const result = await handler(c, wrappedNext);
      if (result === true && !c.finalized) await wrappedNext();
      else if (result === false) {
        lastError = /* @__PURE__ */ new Error("No successful middleware found");
        continue;
      } else if (result && result !== true) response = result;
      lastError = void 0;
      break;
    } catch (error) {
      lastError = error;
      if (isNextCalled) break;
    }
    if (lastError) throw lastError;
    return response;
  }, "some");
}, "some");
var every = /* @__PURE__ */ __name((...middleware) => {
  return /* @__PURE__ */ __name(async function every2(c, next) {
    const currentRouteIndex = c.req.routeIndex;
    await compose(middleware.map((m) => [[async (c2, next2) => {
      c2.req.routeIndex = currentRouteIndex;
      const res = await m(c2, next2);
      if (res === false) throw new Error("Unmet condition");
      return res;
    }]]))(c, next);
  }, "every");
}, "every");
var except = /* @__PURE__ */ __name((condition, ...middleware) => {
  let router = void 0;
  const conditions = (Array.isArray(condition) ? condition : [condition]).map((condition2) => {
    if (typeof condition2 === "string") {
      router ||= new TrieRouter();
      router.add("ALL", condition2, true);
    } else return condition2;
  }).filter(Boolean);
  if (router) conditions.unshift((c) => !!router?.match("ALL", c.req.path)?.[0]?.[0]?.[0]);
  const handler = some((c) => conditions.some((cond) => cond(c)), every(...middleware));
  return /* @__PURE__ */ __name(async function except2(c, next) {
    await handler(c, next);
  }, "except");
}, "except");

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/utils/accept.js
var isWhitespace = /* @__PURE__ */ __name((char) => char === 32 || char === 9 || char === 10 || char === 13, "isWhitespace");
var consumeWhitespace = /* @__PURE__ */ __name((acceptHeader, startIndex) => {
  while (startIndex < acceptHeader.length) {
    if (!isWhitespace(acceptHeader.charCodeAt(startIndex))) break;
    startIndex++;
  }
  return startIndex;
}, "consumeWhitespace");
var ignoreTrailingWhitespace = /* @__PURE__ */ __name((acceptHeader, startIndex) => {
  while (startIndex > 0) {
    if (!isWhitespace(acceptHeader.charCodeAt(startIndex - 1))) break;
    startIndex--;
  }
  return startIndex;
}, "ignoreTrailingWhitespace");
var skipInvalidParam = /* @__PURE__ */ __name((acceptHeader, startIndex) => {
  while (startIndex < acceptHeader.length) {
    const char = acceptHeader.charCodeAt(startIndex);
    if (char === 59) return [startIndex + 1, true];
    if (char === 44) return [startIndex + 1, false];
    startIndex++;
  }
  return [startIndex, false];
}, "skipInvalidParam");
var skipInvalidAcceptValue = /* @__PURE__ */ __name((acceptHeader, startIndex) => {
  let i = startIndex;
  let inQuotes = false;
  while (i < acceptHeader.length) {
    const char = acceptHeader.charCodeAt(i);
    if (inQuotes && char === 92) i++;
    else if (char === 34) inQuotes = !inQuotes;
    else if (!inQuotes && char === 44) return i + 1;
    i++;
  }
  return i;
}, "skipInvalidAcceptValue");
var getNextParam = /* @__PURE__ */ __name((acceptHeader, startIndex) => {
  startIndex = consumeWhitespace(acceptHeader, startIndex);
  let i = startIndex;
  let key;
  let value;
  let hasNext = false;
  while (i < acceptHeader.length) {
    const char = acceptHeader.charCodeAt(i);
    if (char === 61) {
      key = acceptHeader.slice(startIndex, ignoreTrailingWhitespace(acceptHeader, i));
      i++;
      break;
    }
    if (char === 59) return [
      i + 1,
      void 0,
      void 0,
      true
    ];
    if (char === 44) return [
      i + 1,
      void 0,
      void 0,
      false
    ];
    i++;
  }
  if (key === void 0) return [
    i,
    void 0,
    void 0,
    false
  ];
  i = consumeWhitespace(acceptHeader, i);
  if (acceptHeader.charCodeAt(i) === 61) {
    const skipResult = skipInvalidParam(acceptHeader, i + 1);
    return [
      skipResult[0],
      key,
      void 0,
      skipResult[1]
    ];
  }
  let inQuotes = false;
  const paramStartIndex = i;
  while (i < acceptHeader.length) {
    const char = acceptHeader.charCodeAt(i);
    if (inQuotes && char === 92) i++;
    else if (char === 34) {
      if (inQuotes) {
        let nextIndex = consumeWhitespace(acceptHeader, i + 1);
        const nextChar = acceptHeader.charCodeAt(nextIndex);
        if (nextIndex < acceptHeader.length && !(nextChar === 59 || nextChar === 44)) {
          const skipResult = skipInvalidParam(acceptHeader, nextIndex);
          return [
            skipResult[0],
            key,
            void 0,
            skipResult[1]
          ];
        }
        value = acceptHeader.slice(paramStartIndex + 1, i);
        if (value.includes("\\")) value = value.replace(/\\(.)/g, "$1");
        if (nextChar === 44) return [
          nextIndex + 1,
          key,
          value,
          false
        ];
        if (nextChar === 59) {
          hasNext = true;
          nextIndex++;
        }
        i = nextIndex;
        break;
      }
      inQuotes = true;
    } else if (!inQuotes && (char === 59 || char === 44)) {
      value = acceptHeader.slice(paramStartIndex, ignoreTrailingWhitespace(acceptHeader, i));
      if (char === 59) hasNext = true;
      i++;
      break;
    }
    i++;
  }
  return [
    i,
    key,
    value ?? acceptHeader.slice(paramStartIndex, ignoreTrailingWhitespace(acceptHeader, i)),
    hasNext
  ];
}, "getNextParam");
var getNextAcceptValue = /* @__PURE__ */ __name((acceptHeader, startIndex) => {
  const accept = {
    type: "",
    params: /* @__PURE__ */ Object.create(null),
    q: 1
  };
  startIndex = consumeWhitespace(acceptHeader, startIndex);
  let i = startIndex;
  while (i < acceptHeader.length) {
    const char = acceptHeader.charCodeAt(i);
    if (char === 59 || char === 44) {
      accept.type = acceptHeader.slice(startIndex, ignoreTrailingWhitespace(acceptHeader, i));
      i++;
      if (char === 44) return [i, accept.type ? accept : void 0];
      if (!accept.type) return [skipInvalidAcceptValue(acceptHeader, i), void 0];
      break;
    }
    i++;
  }
  if (!accept.type) {
    accept.type = acceptHeader.slice(startIndex, ignoreTrailingWhitespace(acceptHeader, acceptHeader.length));
    return [acceptHeader.length, accept.type ? accept : void 0];
  }
  let param;
  let value;
  let hasNext;
  while (i < acceptHeader.length) {
    [i, param, value, hasNext] = getNextParam(acceptHeader, i);
    if (param && value) accept.params[param] = value;
    if (!hasNext) break;
  }
  return [i, accept];
}, "getNextAcceptValue");
var parseAccept = /* @__PURE__ */ __name((acceptHeader) => {
  if (!acceptHeader) return [];
  const values = [];
  let i = 0;
  let accept;
  let requiresSort = false;
  let lastAccept;
  while (i < acceptHeader.length) {
    [i, accept] = getNextAcceptValue(acceptHeader, i);
    if (accept) {
      accept.q = parseQuality(accept.params.q ?? accept.params.Q);
      values.push(accept);
      if (lastAccept && lastAccept.q < accept.q) requiresSort = true;
      lastAccept = accept;
    }
  }
  if (requiresSort) values.sort((a, b) => b.q - a.q);
  return values;
}, "parseAccept");
var parseQuality = /* @__PURE__ */ __name((qVal) => {
  if (qVal === void 0) return 1;
  if (qVal === "") return 1;
  if (qVal === "NaN") return 0;
  const num = Number(qVal);
  if (Number.isNaN(num)) return 1;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}, "parseQuality");

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/utils/compress.js
var COMPRESSIBLE_CONTENT_TYPE_REGEX = /^\s*(?:text\/(?!event-stream(?:[;\s]|$))[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|msgpack|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|vnd\.msgpack|wasm|x-httpd-php|x-javascript|x-msgpack|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml|msgpack))(?:[;\s]|$)/i;

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/middleware/compress/index.js
var ENCODING_TYPES = ["gzip", "deflate"];
var cacheControlNoTransformRegExp = /(?:^|,)\s*?no-transform\s*?(?:,|$)/i;
var selectEncoding = /* @__PURE__ */ __name((header, candidates) => {
  if (header === void 0) return;
  const accepts = parseAccept(header);
  const wildcardQ = accepts.find((a) => a.type === "*")?.q;
  let best;
  for (const enc of candidates) {
    const explicit = accepts.find((a) => a.type.toLowerCase() === enc);
    const q = explicit ? explicit.q : wildcardQ ?? 0;
    if (q === 1) return enc;
    else if (q > 0 && (!best || q > best.q)) best = {
      encoding: enc,
      q
    };
  }
  return best?.encoding;
}, "selectEncoding");
var varyAcceptEncodingRegExp = /(?:^|,)\s*accept-encoding\s*(?:,|$)/i;
var compress = /* @__PURE__ */ __name((options) => {
  const threshold = options?.threshold ?? 1024;
  const candidates = options?.encoding ? [options.encoding] : ENCODING_TYPES;
  const contentTypeFilter = options?.contentTypeFilter ?? COMPRESSIBLE_CONTENT_TYPE_REGEX;
  const shouldCompress = typeof contentTypeFilter === "function" ? (res) => {
    const type = res.headers.get("Content-Type");
    return type && contentTypeFilter(type);
  } : (res) => {
    const type = res.headers.get("Content-Type");
    return type && contentTypeFilter.test(type);
  };
  return /* @__PURE__ */ __name(async function compress2(ctx, next) {
    await next();
    const contentLength = ctx.res.headers.get("Content-Length");
    if (ctx.res.status === 206 || ctx.res.headers.has("Content-Encoding") || ctx.res.headers.has("Transfer-Encoding") || ctx.req.method === "HEAD" || contentLength && Number(contentLength) < threshold || !shouldCompress(ctx.res) || !shouldTransform(ctx.res)) return;
    const current = ctx.res.headers.get("Vary");
    if (current !== "*" && !(current && varyAcceptEncodingRegExp.test(current))) ctx.header("Vary", current ? `${current}, Accept-Encoding` : "Accept-Encoding");
    const accepted = ctx.req.header("Accept-Encoding");
    const encoding = selectEncoding(accepted, candidates);
    if (!encoding || !ctx.res.body) return;
    const stream = new CompressionStream(encoding);
    ctx.res = new Response(ctx.res.body.pipeThrough(stream), ctx.res);
    ctx.res.headers.delete("Content-Length");
    ctx.res.headers.set("Content-Encoding", encoding);
    const etag = ctx.res.headers.get("ETag");
    if (etag && !etag.startsWith("W/")) ctx.res.headers.set("ETag", `W/${etag}`);
  }, "compress");
}, "compress");
var shouldTransform = /* @__PURE__ */ __name((res) => {
  const cacheControl = res.headers.get("Cache-Control");
  return !cacheControl || !cacheControlNoTransformRegExp.test(cacheControl);
}, "shouldTransform");

// ../node_modules/.pnpm/hono@4.13.17/node_modules/hono/dist/middleware/cors/index.js
var cors = /* @__PURE__ */ __name((options) => {
  const opts = {
    origin: "*",
    allowMethods: [
      "GET",
      "HEAD",
      "PUT",
      "POST",
      "DELETE",
      "PATCH",
      "QUERY"
    ],
    allowHeaders: [],
    exposeHeaders: [],
    ...options
  };
  const exposeHeadersStr = opts.exposeHeaders?.length ? opts.exposeHeaders.join(",") : void 0;
  const allowHeadersStr = opts.allowHeaders?.length ? opts.allowHeaders.join(",") : void 0;
  const findAllowOrigin = ((optsOrigin) => {
    if (typeof optsOrigin === "string") {
      if (optsOrigin === "*") return () => optsOrigin;
      else return (origin) => optsOrigin === origin ? origin : null;
    } else if (typeof optsOrigin === "function") return optsOrigin;
    else return (origin) => optsOrigin.includes(origin) ? origin : null;
  })(opts.origin);
  const findAllowMethods = ((optsAllowMethods) => {
    if (typeof optsAllowMethods === "function") return async (origin, c) => (await optsAllowMethods(origin, c)).join(",");
    else if (Array.isArray(optsAllowMethods)) {
      const methodsStr = optsAllowMethods.join(",");
      return () => methodsStr;
    } else return () => "";
  })(opts.allowMethods);
  return /* @__PURE__ */ __name(async function cors2(c, next) {
    function set(key, value) {
      c.res.headers.set(key, value);
    }
    __name(set, "set");
    const allowOrigin = await findAllowOrigin(c.req.header("origin") || "", c);
    if (allowOrigin) set("Access-Control-Allow-Origin", allowOrigin);
    if (opts.credentials) set("Access-Control-Allow-Credentials", "true");
    if (exposeHeadersStr) set("Access-Control-Expose-Headers", exposeHeadersStr);
    if (c.req.method === "OPTIONS") {
      if (opts.origin !== "*") c.res.headers.append("Vary", "Origin");
      if (opts.maxAge != null) set("Access-Control-Max-Age", opts.maxAge.toString());
      const allowMethods = await findAllowMethods(c.req.header("origin") || "", c);
      if (allowMethods) set("Access-Control-Allow-Methods", allowMethods);
      let headersStr = allowHeadersStr;
      if (!headersStr) {
        const requestHeaders = c.req.header("Access-Control-Request-Headers");
        if (requestHeaders) headersStr = requestHeaders.split(",").map((h) => h.trim()).join(",");
      }
      if (headersStr) {
        set("Access-Control-Allow-Headers", headersStr);
        c.res.headers.append("Vary", "Access-Control-Request-Headers");
      }
      c.res.headers.delete("Content-Length");
      c.res.headers.delete("Content-Type");
      return new Response(null, {
        headers: c.res.headers,
        status: 204,
        statusText: "No Content"
      });
    }
    await next();
    if (opts.origin !== "*") c.header("Vary", "Origin", { append: true });
  }, "cors");
}, "cors");

// ../src/shared/sync/clock.ts
var WALL_WIDTH = 11;
var COUNTER_WIDTH = 5;
var MAX_WALL = 36 ** WALL_WIDTH - 1;
var MAX_COUNTER = 36 ** COUNTER_WIDTH - 1;
var STAMP_PATTERN = /^[\da-z]{16}$/;
var MAX_CLOCK_DRIFT_MS = 24 * 60 * 60 * 1e3;
function formatStamp({ wall, counter }) {
  return wall.toString(36).padStart(WALL_WIDTH, "0") + counter.toString(36).padStart(COUNTER_WIDTH, "0");
}
__name(formatStamp, "formatStamp");
var stampAt = /* @__PURE__ */ __name((wall) => formatStamp({ wall, counter: 0 }), "stampAt");
function parseStamp(h) {
  if (!STAMP_PATTERN.test(h)) {
    return void 0;
  }
  return {
    wall: Number.parseInt(h.slice(0, WALL_WIDTH), 36),
    counter: Number.parseInt(h.slice(WALL_WIDTH), 36)
  };
}
__name(parseStamp, "parseStamp");
function compareStamps(a, b) {
  if (a.h !== b.h) {
    return a.h < b.h ? -1 : 1;
  }
  if (a.d !== b.d) {
    return a.d < b.d ? -1 : 1;
  }
  return 0;
}
__name(compareStamps, "compareStamps");

// ../src/shared/library-values.ts
var isRecord = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null && !Array.isArray(value), "isRecord");
var { imul } = Math;

// ../src/shared/library-sync.ts
var TOMBSTONE_KINDS = /* @__PURE__ */ new Set([
  "session",
  "tab",
  "bookmark",
  "column",
  "folder",
  "preference"
]);

// ../src/shared/sync/order-key.ts
var DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var ZERO = DIGITS[0];
var LAST = DIGITS.at(-1);
var SMALLEST_INTEGER = "A" + ZERO.repeat(26);
var MAX_KEY_LENGTH = 64;
var DIGITS_PATTERN = /^[\da-z]*$/i;
function integerLength(head) {
  if (head >= "a" && head <= "z") {
    return head.codePointAt(0) - "a".codePointAt(0) + 2;
  }
  return head >= "A" && head <= "Z" ? "Z".codePointAt(0) - head.codePointAt(0) + 2 : void 0;
}
__name(integerLength, "integerLength");
function split(key) {
  const length = integerLength(key[0] ?? "");
  if (length === void 0 || length > key.length || key.length > MAX_KEY_LENGTH || !DIGITS_PATTERN.test(key) || key === SMALLEST_INTEGER || key.endsWith(ZERO) && key.length > length) {
    return void 0;
  }
  return [key.slice(0, length), key.slice(length)];
}
__name(split, "split");
var isOrderKey = /* @__PURE__ */ __name((value) => typeof value === "string" && split(value) !== void 0, "isOrderKey");

// ../src/shared/sync/changes.ts
var ID_MAX = 100;
var DEVICE_MAX = 64;
var isId = /* @__PURE__ */ __name((value, max) => typeof value === "string" && value !== "" && value.length <= max, "isId");
var recordKey = /* @__PURE__ */ __name((change) => change.kind === "tab" ? `tab:${change.parentId ?? ""}:${change.id}` : `${change.kind}:${change.id}`, "recordKey");
function parseChange(value) {
  if (!isRecord(value) || typeof value.kind !== "string" || !TOMBSTONE_KINDS.has(value.kind) || !isId(value.id, ID_MAX) || typeof value.h !== "string" || !parseStamp(value.h) || !isId(value.d, DEVICE_MAX)) {
    return void 0;
  }
  const kind = value.kind;
  if (kind === "tab" ? !isId(value.parentId, ID_MAX) : value.parentId !== void 0) {
    return void 0;
  }
  if (value.o !== void 0 && !isOrderKey(value.o)) {
    return void 0;
  }
  const deleted = value.deleted === true;
  if (deleted ? value.value !== void 0 : value.value === void 0) {
    return void 0;
  }
  return {
    kind,
    id: value.id,
    ...kind === "tab" && { parentId: value.parentId },
    h: value.h,
    d: value.d,
    ...value.o !== void 0 && { o: value.o },
    ...deleted ? { deleted: true } : { value: value.value }
  };
}
__name(parseChange, "parseChange");
var supersedes = /* @__PURE__ */ __name((incoming, current) => !current || compareStamps(incoming, current) > 0, "supersedes");

// ../src/shared/sync/change-log.ts
var PROTOCOL_VERSION = 1;
var mustResync = /* @__PURE__ */ __name((cursor, seen, purgedSeq) => cursor > 0 && cursor < purgedSeq && seen < purgedSeq, "mustResync");
function pushResult(change, current, purgedH, now) {
  if (parseStamp(change.h).wall > now + MAX_CLOCK_DRIFT_MS) {
    return "clock";
  }
  if (!current && change.h <= purgedH) {
    return "stale";
  }
  return supersedes(change, current) ? "applied" : "superseded";
}
__name(pushResult, "pushResult");

// src/live.ts
var LIVE_PATH = "/v1/live";
var LIVE_PING = "ping";
var LIVE_PONG = "pong";
var LIVE_UNAUTHORIZED = 4401;
var LIVE_AUTH_TIMEOUT_MS = 1e4;
var LIVE_MAX_SOCKETS = 64;
var cursorMessage = /* @__PURE__ */ __name((cursor) => JSON.stringify({ type: "cursor", cursor }), "cursorMessage");
var readyMessage = /* @__PURE__ */ __name((cursor) => JSON.stringify({ type: "ready", cursor }), "readyMessage");
function sameToken(given, expected) {
  let difference = given.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= (given.codePointAt(index % Math.max(given.length, 1)) ?? 0) ^ expected.codePointAt(index);
  }
  return difference === 0;
}
__name(sameToken, "sameToken");
function isAuthMessage(message, token) {
  if (typeof message !== "string" || message.length > 1024) {
    return false;
  }
  try {
    const parsed = JSON.parse(message);
    return typeof parsed === "object" && parsed !== null && parsed.type === "auth" && typeof parsed.token === "string" && sameToken(parsed.token, token);
  } catch {
    return false;
  }
}
__name(isAuthMessage, "isAuthMessage");

// src/api.ts
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400"
};
var MIN_TOKEN_LENGTH = 32;
var DEFAULT_LIMITS = {
  maxRecords: 5e5,
  retentionDays: 90,
  requestsPerMinute: 300
};
var MINUTE_MS = 60 * 1e3;
var MAX_BODY_BYTES = 8 * 1024 * 1024;
var MAX_PUSH_CHANGES = 500;
var MAX_CHANGE_BYTES = 256 * 1024;
var MAX_KEY_CHARS = 4096;
var FEATURES = ["private", "key"];
var PRIVATE_PREFIX = "/private";
var DEFAULT_PULL = 500;
var MAX_PULL = 1e3;
var PURGE_EVERY_MS = 60 * 60 * 1e3;
var DAY_MS = 24 * 60 * 60 * 1e3;
var problem = /* @__PURE__ */ __name((error, detail) => ({
  error,
  ...detail
}), "problem");
function createApi(options) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  let lastPurge = 0;
  const app = new Hono3();
  if (options.compress) {
    app.use("*", compress());
  }
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
      maxAge: 86400
    })
  );
  app.get("/health", (c) => c.json({ ok: true }));
  const unauthorized = { error: "unauthorized" };
  app.use(
    "/v1/*",
    except(
      LIVE_PATH,
      bearerAuth({
        token: options.token,
        noAuthenticationHeader: { message: unauthorized },
        invalidAuthenticationHeader: { message: unauthorized },
        invalidToken: { message: unauthorized }
      })
    )
  );
  let rateWindow = { start: 0, count: 0 };
  app.use("/v1/*", async (c, next) => {
    const time = now();
    if (time - rateWindow.start >= MINUTE_MS) {
      rateWindow = { start: time, count: 0 };
    }
    rateWindow.count += 1;
    if (rateWindow.count > limits.requestsPerMinute) {
      const retryAfter = Math.ceil(
        (rateWindow.start + MINUTE_MS - time) / 1e3
      );
      c.header("Retry-After", String(retryAfter));
      return c.json(problem("rate_limited", { retryAfter }), 429);
    }
    await next();
  });
  app.get("/v1/status", (c) => {
    const log = options.log();
    return c.json({
      protocol: PROTOCOL_VERSION,
      cursor: log.cursor,
      records: log.size,
      limits,
      features: FEATURES
    });
  });
  app.get("/v1/key", (c) => c.json({ key: options.log().key }));
  app.post(
    "/v1/key",
    bodyLimit({
      maxSize: MAX_KEY_CHARS * 2,
      onError: /* @__PURE__ */ __name((c) => c.json(problem("too_large"), 413), "onError")
    }),
    async (c) => {
      let body;
      try {
        body = await c.req.json();
      } catch {
        return c.json(problem("bad_json"), 400);
      }
      const { key, previous } = body ?? {};
      if (typeof key !== "string" || key === "" || key.length > MAX_KEY_CHARS || !(previous === null || typeof previous === "string")) {
        return c.json(problem("bad_key"), 400);
      }
      const log = options.log();
      return log.replaceKey(key, previous) ? c.json({ key }) : c.json(problem("key_changed", { key: log.key }), 409);
    }
  );
  app.get("/v1/changes", (c) => {
    const cursor = Number(c.req.query("cursor") ?? 0);
    const limit = Number(c.req.query("limit") ?? DEFAULT_PULL);
    const seen = Number(c.req.query("purged") ?? 0);
    if ([cursor, seen].some(
      (value) => !(Number.isSafeInteger(value) && value >= 0)
    )) {
      return c.json(problem("bad_cursor"), 400);
    }
    return !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PULL ? c.json(problem("bad_limit", { max: MAX_PULL }), 400) : c.json(options.log().pull(cursor, limit, seen));
  });
  app.post(
    "/v1/changes",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: /* @__PURE__ */ __name((c) => c.json(problem("too_large", { maxBytes: MAX_BODY_BYTES }), 413), "onError")
    }),
    async (c) => {
      let body;
      try {
        body = await c.req.json();
      } catch {
        return c.json(problem("bad_json"), 400);
      }
      const raw2 = body?.changes;
      if (!Array.isArray(raw2) || raw2.length > MAX_PUSH_CHANGES) {
        return c.json(problem("bad_changes", { max: MAX_PUSH_CHANGES }), 400);
      }
      const changes = [];
      for (const [index, entry] of raw2.entries()) {
        const change = parseChange(entry);
        if (!change) {
          return c.json(problem("bad_change", { index }), 400);
        }
        if (JSON.stringify(change).length > MAX_CHANGE_BYTES) {
          return c.json(
            problem("change_too_large", { index, maxBytes: MAX_CHANGE_BYTES }),
            413
          );
        }
        changes.push(change);
      }
      const log = options.log();
      const time = now();
      if (time - lastPurge > PURGE_EVERY_MS) {
        lastPurge = time;
        log.purge(time - limits.retentionDays * DAY_MS);
      }
      if (log.size >= limits.maxRecords && changes.some((change) => !change.deleted)) {
        return c.json(problem("quota", { maxRecords: limits.maxRecords }), 507);
      }
      const before = log.cursor;
      const results = log.push(changes, time);
      const { cursor } = log;
      if (cursor !== before) {
        options.onApplied?.(cursor);
      }
      return c.json({ results, cursor });
    }
  );
  return app;
}
__name(createApi, "createApi");

// src/sql-change-log.ts
var SCHEMA = [
  `CREATE TABLE IF NOT EXISTS records (
		key TEXT PRIMARY KEY,
		seq INTEGER NOT NULL UNIQUE,
		h TEXT NOT NULL,
		d TEXT NOT NULL,
		deleted INTEGER NOT NULL,
		change TEXT NOT NULL
	)`,
  // Purges look only at old tombstones.
  "CREATE INDEX IF NOT EXISTS records_tombstones ON records (h) WHERE deleted = 1",
  "CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)"
];
var numberOf = /* @__PURE__ */ __name((value) => Number(value ?? 0), "numberOf");
var SqlChangeLog = class {
  constructor(sql) {
    this.sql = sql;
    for (const statement of SCHEMA) {
      sql.all(statement);
    }
    const meta = new Map(
      sql.all("SELECT name, value FROM meta").map((row) => [String(row.name), String(row.value)])
    );
    this.seq = Number(meta.get("seq") ?? 0);
    this.purgedSeq = Number(meta.get("purgedSeq") ?? 0);
    this.purgedH = meta.get("purgedH") ?? "";
    this.storedKey = meta.get("key") ?? null;
    const stored = meta.get("count");
    if (stored === void 0) {
      this.count = numberOf(sql.all("SELECT COUNT(*) AS n FROM records")[0]?.n);
      this.setMeta("count", String(this.count));
    } else {
      this.count = Number(stored);
    }
  }
  sql;
  static {
    __name(this, "SqlChangeLog");
  }
  seq;
  purgedSeq;
  purgedH;
  count;
  storedKey;
  setMeta(name, value) {
    this.sql.all(
      "INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value",
      name,
      value
    );
  }
  get cursor() {
    return this.seq;
  }
  get key() {
    return this.storedKey;
  }
  replaceKey(next, expected) {
    if (this.storedKey !== expected) {
      return false;
    }
    this.setMeta("key", next);
    this.storedKey = next;
    return true;
  }
  get size() {
    return this.count;
  }
  push(changes, now) {
    const outcome = this.sql.transaction(() => {
      let { seq } = this;
      let added = 0;
      const results = changes.map((change) => {
        const key = recordKey(change);
        const row = this.sql.all(
          "SELECT h, d FROM records WHERE key = ?",
          key
        )[0];
        const current = row ? { h: String(row.h), d: String(row.d) } : void 0;
        const result = pushResult(change, current, this.purgedH, now);
        if (result === "applied") {
          seq += 1;
          added += current ? 0 : 1;
          this.sql.all(
            `INSERT INTO records (key, seq, h, d, deleted, change) VALUES (?, ?, ?, ?, ?, ?)
						ON CONFLICT (key) DO UPDATE SET seq = excluded.seq, h = excluded.h, d = excluded.d,
							deleted = excluded.deleted, change = excluded.change`,
            key,
            seq,
            change.h,
            change.d,
            change.deleted ? 1 : 0,
            JSON.stringify(change)
          );
        }
        return result;
      });
      if (seq !== this.seq) {
        this.setMeta("seq", String(seq));
      }
      if (added > 0) {
        this.setMeta("count", String(this.count + added));
      }
      return { results, seq, added };
    });
    this.seq = outcome.seq;
    this.count += outcome.added;
    return outcome.results;
  }
  pull(cursor, limit, seen = 0) {
    if (mustResync(cursor, seen, this.purgedSeq)) {
      return { resync: true };
    }
    const rows = this.sql.all(
      "SELECT seq, change FROM records WHERE seq > ? ORDER BY seq LIMIT ?",
      cursor,
      limit + 1
    );
    const page = rows.slice(0, limit);
    return {
      resync: false,
      changes: page.flatMap((row) => readChange(row) ?? []),
      cursor: page.length > 0 ? numberOf(page.at(-1).seq) : this.seq,
      more: rows.length > limit,
      purged: this.purgedSeq
    };
  }
  purge(before) {
    const purged = this.sql.transaction(() => {
      const rows = this.sql.all(
        "DELETE FROM records WHERE deleted = 1 AND h < ? RETURNING seq, h",
        stampAt(before)
      );
      let seq = this.purgedSeq;
      let h = this.purgedH;
      for (const row of rows) {
        seq = Math.max(seq, numberOf(row.seq));
        if (String(row.h) > h) {
          h = String(row.h);
        }
      }
      if (rows.length > 0) {
        this.setMeta("purgedSeq", String(seq));
        this.setMeta("purgedH", h);
        this.setMeta("count", String(this.count - rows.length));
      }
      return { removed: rows.length, seq, h };
    });
    if (purged.removed === 0) {
      return;
    }
    this.purgedSeq = purged.seq;
    this.purgedH = purged.h;
    this.count -= purged.removed;
    this.sql.compact?.();
  }
};
function readChange(row) {
  try {
    return parseChange(JSON.parse(String(row.change)));
  } catch {
    return void 0;
  }
}
__name(readChange, "readChange");

// src/worker.ts
var positive = /* @__PURE__ */ __name((raw2, fallback) => {
  const value = Number(raw2);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}, "positive");
var SyncLibrary = class extends DurableObject {
  static {
    __name(this, "SyncLibrary");
  }
  log;
  api;
  constructor(ctx, env) {
    super(ctx, env);
    const { storage } = ctx;
    this.log = new SqlChangeLog({
      all: /* @__PURE__ */ __name((query, ...parameters) => storage.sql.exec(query, ...parameters).toArray(), "all"),
      transaction: /* @__PURE__ */ __name((work) => storage.transactionSync(work), "transaction")
    });
    this.api = createApi({
      token: env.TABLODGE_SYNC_TOKEN ?? "",
      log: /* @__PURE__ */ __name(() => this.log, "log"),
      limits: {
        maxRecords: positive(env.MAX_RECORDS, DEFAULT_LIMITS.maxRecords),
        retentionDays: positive(
          env.RETENTION_DAYS,
          DEFAULT_LIMITS.retentionDays
        ),
        requestsPerMinute: positive(
          env.RATE_LIMIT_PER_MINUTE,
          DEFAULT_LIMITS.requestsPerMinute
        )
      },
      onApplied(cursor) {
        for (const socket of ctx.getWebSockets()) {
          if (socket.deserializeAttachment()?.authenticated) {
            socket.send(cursorMessage(cursor));
          }
        }
      }
    });
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(LIVE_PING, LIVE_PONG)
    );
  }
  async fetch(request) {
    if (new URL(request.url).pathname !== LIVE_PATH) {
      return this.api.fetch(request);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= LIVE_MAX_SOCKETS) {
      return new Response("Too many connections", { status: 503 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({
      authenticated: false,
      openedAt: Date.now()
    });
    if (await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(Date.now() + LIVE_AUTH_TIMEOUT_MS);
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async alarm() {
    const now = Date.now();
    let waiting = false;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment?.authenticated) {
        continue;
      }
      if (now - (attachment?.openedAt ?? 0) >= LIVE_AUTH_TIMEOUT_MS) {
        socket.close(LIVE_UNAUTHORIZED, "unauthorized");
      } else {
        waiting = true;
      }
    }
    if (waiting) {
      await this.ctx.storage.setAlarm(now + LIVE_AUTH_TIMEOUT_MS);
    }
  }
  async webSocketMessage(socket, message) {
    if (socket.deserializeAttachment()?.authenticated) {
      return;
    }
    if (isAuthMessage(message, this.env.TABLODGE_SYNC_TOKEN ?? "")) {
      socket.serializeAttachment({
        authenticated: true,
        openedAt: 0
      });
      socket.send(readyMessage(this.log.cursor));
    } else {
      socket.close(LIVE_UNAUTHORIZED, "unauthorized");
    }
  }
};
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const space = url.pathname === PRIVATE_PREFIX || url.pathname.startsWith(`${PRIVATE_PREFIX}/`) ? "private" : "default";
    if (space === "private") {
      url.pathname = url.pathname.slice(PRIVATE_PREFIX.length) || "/";
    }
    const { pathname } = url;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (pathname === "/health") {
      return Response.json({ ok: true }, { headers: CORS_HEADERS });
    }
    const token = env.TABLODGE_SYNC_TOKEN ?? "";
    if (token.length < MIN_TOKEN_LENGTH) {
      return Response.json(
        { error: "not_configured" },
        { status: 503, headers: CORS_HEADERS }
      );
    }
    if (pathname !== LIVE_PATH) {
      const given = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";
      if (!sameToken(given, token)) {
        return Response.json(
          { error: "unauthorized" },
          { status: 401, headers: CORS_HEADERS }
        );
      }
    }
    return env.LIBRARY.get(env.LIBRARY.idFromName(space)).fetch(
      space === "default" ? request : new Request(url, request)
    );
  }
};
export {
  SyncLibrary,
  worker_default as default
};
