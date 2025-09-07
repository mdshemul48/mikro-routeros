require("dotenv").config();
const { RouterOSClient } = require("./index.js");

(async () => {
  // Get connection settings from environment variables
  const host = process.env.MIKROTIK_HOST || "192.168.1.1";
  const port = parseInt(process.env.MIKROTIK_PORT) || 8728;
  const username = process.env.MIKROTIK_USERNAME || "admin";
  const password = process.env.MIKROTIK_PASSWORD || "password";
  const testUserName = process.env.TEST_USER_NAME || "testUser";
  const testUserPassword = process.env.TEST_USER_PASSWORD || "testPassword";
  const testUserProfile = process.env.TEST_USER_PROFILE || "default";

  console.log(`🔌 Connecting to MikroTik at ${host}:${port}`);
  const client = new RouterOSClient(host, port);

  try {
    await client.connect();
    console.log("✅ Connected to RouterOS");

    await client.login(username, password);
    console.log(`✅ Logged in successfully as ${username}`);

    // 1. CREATE - Add new user
    console.log("\n--- 1. CREATING new user ---");
    try {
      const addResult = await client.runQuery("/ppp/secret/add", {
        name: testUserName,
        password: testUserPassword,
        profile: testUserProfile,
        service: "pppoe",
        comment: "Test user for CRUD operations",
      });
      console.log("✅ User created:", JSON.stringify(addResult, null, 2));
    } catch (error) {
      console.error("❌ Create error:", error.message);
    }

    // 2. READ - Query the user we just created
    console.log("\n--- 2. READING user ---");
    try {
      const users = await client.runQuery("/ppp/secret/print", {
        name: testUserName,
      });
      console.log("✅ User found:", JSON.stringify(users, null, 2));
    } catch (error) {
      console.error("❌ Read error:", error.message);
    }

    // 3. UPDATE - Modify the user
    console.log("\n--- 3. UPDATING user ---");
    try {
      // First get the user's ID
      const users = await client.runQuery("/ppp/secret/print", {
        name: testUserName,
      });

      if (users.length > 0) {
        const userId = users[0][".id"];
        const updateResult = await client.runQuery("/ppp/secret/set", {
          ".id": userId,
          password: "newPassword123",
          comment: "Updated test user",
        });
        console.log("✅ User updated:", JSON.stringify(updateResult, null, 2));
      } else {
        console.log("❌ User not found for update");
      }
    } catch (error) {
      console.error("❌ Update error:", error.message);
    }

    // 4. READ again - Verify the update
    console.log("\n--- 4. READING updated user ---");
    try {
      const users = await client.runQuery("/ppp/secret/print", {
        name: testUserName,
      });
      console.log("✅ Updated user:", JSON.stringify(users, null, 2));
    } catch (error) {
      console.error("❌ Read error:", error.message);
    }

    // 5. DELETE - Remove the user
    console.log("\n--- 5. DELETING user ---");
    try {
      // First get the user's ID
      const users = await client.runQuery("/ppp/secret/print", {
        name: testUserName,
      });

      if (users.length > 0) {
        const userId = users[0][".id"];
        const deleteResult = await client.runQuery("/ppp/secret/remove", {
          ".id": userId,
        });
        console.log("✅ User deleted:", JSON.stringify(deleteResult, null, 2));
      } else {
        console.log("❌ User not found for deletion");
      }
    } catch (error) {
      console.error("❌ Delete error:", error.message);
    }

    // 6. READ final - Verify deletion
    console.log("\n--- 6. VERIFYING deletion ---");
    try {
      const users = await client.runQuery("/ppp/secret/print", {
        name: testUserName,
      });
      if (users.length === 0) {
        console.log("✅ User successfully deleted - not found");
      } else {
        console.log("❌ User still exists after deletion");
      }
    } catch (error) {
      console.error("❌ Verification error:", error.message);
    }

    // 7. DISCONNECT TEST - Find and disconnect an active user
    console.log("\n--- 7. DISCONNECT TEST ---");
    try {
      // First, find active users
      console.log("Finding active users...");
      const activeUsers = await client.runQuery("/ppp/active/print");
      console.log(`Found ${activeUsers.length} active users`);

      if (activeUsers.length > 0) {
        const userToDisconnect = activeUsers[0];
        console.log(
          `Disconnecting user: ${userToDisconnect.name} (${userToDisconnect.address})`
        );

        // Disconnect the user
        const disconnectResult = await client.runQuery("/ppp/active/remove", {
          ".id": userToDisconnect[".id"],
        });
        console.log(
          "✅ Disconnect command sent:",
          JSON.stringify(disconnectResult, null, 2)
        );

        // Wait a moment for disconnection to process
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Check if user is still active
        console.log("Checking if user is still connected...");
        const stillActive = await client.runQuery("/ppp/active/print", {
          name: userToDisconnect.name,
        });

        if (stillActive.length === 0) {
          console.log(
            "✅ User successfully disconnected - no longer in active list"
          );
        } else {
          console.log("❌ User still appears to be connected");
          console.log("Current status:", JSON.stringify(stillActive, null, 2));
        }
      } else {
        console.log("ℹ️ No active users found to disconnect");
      }
    } catch (error) {
      console.error("❌ Disconnect test error:", error.message);
    }
  } catch (error) {
    console.error("❌ Connection/Login error:", error.message);
  } finally {
    client.close();
    console.log("\n✅ Connection closed");
  }
})();
