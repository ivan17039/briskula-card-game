// ManagerFactory.js - Factory for creating Supabase managers

const SupabaseSessionManager = require("./SupabaseSessionManager");
const SupabaseGameStateManager = require("./SupabaseGameStateManager");

class ManagerFactory {
  /**
   * Create session manager (Supabase only)
   */
  static createSessionManager() {
    console.log("🟢 Using Supabase Session Manager");
    return new SupabaseSessionManager();
  }

  /**
   * Create game state manager (Supabase only)
   */
  static createGameStateManager() {
    console.log("🟢 Using Supabase Game State Manager");
    return new SupabaseGameStateManager();
  }
}

module.exports = ManagerFactory;
