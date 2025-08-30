// ManagerFactory.js - Factory for creating session and game state managers with fallback (ESM)

import InMemorySessionManager from "./InMemorySessionManager.js";
import InMemoryGameStateManager from "./InMemoryGameStateManager.js";

class ManagerFactory {
  /**
   * Create session manager with fallback to in-memory
   */
  static async createSessionManager() {
    // Check if Supabase environment variables are available
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const module = await import("./SupabaseSessionManager.js");
        const SupabaseSessionManager = module.default;
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
  static async createGameStateManager() {
    // Check if Supabase environment variables are available
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const module = await import("./SupabaseGameStateManager.js");
        const SupabaseGameStateManager = module.default;
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

export default ManagerFactory;
