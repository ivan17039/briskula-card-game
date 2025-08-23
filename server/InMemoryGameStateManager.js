// InMemoryGameStateManager.js - Simple in-memory game state management for fallback

class InMemoryGameStateManager {
  constructor() {
    this.gameStates = new Map();
    this.autoSaveInterval = 30000; // 30 seconds
    console.log("✅ InMemory game state manager initialized");

    // Start cleanup interval
    this.startAutoSave();
  }

  async saveGameState(roomId, gameData) {
    try {
      const gameState = {
        roomId,
        gameMode: gameData.gameMode,
        gameType: gameData.gameType,
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
        gameState: {
          ...gameData.gameState,
          lastMove: new Date().toISOString(),
          version: Date.now(),
        },
        createdAt: gameData.createdAt,
        lastSaved: new Date().toISOString(),
        expiresAt: this.getGameExpiration(gameData.gameState.gamePhase),
      };

      this.gameStates.set(roomId, gameState);
      console.log(`💾 Game state saved to memory: ${roomId}`);
      return true;
    } catch (error) {
      console.error(`Error saving game state to memory for ${roomId}:`, error);
      return false;
    }
  }

  getGameExpiration(gamePhase) {
    const now = Date.now();

    switch (gamePhase) {
      case "playing":
        return new Date(now + 4 * 60 * 60 * 1000).toISOString(); // 4 hours
      case "finished":
        return new Date(now + 1 * 60 * 60 * 1000).toISOString(); // 1 hour
      case "interrupted":
        return new Date(now + 2 * 60 * 60 * 1000).toISOString(); // 2 hours
      default:
        return new Date(now + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
    }
  }

  async loadGameState(roomId) {
    try {
      const data = this.gameStates.get(roomId);
      if (!data) return null;

      // Check if expired
      const now = new Date();
      const expiresAt = new Date(data.expiresAt);
      if (now > expiresAt) {
        this.gameStates.delete(roomId);
        return null;
      }

      console.log(`📖 Game state loaded from memory: ${roomId}`);
      return {
        roomId: data.roomId,
        gameMode: data.gameMode,
        gameType: data.gameType,
        players: data.players,
        gameState: data.gameState,
        createdAt: data.createdAt,
        lastSaved: data.lastSaved,
      };
    } catch (error) {
      console.error(
        `Error loading game state from memory for ${roomId}:`,
        error
      );
      return null;
    }
  }

  async deleteGameState(roomId) {
    try {
      const deleted = this.gameStates.delete(roomId);
      if (deleted) {
        console.log(`🗑️ Game state deleted from memory: ${roomId}`);
      }
      return deleted;
    } catch (error) {
      console.error(
        `Error deleting game state from memory for ${roomId}:`,
        error
      );
      return false;
    }
  }

  async gameExists(roomId) {
    try {
      const data = this.gameStates.get(roomId);
      if (!data) return false;

      // Check if expired
      const now = new Date();
      const expiresAt = new Date(data.expiresAt);
      if (now > expiresAt) {
        this.gameStates.delete(roomId);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Error checking game existence for ${roomId}:`, error);
      return false;
    }
  }

  async findUserGames(userId, userName, isGuest) {
    try {
      const userGames = [];

      for (const [roomId, game] of this.gameStates.entries()) {
        // Check if expired
        const now = new Date();
        const expiresAt = new Date(game.expiresAt);
        if (now > expiresAt) {
          this.gameStates.delete(roomId);
          continue;
        }

        const playerInGame = game.players.find((p) => {
          if (isGuest) {
            return p.name === userName && p.isGuest;
          } else {
            return p.userId === userId && !p.isGuest;
          }
        });

        if (playerInGame) {
          userGames.push({
            roomId: game.roomId,
            gameMode: game.gameMode,
            gameType: game.gameType,
            playerNumber: playerInGame.playerNumber,
            lastSaved: game.lastSaved,
            createdAt: game.createdAt,
          });
        }
      }

      return userGames;
    } catch (error) {
      console.error("Error finding user games:", error);
      return [];
    }
  }

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
      `🔄 Game restored from memory: ${roomId} with ${
        restoredGame.players.filter((p) => p.isConnected).length
      } connected players`
    );
    return restoredGame;
  }

  async markGameAsFinished(roomId) {
    try {
      const game = this.gameStates.get(roomId);
      if (!game) return false;

      const now = new Date();
      const finishedExpiresAt = new Date(now.getTime() + 1 * 60 * 60 * 1000); // 1 hour

      game.expiresAt = finishedExpiresAt.toISOString();
      game.gameState.gamePhase = "finished";
      game.lastSaved = now.toISOString();

      console.log(`🏁 Game marked as finished: ${roomId} (expires in 1 hour)`);
      return true;
    } catch (error) {
      console.error(`Error marking game as finished for ${roomId}:`, error);
      return false;
    }
  }

  async getStats() {
    try {
      const totalGames = this.gameStates.size;
      const activeGames = Array.from(this.gameStates.values()).filter(
        (game) => game.gameState && game.gameState.gamePhase === "playing"
      ).length;

      return {
        totalGames,
        activeGames,
        autoSaveInterval: this.autoSaveInterval,
      };
    } catch (error) {
      console.error("Error getting memory stats:", error);
      return { totalGames: 0, activeGames: 0 };
    }
  }

  startAutoSave() {
    setInterval(async () => {
      try {
        // Cleanup expired games
        const now = new Date();
        let cleanedCount = 0;

        for (const [roomId, game] of this.gameStates.entries()) {
          const expiresAt = new Date(game.expiresAt);
          if (now > expiresAt) {
            this.gameStates.delete(roomId);
            cleanedCount++;
          }
        }

        if (cleanedCount > 0) {
          console.log(
            `🧹 Cleaned up ${cleanedCount} expired games from memory`
          );
        }

        // Log current stats
        const stats = await this.getStats();
        if (stats.totalGames > 0) {
          console.log(
            `📊 Memory Games: ${stats.activeGames} active, ${stats.totalGames} total`
          );
        }
      } catch (error) {
        console.error("Error in auto-save:", error);
      }
    }, this.autoSaveInterval);
  }
}

module.exports = InMemoryGameStateManager;
