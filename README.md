# MikroTik API (RouterOS) Client for Node.js

Node.js client for the MikroTik RouterOS API. Simple, fast, and lightweight with automatic parameter detection and parsed responses. Ideal for PPPoE, Hotspot, Firewall, Wireless, and general RouterOS automation.

## Features

- ✅ **Automatic parameter detection** for RouterOS commands (query vs action)
- ✅ **Streams until `!done`** to handle multi-packet MikroTik API responses
- ✅ **Proper error handling** for `!trap` and `!fatal`
- ✅ **Parsed responses** into clean JavaScript objects
- ✅ **Covers PPPoE, Hotspot, Firewall, Wireless** and more

## Installation

```bash
npm install mikro-routeros
```

## Quick start

```javascript
const { RouterOSClient } = require('mikro-routeros');

async function main() {
  const client = new RouterOSClient('192.168.88.1', 8728); // API port: 8728
  await client.connect();
  await client.login('admin', 'password');

  const users = await client.runQuery('/ppp/secret/print', { name: 'user1' });
  console.log(users);

  await client.close();
}

main().catch(console.error);
```

## Usage

### Run tests (optional)
```bash
npm test
```

### Library examples
```javascript
const { RouterOSClient } = require('mikro-routeros');

const client = new RouterOSClient('192.168.88.1', 8728);
await client.connect();
await client.login('admin', 'password');

// PPPoE users (query uses ?-prefixed params)
const users = await client.runQuery('/ppp/secret/print', { name: 'user1' });

// Add PPPoE secret (action uses =-prefixed params)
await client.runQuery('/ppp/secret/add', {
  name: 'newuser',
  password: 'password123',
  profile: 'default',
  service: 'pppoe'
});

// Update user
await client.runQuery('/ppp/secret/set', {
  '.id': '*123',
  password: 'newpassword'
});

// Delete user
await client.runQuery('/ppp/secret/remove', { '.id': '*123' });

// Disconnect active user
await client.runQuery('/ppp/active/remove', { '.id': '*456' });

await client.close();
```

### More MikroTik API examples
```javascript
// Firewall rules
await client.runQuery('/ip/firewall/filter/print');

// Hotspot users
await client.runQuery('/ip/hotspot/user/print');

// Wireless registration table
await client.runQuery('/interface/wireless/registration-table/print');

// Get system identity
await client.runQuery('/system/identity/print');
```

## API reference

### RouterOSClient

#### Constructor
```javascript
new RouterOSClient(host, port = 8728)
```

#### Methods

- `connect()` - Connect to RouterOS API (TCP)
- `login(username, password)` - Authenticate with RouterOS
- `runQuery(command, params = {})` - Execute command and return parsed objects
- `close()` - Close connection

TypeScript typings are included via `index.d.ts`.

## Error handling

```javascript
try {
  const result = await client.runQuery("/ppp/secret/add", {...});
} catch (error) {
  console.error("RouterOS Error:", error.message);
  // Error: RouterOS Error: failure: secret with the same name already exists
}
```

## Test suite

The test suite demonstrates:

1. **CREATE** - Add new PPPoE secret user
2. **READ** - Query user by name
3. **UPDATE** - Modify user password and comment
4. **DELETE** - Remove user
5. **DISCONNECT** - Disconnect active user and verify

Run locally:
```bash
npm start
```

## Requirements

- Node.js 12.0.0 or higher
- Access to MikroTik RouterOS with API enabled

Notes:
- RouterOS API default ports: 8728 (plain TCP), 8729 (TLS). This client uses TCP.
- Works with RouterOS v6/v7 command paths.

## Links

- MikroTik RouterOS API docs: [help.mikrotik.com/docs/display/ROS/API](https://help.mikrotik.com/docs/display/ROS/API)
- RouterOS command reference: [wiki.mikrotik.com/wiki/Manual:TOC](https://wiki.mikrotik.com/wiki/Manual:TOC)

## License

ISC
