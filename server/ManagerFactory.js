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
        return new SupabaseSessionManager();
      } catch (error) {
        console.warn(
          "⚠️ Failed to initialize Supabase Session Manager, falling back to InMemory:",
          error.message
        );
        return new InMemorySessionManager();
      }
    } else {
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
        return new SupabaseGameStateManager();
      } catch (error) {
        console.warn(
          "⚠️ Failed to initialize Supabase Game State Manager, falling back to InMemory:",
          error.message
        );
        return new InMemoryGameStateManager();
      }
    } else {
      return new InMemoryGameStateManager();
    }
  }
}

export default ManagerFactory;
