// ManagerFactory.js - Factory for creating session and game state managers with fallback

const InMemorySessionManager = require("./InMemorySessionManager");
const InMemoryGameStateManager = require("./InMemoryGameStateManager");

class ManagerFactory {
  /**
   * Create session manager with fallback to in-memory
   */
  static createSessionManager() {
    // Check if Supabase environment variables are available
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const SupabaseSessionManager = require("./SupabaseSessionManager");
        console.log("🟢 Using Supabase Session Manager");
        return new SupabaseSessionManager();
      } catch (error) {
        console.warn(
          "⚠️ Failed to initialize Supabase Session Manager, falling back to InMemory:",
          error.message
        );
        console.log("🔄 Using InMemory Session Manager");
        return new InMemorySessionManager();
      }
    } else {
      console.log("🔄 Using InMemory Session Manager (no Supabase env vars)");
      return new InMemorySessionManager();
    }
  }

  /**
   * Create game state manager with fallback to in-memory
   */
  static createGameStateManager() {
    // Check if Supabase environment variables are available
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const SupabaseGameStateManager = require("./SupabaseGameStateManager");
        console.log("🟢 Using Supabase Game State Manager");
        return new SupabaseGameStateManager();
      } catch (error) {
        console.warn(
          "⚠️ Failed to initialize Supabase Game State Manager, falling back to InMemory:",
          error.message
        );
        console.log("🔄 Using InMemory Game State Manager");
        return new InMemoryGameStateManager();
      }
    } else {
      console.log(
        "🔄 Using InMemory Game State Manager (no Supabase env vars)"
      );
      return new InMemoryGameStateManager();
    }
  }
}

module.exports = ManagerFactory;
