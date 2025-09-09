const net = require("net");

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
    this.socket = new net.Socket();
    this.socket.setKeepAlive(true);
    this.buffer = Buffer.alloc(0);
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
    const responses = await this.runQuery("/login", {
      name: username,
      password,
    });
    return responses; // Login doesn't need parsing, just return raw for success/failure
  }

  runQuery(cmd, params = {}) {
    return new Promise((resolve, reject) => {
      // Auto-detect if this is a query command or action command
      const isQuery =
        cmd.includes("/print") ||
        cmd.includes("/monitor") ||
        cmd.includes("/getall");
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
        Object.entries(params).map(([k, v]) => `${paramPrefix}${k}=${v}`)
      );
      const data = Buffer.concat(
        parts.map(encodeWord).concat([Buffer.from([0])])
      );

      this.socket.write(data);

      const responses = [];
      let done = false;

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
            // Collect any final data from this sentence
            if (sentence.length > 1) {
              responses.push(sentence);
            }
          } else if (sentenceType === "!re") {
            responses.push(sentence);
          } else if (sentenceType === "!trap") {
            this.socket.removeListener("data", onData);
            this.socket.removeListener("error", onError);
            // Extract error message from trap response
            const errorMessage =
              sentence
                .slice(1)
                .find((item) => item.startsWith("=message="))
                ?.slice(9) || "Unknown error";
            reject(new Error(`RouterOS Error: ${errorMessage}`));
            return;
          } else if (sentenceType === "!fatal") {
            this.socket.removeListener("data", onData);
            this.socket.removeListener("error", onError);
            reject(
              new Error(`RouterOS Fatal Error: ${sentence.slice(1).join(" ")}`)
            );
            return;
          }
        }

        // If we received !done, resolve with all accumulated responses
        if (done) {
          this.socket.removeListener("data", onData);
          this.socket.removeListener("error", onError);
          // Parse responses to objects before resolving
          resolve(parseResponseToObjects(responses));
        }
      };

      const onError = (error) => {
        this.socket.removeListener("data", onData);
        this.socket.removeListener("error", onError);
        reject(error);
      };

      this.socket.on("data", onData);
      this.socket.on("error", onError);
    });
  }

  close() {
    this.socket.end();
  }
}

// Export the RouterOSClient class for use in other files
module.exports = { RouterOSClient };
