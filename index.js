const net = require("net");
const crypto = require("crypto");

function encodeLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) return Buffer.from([(len >> 8) | 0x80, len & 0xff]);
  if (len < 0x200000)
    return Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
  if (len < 0x10000000)
    return Buffer.from([
      (len >> 24) | 0xe0,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
    ]);
  return Buffer.from([
    0xf0,
    (len >> 24) & 0xff,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
  ]);
}

function encodeWord(word) {
  const wordBuf = Buffer.from(word, "utf8");
  return Buffer.concat([encodeLength(wordBuf.length), wordBuf]);
}

function decodeLength(buffer, offset = 0) {
  if (offset >= buffer.length) return null;

  const firstByte = buffer[offset];

  if ((firstByte & 0x80) === 0) {
    // Length is 0-127, single byte
    return { length: firstByte, bytesUsed: 1 };
  } else if ((firstByte & 0xc0) === 0x80) {
    // Length is 128-16383, two bytes
    if (offset + 1 >= buffer.length) return null;
    const length = ((firstByte & 0x3f) << 8) | buffer[offset + 1];
    return { length, bytesUsed: 2 };
  } else if ((firstByte & 0xe0) === 0xc0) {
    // Length is 16384-2097151, three bytes
    if (offset + 2 >= buffer.length) return null;
    const length =
      ((firstByte & 0x1f) << 16) |
      (buffer[offset + 1] << 8) |
      buffer[offset + 2];
    return { length, bytesUsed: 3 };
  } else if ((firstByte & 0xf0) === 0xe0) {
    // Length is 2097152-268435455, four bytes
    if (offset + 3 >= buffer.length) return null;
    const length =
      ((firstByte & 0x0f) << 24) |
      (buffer[offset + 1] << 16) |
      (buffer[offset + 2] << 8) |
      buffer[offset + 3];
    return { length, bytesUsed: 4 };
  } else if (firstByte === 0xf0) {
    // Length is 268435456+, five bytes
    if (offset + 4 >= buffer.length) return null;
    const length =
      (buffer[offset + 1] << 24) |
      (buffer[offset + 2] << 16) |
      (buffer[offset + 3] << 8) |
      buffer[offset + 4];
    return { length, bytesUsed: 5 };
  }

  return null;
}

function parseSentences(buffer) {
  const sentences = [];
  let offset = 0;

  while (offset < buffer.length) {
    const sentence = [];

    // Parse words until we hit a zero-length word (sentence terminator)
    while (offset < buffer.length) {
      const lengthInfo = decodeLength(buffer, offset);
      if (!lengthInfo) break;

      offset += lengthInfo.bytesUsed;

      if (lengthInfo.length === 0) {
        // End of sentence
        break;
      }

      if (offset + lengthInfo.length > buffer.length) {
        // Incomplete word, return what we have so far
        return {
          sentences,
          remainingBuffer: buffer.slice(offset - lengthInfo.bytesUsed),
        };
      }

      const word = buffer
        .slice(offset, offset + lengthInfo.length)
        .toString("utf8");
      sentence.push(word);
      offset += lengthInfo.length;
    }

    if (sentence.length > 0) {
      sentences.push(sentence);
    }
  }

  return { sentences, remainingBuffer: Buffer.alloc(0) };
}

function parseResponseToObjects(responses) {
  return responses
    .filter((sentence) => sentence[0] === "!re") // Only process data replies
    .map((sentence) => {
      const obj = {};

      // Skip the first element ('!re') and process the rest
      sentence.slice(1).forEach((item) => {
        if (item.startsWith("=")) {
          const [key, ...valueParts] = item.slice(1).split("=");
          const value = valueParts.join("="); // Rejoin in case value contains '='
          obj[key] = value;
        }
      });

      return obj;
    });
}

class RouterOSClient {
  constructor(host, port = 8728, timeout = 30000) {
    this.host = host;
    this.port = port;
    this.timeout = timeout; // Connection timeout in milliseconds
    this.monitorTimeout = timeout * 2; // Longer timeout for monitor commands
    this.socket = new net.Socket();
    this.socket.setKeepAlive(true);
    this.socket.setNoDelay(true);
    this.buffer = Buffer.alloc(0);
    this.loggedIn = false;
    this.credentials = null; // { username, password }
  }

