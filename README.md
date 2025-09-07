# MikroTik RouterOS Node.js Client

A Node.js client for MikroTik RouterOS API with automatic parameter detection and response parsing.

## Features

- ✅ **Automatic Parameter Detection** - No need to specify query vs command format
- ✅ **Loops Until `!done`** - Handles multi-packet responses automatically
- ✅ **Error Handling** - Proper `!trap` and `!fatal` error handling
- ✅ **Parsed Responses** - Returns clean JavaScript objects
- ✅ **Full CRUD Operations** - Create, Read, Update, Delete users
- ✅ **User Disconnection** - Disconnect active PPPoE sessions
- ✅ **Environment Variables** - Secure credential management

## Installation

```bash
npm install
```

## Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` with your MikroTik settings:
```env
# MikroTik RouterOS Connection Settings
MIKROTIK_HOST=192.168.1.1
MIKROTIK_PORT=8728
MIKROTIK_USERNAME=admin
MIKROTIK_PASSWORD=your_password_here

# Test User Settings
TEST_USER_NAME=testUser
TEST_USER_PASSWORD=testPassword
TEST_USER_PROFILE=default
```

## Usage

### Run Tests
```bash
npm test
# or
npm start
# or
node test.js
```

### Use as Library
```javascript
const { RouterOSClient } = require('./index.js');

const client = new RouterOSClient("192.168.1.1", 8728);
await client.connect();
await client.login("admin", "password");

// Query operations (automatically uses ? format)
const users = await client.writeCommand("/ppp/secret/print", { name: "user1" });

// Command operations (automatically uses = format)
const result = await client.writeCommand("/ppp/secret/add", {
  name: "newuser",
  password: "password123",
  profile: "default"
});

// Update operations
await client.writeCommand("/ppp/secret/set", {
  ".id": "*123",
  password: "newpassword"
});

// Delete operations
await client.writeCommand("/ppp/secret/remove", { ".id": "*123" });

// Disconnect active users
await client.writeCommand("/ppp/active/remove", { ".id": "*456" });

client.close();
```

## API Reference

### RouterOSClient

#### Constructor
```javascript
new RouterOSClient(host, port = 8728)
```

#### Methods

- `connect()` - Connect to RouterOS
- `login(username, password)` - Authenticate with RouterOS
- `writeCommand(command, params = {})` - Execute command and return parsed objects
- `close()` - Close connection

#### Automatic Parameter Detection

The client automatically detects the correct parameter format:

| Command Type | Example | Parameter Format |
|-------------|---------|------------------|
| **Query/Print** | `/ppp/secret/print` | `?name=value` |
| **Login** | `/login` | `=name=value` |
| **Commands** | `/ppp/secret/add` | `=name=value` |

## Error Handling

```javascript
try {
  const result = await client.writeCommand("/ppp/secret/add", {...});
} catch (error) {
  console.error("RouterOS Error:", error.message);
  // Error: RouterOS Error: failure: secret with the same name already exists
}
```

## Test Suite

The test suite demonstrates:

1. **CREATE** - Add new PPPoE secret user
2. **READ** - Query user by name
3. **UPDATE** - Modify user password and comment
4. **DELETE** - Remove user
5. **DISCONNECT** - Disconnect active user and verify

## Requirements

- Node.js 12.0.0 or higher
- Access to MikroTik RouterOS with API enabled

## License

ISC
