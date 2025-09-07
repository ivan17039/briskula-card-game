// SupabaseGameStateManager.js - Game state management with Supabase PostgreSQL (ESM)

import { createClient } from "@supabase/supabase-js";

class SupabaseGameStateManager {
  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Server-side key

    if (!this.supabaseUrl || !this.supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables for server");
    }

    this.supabase = createClient(this.supabaseUrl, this.supabaseServiceKey);
    this.autoSaveInterval = 30000; // 30 sekundi

    this.initializeTables();
    this.startAutoSave();
  }

  /**
   * Initialize database tables if they don't exist
   */
  async initializeTables() {
    try {
      // Tables should be created manually via Supabase SQL Editor
      // using the provided supabase-setup.sql script
      console.log("✅ Supabase tables ready");
    } catch (error) {
      console.error("Error initializing Supabase tables:", error);
    }
  }

  /**
   * Save game state to Supabase
   */
  async saveGameState(roomId, gameData) {
    try {
      const gameState = {
        room_id: roomId,
        game_mode: gameData.gameMode,
        game_type: gameData.gameType,
        players: gameData.players.map((p) => ({
          id: p.id,
          name: p.name,
          userId: p.userId,
          isGuest: p.isGuest,
          playerNumber: p.playerNumber,
          team: p.team,
          isConnected: p.isConnected,
          disconnectedAt: p.disconnectedAt,
        })),
        game_state: {
          ...gameData.gameState,
          lastMove: new Date().toISOString(),
          version: Date.now(),
        },
        created_at: gameData.createdAt,
        last_saved: new Date().toISOString(),
        expires_at: this.getGameExpiration(gameData.gameState.gamePhase),
      };

      const { error } = await this.supabase
        .from("game_states")
        .upsert(gameState, { onConflict: "room_id" });

      if (error) {
        console.error(
          `Error saving game state to Supabase for ${roomId}:`,
          error
        );
        return false;
      }

      console.log(`💾 Game state saved to Supabase: ${roomId}`);
      return true;
    } catch (error) {
      console.error(
        `Error saving game state to Supabase for ${roomId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Get appropriate expiration time based on game phase
   */
  getGameExpiration(gamePhase) {
    const now = Date.now();

    switch (gamePhase) {
      case "playing":
        // Active games - keep for 4 hours for reconnections
        return new Date(now + 4 * 60 * 60 * 1000).toISOString();

      case "finished":
        // Finished games - keep for 1 hour for final score viewing
        return new Date(now + 1 * 60 * 60 * 1000).toISOString();

      case "interrupted":
        // Interrupted games - keep for 2 hours for potential recovery
        return new Date(now + 2 * 60 * 60 * 1000).toISOString();

      default:
        // Default - 24 hours
        return new Date(now + 24 * 60 * 60 * 1000).toISOString();
    }
  }

  /**
   * Load game state from Supabase
   */
  async loadGameState(roomId) {
    try {
      const { data, error } = await this.supabase
        .from("game_states")
        .select("*")
        .eq("room_id", roomId)
        .single();

      if (error) {
        if (error.code !== "PGRST116") {
          // Not found error
          console.error(
            `Error loading game state from Supabase for ${roomId}:`,
            error
          );
        }
        return null;
      }

      if (data) {
        console.log(`📖 Game state loaded from Supabase: ${roomId}`);
        return this.convertFromSupabaseFormat(data);
      }

      return null;
    } catch (error) {
      console.error(
        `Error loading game state from Supabase for ${roomId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Delete game state from Supabase
   */
  async deleteGameState(roomId) {
    try {
      const { error } = await this.supabase
        .from("game_states")
        .delete()
        .eq("room_id", roomId);

      if (error) {
        console.error(
          `Error deleting game state from Supabase for ${roomId}:`,
          error
        );
        return false;
      }

      console.log(`🗑️ Game state deleted from Supabase: ${roomId}`);
      return true;
    } catch (error) {
      console.error(
        `Error deleting game state from Supabase for ${roomId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Check if game exists and is active
   */
  async gameExists(roomId) {
    try {
      const { data, error } = await this.supabase
        .from("game_states")
        .select("created_at, expires_at")
        .eq("room_id", roomId)
        .single();

      if (error || !data) return false;

      // Check if game has expired
      const now = new Date();
      const expiresAt = new Date(data.expires_at);

      if (now > expiresAt) {
        console.log(`⏰ Game ${roomId} has expired, deleting...`);
        await this.deleteGameState(roomId);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Error checking game existence for ${roomId}:`, error);
      return false;
    }
  }

  /**
   * Find user games
   */
  async findUserGames(userId, userName, isGuest) {
    try {
      let query = this.supabase.from("game_states").select("*");

      if (isGuest) {
        // For guests, search by name in players array
        query = query.contains("players", [{ name: userName, isGuest: true }]);
      } else {
        // For registered users, search by userId
        query = query.contains("players", [{ userId: userId, isGuest: false }]);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error finding user games:", error);
        return [];
      }

      return data.map((game) => {
        const playerInGame = game.players.find((p) => {
          if (isGuest) {
            return p.name === userName && p.isGuest;
          } else {
            return p.userId === userId && !p.isGuest;
          }
        });

        return {
          roomId: game.room_id,
          gameMode: game.game_mode,
          gameType: game.game_type,
          playerNumber: playerInGame?.playerNumber,
          lastSaved: game.last_saved,
          createdAt: game.created_at,
        };
      });
    } catch (error) {
      console.error("Error finding user games:", error);
      return [];
    }
  }

  /**
   * Restore game with merge logic
   */
  async restoreGame(roomId, currentGameRoom = null) {
    const savedState = await this.loadGameState(roomId);
    if (!savedState) return null;

    // Convert saved state to server format
    const restoredGame = {
      id: savedState.roomId,
      gameMode: savedState.gameMode,
      gameType: savedState.gameType,
      players: savedState.players.map((p) => {
        // Check if player still exists in current room
        let currentPlayer = null;
        if (currentGameRoom) {
          currentPlayer = currentGameRoom.players.find(
            (cp) =>
              (cp.userId === p.userId && !p.isGuest) ||
              (cp.name === p.name && p.isGuest)
          );
        }

        return {
          ...p,
          isConnected: currentPlayer ? currentPlayer.isConnected : false,
          id: currentPlayer ? currentPlayer.id : null,
          disconnectedAt:
            currentPlayer && currentPlayer.isConnected
              ? null
              : p.disconnectedAt || new Date(),
        };
      }),
      gameState: savedState.gameState,
      createdAt: new Date(savedState.createdAt),
      restored: true,
      restoredAt: new Date(),
      ...(currentGameRoom && {
        disconnectTimeouts: currentGameRoom.disconnectTimeouts,
      }),
    };

    console.log(
      `🔄 Game restored from Supabase: ${roomId} with ${
        restoredGame.players.filter((p) => p.isConnected).length
      } connected players`
    );
    return restoredGame;
  }

  /**
   * Mark game as finished and schedule cleanup
   */
  async markGameAsFinished(roomId) {
    try {
      const now = new Date();
      const finishedExpiresAt = new Date(now.getTime() + 1 * 60 * 60 * 1000); // 1 hour

      // First, get the current game state
      const { data: currentData, error: fetchError } = await this.supabase
        .from("game_states")
        .select("game_state")
        .eq("room_id", roomId)
        .single();

      if (fetchError) {
        console.error(`Error fetching game state for ${roomId}:`, fetchError);
        return false;
      }

      if (!currentData || !currentData.game_state) {
        console.error(`No game state found for ${roomId}`);
        return false;
      }

      // Update the gamePhase in the game state
      const updatedGameState = {
        ...currentData.game_state,
        gamePhase: "finished",
      };

      // Update the record with the modified game state
      const { error } = await this.supabase
        .from("game_states")
        .update({
          expires_at: finishedExpiresAt.toISOString(),
          game_state: updatedGameState,
          last_saved: now.toISOString(),
        })
        .eq("room_id", roomId);

      if (error) {
        console.error(`Error marking game as finished for ${roomId}:`, error);
        return false;
      }

      console.log(`🏁 Game marked as finished: ${roomId} (expires in 1 hour)`);
      return true;
    } catch (error) {
      console.error(`Error marking game as finished for ${roomId}:`, error);
      return false;
    }
  }

  /**
   * Convert Supabase format to internal format
   */
  convertFromSupabaseFormat(data) {
    return {
      roomId: data.room_id,
      gameMode: data.game_mode,
      gameType: data.game_type,
      players: data.players,
      gameState: data.game_state,
      createdAt: data.created_at,
      lastSaved: data.last_saved,
    };
  }

  /**
   * Get statistics
   */
  async getStats() {
    try {
      const { count: totalGames } = await this.supabase
        .from("game_states")
        .select("*", { count: "exact", head: true });

      const { count: activeGames } = await this.supabase
        .from("game_states")
        .select("*", { count: "exact", head: true })
        .eq("game_state->>gamePhase", "playing");

      return {
        totalGames: totalGames || 0,
        activeGames: activeGames || 0,
        autoSaveInterval: this.autoSaveInterval,
      };
    } catch (error) {
      console.error("Error getting Supabase stats:", error);
      return { totalGames: 0, activeGames: 0 };
    }
  }

  /**
   * Remove finished status from game to prevent auto-deletion
   */
  async removeFinishedStatus(roomId) {
    try {
      // Reset expires_at to standard TTL (24 hours) for active games
      const now = new Date();
      const activeExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

      const { error } = await this.supabase
        .from("game_states")
        .update({
          expires_at: activeExpiresAt.toISOString(),
          last_saved: now.toISOString(),
        })
        .eq("room_id", roomId);

      if (error) {
        console.error(`Error removing finished status for ${roomId}:`, error);
        return false;
      }

      console.log(`🔄 Finished status removed for ${roomId} - game continues`);
      return true;
    } catch (error) {
      console.error(`Error removing finished status for ${roomId}:`, error);
      return false;
    }
  }

  startAutoSave() {
    setInterval(async () => {
      try {
        // Cleanup expired games
        const { error } = await this.supabase
          .from("game_states")
          .delete()
          .lt("expires_at", new Date().toISOString());

        if (error) {
          console.error("Error cleaning up expired games:", error);
        }

        // Log current stats
        const stats = await this.getStats();
        console.log(
          `📊 Supabase Games: ${stats.activeGames} active, ${stats.totalGames} total`
        );
      } catch (error) {
        console.error("Error in auto-save:", error);
      }
    }, this.autoSaveInterval);
  }
}

export default SupabaseGameStateManager;