  connect() {
    return new Promise((resolve, reject) => {
      // Set connection timeout
      const timeoutId = setTimeout(() => {
        this.socket.destroy();
        reject(new Error(`Connection timeout after ${this.timeout}ms`));
      }, this.timeout);

      this.socket.connect(this.port, this.host, () => {
        clearTimeout(timeoutId);
        resolve();
      });

      this.socket.on("error", (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  async login(username, password) {
    // Persist credentials for automatic re-login
    this.credentials = { username, password };

    // 1) Try modern login (ROS >= 6.43): /login =name= =password=
    try {
      await this._sendRaw(
        "/login",
        { name: username, password },
        {
          requestTimeoutMs: this.timeout,
          collectAll: false,
          retryOnNotLoggedIn: false,
        }
      );
      this.loggedIn = true;
      return [];
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      // If credentials are invalid, don't attempt legacy flow
      if (
        /invalid user name or password|invalid username or password/i.test(
          message
        )
      ) {
        this.loggedIn = false;
        throw err;
      }
      // Fall through to attempt legacy challenge-response (ROS < 6.43)
    }

    // 2) Legacy login flow:
    //    a) Send /login (no params) → receive !done =ret=<hex-challenge>
    //    b) Send /login =name=<user> =response=00<md5(0x00 + password + challenge)>
    const probe = await this._sendRaw(
      "/login",
      {},
      {
        requestTimeoutMs: this.timeout,
        collectAll: true,
        retryOnNotLoggedIn: false,
      }
    );

    let challengeHex = null;
    for (const sentence of probe) {
      if (sentence[0] === "!done") {
        for (const item of sentence.slice(1)) {
          if (item.startsWith("=ret=")) {
            challengeHex = item.slice(5);
            break;
          }
        }
      }
      if (challengeHex) break;
    }

    if (!challengeHex) {
      throw new Error("RouterOS legacy login failed: no challenge received");
    }

    const challengeBuf = Buffer.from(challengeHex, "hex");
    const md5 = crypto.createHash("md5");
    md5.update(Buffer.from([0]));
    md5.update(Buffer.from(password, "utf8"));
    md5.update(challengeBuf);
    const response = "00" + md5.digest("hex");

    await this._sendRaw(
      "/login",
      { name: username, response },
      {
        requestTimeoutMs: this.timeout,
        collectAll: false,
        retryOnNotLoggedIn: false,
      }
    );

    this.loggedIn = true;
    return [];
  }

  runQuery(cmd, params = {}) {
    // Normalize the command path
    cmd = cmd.startsWith("/") ? cmd : "/" + cmd;

    // Special handling for monitor-traffic command
    const isMonitorCommand = cmd.includes("/monitor");
    const transformedParams = {};

    if (cmd.includes("monitor-traffic")) {
      // For monitor-traffic commands, use standard keys; encoding is handled later
      if (params.name || params.interface) {
        transformedParams["interface"] = params.name || params.interface;
      }
      transformedParams["once"] = ""; // Always use once for monitor-traffic
      if (params.proplist || params[".proplist"]) {
        transformedParams[".proplist"] = params.proplist || params[".proplist"]; // API uses .proplist
      }
    } else {
      // For non-monitor commands, pass keys as-is; encoding is handled in _sendRaw
      for (const [key, value] of Object.entries(params)) {
        transformedParams[key] = value;
      }
    }

    return this._sendRaw(cmd, transformedParams, {
      requestTimeoutMs: 5000, // Short timeout for monitor-traffic
      collectAll: false, // Don't collect all responses
      retryOnNotLoggedIn: true,
    }).then((responses) => {
      const result = parseResponseToObjects(responses);
      return result.length > 0 ? result : [];
    });
  }

  _sendRaw(cmd, params = {}, options = {}) {
    const isMonitorCommand = cmd.includes("/monitor");
    const {
      requestTimeoutMs = isMonitorCommand ? 5000 : this.timeout, // shorter timeout for monitor commands
      collectAll = false,
      retryOnNotLoggedIn = true,
    } = options;

    return new Promise((resolve, reject) => {
      // Auto-detect if this is a query command or action command
      const isQuery = cmd.includes("/print") || cmd.includes("/getall");
      const isLogin = cmd === "/login";

      let paramPrefix;
      if (isLogin) {
        paramPrefix = "="; // Login uses = format
      } else if (isQuery) {
        paramPrefix = "?"; // Print/query commands use ? format
      } else {
        paramPrefix = "="; // Add/set/remove commands use = format
      }

      const parts = [cmd].concat(
        Object.entries(params).map(([k, v]) => {
          const normalizedKey = String(k).replace(/^[=?]+/, "");
          const normalizedVal = v === undefined ? "" : v;
          return `${paramPrefix}${normalizedKey}=${normalizedVal}`;
        })
      );
      const data = Buffer.concat(
        parts.map(encodeWord).concat([Buffer.from([0])])
      );

      const cleanup = () => {
        if (requestTimer) clearTimeout(requestTimer);
        this.socket.removeListener("data", onData);
        this.socket.removeListener("error", onError);
        this.socket.removeListener("close", onClose);
        this.socket.removeListener("end", onEnd);
      };

      let settled = false;
      const responses = [];
      let done = false;

      const fulfill = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const requestTimer = setTimeout(() => {
        fail(new Error(`Request timeout after ${requestTimeoutMs}ms`));
      }, requestTimeoutMs);

      const onData = (chunk) => {
        // Append new data to buffer
        this.buffer = Buffer.concat([this.buffer, chunk]);

        // Parse complete sentences from buffer
        const parseResult = parseSentences(this.buffer);
        this.buffer = parseResult.remainingBuffer;

        // Process each sentence
        for (const sentence of parseResult.sentences) {
          if (sentence.length === 0) continue;

          const sentenceType = sentence[0];

          if (sentenceType === "!done") {
            done = true;
            if (collectAll && sentence.length > 0) {
              responses.push(sentence);
            } else if (sentence.length > 1) {
              responses.push(sentence);
            }
            // For monitor commands with responses, resolve immediately after !done
            if (cmd.includes("/monitor") && responses.length > 0) {
              fulfill(responses);
              return;
            }
          } else if (sentenceType === "!re") {
            responses.push(sentence);
            // For monitor commands with once parameter, resolve after first response
            if (cmd.includes("/monitor") && params["once"] !== undefined) {
              fulfill(responses);
              return;
            }
          } else if (sentenceType === "!trap") {
            // Extract error message from trap response
            const errorMessage =
              sentence
                .slice(1)
                .find((item) => item.startsWith("=message="))
                ?.slice(9) || "Unknown error";
            fail(new Error(`RouterOS Error: ${errorMessage}`));
            return;
          } else if (sentenceType === "!fatal") {
            const fatalMsg = sentence.slice(1).join(" ");
            // If not logged in and credentials exist, attempt auto re-login once
            if (
              retryOnNotLoggedIn &&
              /not logged in/i.test(fatalMsg) &&
              this.credentials &&
              !isLogin
            ) {
              // Pause handling and try to re-login then retry this command once
              cleanup();
              this.login(this.credentials.username, this.credentials.password)
                .then(() =>
                  this._sendRaw(cmd, params, {
                    requestTimeoutMs,
                    collectAll,
                    retryOnNotLoggedIn: false,
                  })
                )
                .then(fulfill, fail);
              return;
            }
            fail(new Error(`RouterOS Fatal Error: ${fatalMsg}`));
            return;
          }
        }

        if (done) {
          fulfill(responses);
        }
      };

      const onError = (error) => {
        fail(error);
      };
      const onClose = () => {
        fail(new Error("Socket closed"));
      };
      const onEnd = () => {
        fail(new Error("Socket ended"));
      };

      this.socket.on("data", onData);
      this.socket.on("error", onError);
      this.socket.on("close", onClose);
      this.socket.on("end", onEnd);

      this.socket.write(data);
    });
  }

  close() {
    this.socket.end();
  }
}

// Export the RouterOSClient class for use in other files
module.exports = { RouterOSClient };
