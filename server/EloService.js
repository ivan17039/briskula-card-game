// EloService.js - ELO calculation and database management
import { createClient } from "@supabase/supabase-js";

/**
 * ELO Rating System Service
 *
 * Uses standard ELO formula:
 * - Expected score: E = 1 / (1 + 10^((Rb - Ra) / 400))
 * - New rating: R' = R + K * (S - E)
 *
 * K-factor varies by player experience:
 * - New players (< 30 games): K = 40
 * - Intermediate (30-100 games): K = 32
 * - Established (> 100 games): K = 24
 */
class EloService {
  constructor() {
    this.supabase = null;
    this.initialized = false;

    // Default starting ELO
    this.DEFAULT_ELO = 1000;

    // Minimum ELO (floor)
    this.MIN_ELO = 100;

    // Maximum ELO change per game (cap extreme swings)
    this.MAX_ELO_CHANGE = 50;
  }

  /**
   * Initialize Supabase connection
   */
  init() {
    if (this.initialized) return;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (url && key) {
      this.supabase = createClient(url, key, {
        auth: { persistSession: false },
      });
      this.initialized = true;
      console.log("✅ EloService initialized with Supabase");
    } else {
      console.warn("⚠️ EloService: Supabase not configured, using mock mode");
    }
  }

  /**
   * Get K-factor based on games played
   */
  getKFactor(gamesPlayed) {
    if (gamesPlayed < 30) return 40; // New players - faster adjustment
    if (gamesPlayed < 100) return 32; // Intermediate
    return 24; // Established players - slower adjustment
  }

  /**
   * Calculate expected score (probability of winning)
   * @param {number} playerElo - Player's current ELO
   * @param {number} opponentElo - Opponent's current ELO
   * @returns {number} Expected score between 0 and 1
   */
  calculateExpectedScore(playerElo, opponentElo) {
    return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  }

  /**
   * Calculate ELO change for a match result
   * @param {number} playerElo - Player's current ELO
   * @param {number} opponentElo - Opponent's current ELO
   * @param {number} actualScore - 1 for win, 0.5 for draw, 0 for loss
   * @param {number} kFactor - K-factor for the player
   * @returns {number} ELO change (positive or negative)
   */
  calculateEloChange(playerElo, opponentElo, actualScore, kFactor) {
    const expectedScore = this.calculateExpectedScore(playerElo, opponentElo);
    let change = Math.round(kFactor * (actualScore - expectedScore));

    // Cap extreme changes
    change = Math.max(
      -this.MAX_ELO_CHANGE,
      Math.min(this.MAX_ELO_CHANGE, change)
    );

    return change;
  }

  /**
   * Get player stats from database
   * @param {string} odUserId - Player's user ID
   * @param {string} gameType - 'briskula' or 'treseta'
   */
  async getPlayerStats(userId, gameType) {
    if (!this.supabase) {
      return {
        elo: this.DEFAULT_ELO,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
      };
    }

    try {
      const { data, error } = await this.supabase
        .from("player_stats")
        .select("*")
        .eq("user_id", userId)
        .eq("game_type", gameType)
        .single();

      if (error || !data) {
        return {
          elo: this.DEFAULT_ELO,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
        };
      }

      return {
        elo: data.elo,
        highestElo: data.highest_elo,
        gamesPlayed: data.games_played,
        wins: data.wins,
        losses: data.losses,
        currentStreak: data.current_streak,
        bestStreak: data.best_streak,
      };
    } catch (err) {
      console.error("Error fetching player stats:", err);
      return {
        elo: this.DEFAULT_ELO,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
      };
    }
  }

  /**
   * Process 1v1 game result and update ELO
   * @param {Object} winner - { userId, userName }
   * @param {Object} loser - { userId, userName }
   * @param {string} gameType - 'briskula' or 'treseta'
   * @param {Object} scores - { winnerScore, loserScore }
   */
  async processGameResult1v1(winner, loser, gameType, scores = {}) {
    if (!this.supabase) {
      console.log("📊 [Mock] ELO update skipped - no Supabase");
      return { winnerChange: 0, loserChange: 0 };
    }

    try {
      // Skip if guest vs guest or AI game
      if (!winner.userId || !loser.userId) {
        console.log("📊 ELO update skipped - missing user IDs");
        return { winnerChange: 0, loserChange: 0 };
      }

      // Get current stats for both players
      const [winnerStats, loserStats] = await Promise.all([
        this.getPlayerStats(winner.userId, gameType),
        this.getPlayerStats(loser.userId, gameType),
      ]);

      // Calculate ELO changes
      const winnerK = this.getKFactor(winnerStats.gamesPlayed);
      const loserK = this.getKFactor(loserStats.gamesPlayed);

      const winnerChange = this.calculateEloChange(
        winnerStats.elo,
        loserStats.elo,
        1, // Win
        winnerK
      );

      const loserChange = this.calculateEloChange(
        loserStats.elo,
        winnerStats.elo,
        0, // Loss
        loserK
      );

      // Ensure ELO doesn't go below minimum
      const newWinnerElo = Math.max(
        this.MIN_ELO,
        winnerStats.elo + winnerChange
      );
      const newLoserElo = Math.max(this.MIN_ELO, loserStats.elo + loserChange);

      // Update player stats in database
      await Promise.all([
        this.updatePlayerStats(
          winner.userId,
          winner.userName,
          gameType,
          true, // isWin
          winnerChange,
          scores.winnerScore || 0,
          scores.loserScore || 0
        ),
        this.updatePlayerStats(
          loser.userId,
          loser.userName,
          gameType,
          false, // isWin
          loserChange,
          scores.loserScore || 0,
          scores.winnerScore || 0
        ),
      ]);

      // Record match history
      await this.recordMatch({
        gameType,
        gameMode: "1v1",
        winnerId: winner.userId,
        winnerName: winner.userName,
        loserId: loser.userId,
        loserName: loser.userName,
        winnerScore: scores.winnerScore,
        loserScore: scores.loserScore,
        winnerEloBefore: winnerStats.elo,
        winnerEloAfter: newWinnerElo,
        loserEloBefore: loserStats.elo,
        loserEloAfter: newLoserElo,
        eloChange: Math.abs(winnerChange),
      });

      console.log(
        `📊 ELO Updated: ${winner.userName} +${winnerChange} (${newWinnerElo}), ${loser.userName} ${loserChange} (${newLoserElo})`
      );

      return {
        winnerChange,
        loserChange,
        winnerNewElo: newWinnerElo,
        loserNewElo: newLoserElo,
      };
    } catch (err) {
      console.error("Error processing game result:", err);
      return { winnerChange: 0, loserChange: 0 };
    }
  }

  /**
   * Process 2v2 game result
   * @param {Array} winningTeam - [{ userId, userName }, ...]
   * @param {Array} losingTeam - [{ userId, userName }, ...]
   * @param {string} gameType - 'briskula' or 'treseta'
   * @param {Object} scores - { winnerScore, loserScore }
   */
  async processGameResult2v2(winningTeam, losingTeam, gameType, scores = {}) {
    if (!this.supabase) {
      console.log("📊 [Mock] 2v2 ELO update skipped - no Supabase");
      return { changes: [] };
    }

    try {
      // Filter out guests and AI
      const validWinners = winningTeam.filter((p) => p.userId && !p.isGuest);
      const validLosers = losingTeam.filter((p) => p.userId && !p.isGuest);

      if (validWinners.length === 0 && validLosers.length === 0) {
        console.log("📊 2v2 ELO update skipped - no valid players");
        return { changes: [] };
      }

      // Calculate average ELO for each team
      const getTeamAvgElo = async (team) => {
        const stats = await Promise.all(
          team.map((p) => this.getPlayerStats(p.userId, gameType))
        );
        if (stats.length === 0) return this.DEFAULT_ELO;
        return Math.round(
          stats.reduce((sum, s) => sum + s.elo, 0) / stats.length
        );
      };

      const winnerAvgElo = await getTeamAvgElo(validWinners);
      const loserAvgElo = await getTeamAvgElo(validLosers);

      const changes = [];

      // Update winners
      for (const player of validWinners) {
        const stats = await this.getPlayerStats(player.userId, gameType);
        const k = this.getKFactor(stats.gamesPlayed);
        const change = this.calculateEloChange(stats.elo, loserAvgElo, 1, k);

        await this.updatePlayerStats(
          player.userId,
          player.userName,
          gameType,
          true,
          change,
          scores.winnerScore || 0,
          scores.loserScore || 0
        );

        changes.push({
          userId: player.userId,
          userName: player.userName,
          change,
          newElo: Math.max(this.MIN_ELO, stats.elo + change),
        });
      }

      // Update losers
      for (const player of validLosers) {
        const stats = await this.getPlayerStats(player.userId, gameType);
        const k = this.getKFactor(stats.gamesPlayed);
        const change = this.calculateEloChange(stats.elo, winnerAvgElo, 0, k);

        await this.updatePlayerStats(
          player.userId,
          player.userName,
          gameType,
          false,
          change,
          scores.loserScore || 0,
          scores.winnerScore || 0
        );

        changes.push({
          userId: player.userId,
          userName: player.userName,
          change,
          newElo: Math.max(this.MIN_ELO, stats.elo + change),
        });
      }

      console.log(
        `📊 2v2 ELO Updated:`,
        changes
          .map((c) => `${c.userName}: ${c.change > 0 ? "+" : ""}${c.change}`)
          .join(", ")
      );

      return { changes };
    } catch (err) {
      console.error("Error processing 2v2 game result:", err);
      return { changes: [] };
    }
  }

  /**
   * Update player stats in database
   */
  async updatePlayerStats(
    userId,
    userName,
    gameType,
    isWin,
    eloChange,
    pointsScored,
    pointsAgainst
  ) {
    if (!this.supabase) return;

    try {
      // First, try to get existing record
      const { data: existing } = await this.supabase
        .from("player_stats")
        .select("*")
        .eq("user_id", userId)
        .eq("game_type", gameType)
        .single();

      if (existing) {
        // Update existing record
        const newElo = Math.max(this.MIN_ELO, existing.elo + eloChange);
        const newStreak = isWin ? existing.current_streak + 1 : 0;

        const updateData = {
          elo: newElo,
          highest_elo: Math.max(existing.highest_elo || existing.elo, newElo),
          wins: existing.wins + (isWin ? 1 : 0),
          losses: existing.losses + (isWin ? 0 : 1),
          games_played: existing.games_played + 1,
          current_streak: newStreak,
          best_streak: Math.max(existing.best_streak || 0, newStreak),
          last_game_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Update user_name if provided and different (or if missing)
        if (
          userName &&
          (!existing.user_name || existing.user_name !== userName)
        ) {
          updateData.user_name = userName;
        }

        const { error: updateError } = await this.supabase
          .from("player_stats")
          .update(updateData)
          .eq("user_id", userId)
          .eq("game_type", gameType);

        if (updateError) {
          console.error("Error updating player stats:", updateError);
        } else {
          console.log(
            `📊 Updated stats for ${userName || userId}: ELO ${
              existing.elo
            } -> ${newElo}`
          );
        }
      } else {
        // Insert new record
        const newElo = Math.max(this.MIN_ELO, this.DEFAULT_ELO + eloChange);

        const { error: insertError } = await this.supabase
          .from("player_stats")
          .insert({
            user_id: userId,
            user_name: userName || null,
            game_type: gameType,
            elo: newElo,
            highest_elo: Math.max(this.DEFAULT_ELO, newElo),
            wins: isWin ? 1 : 0,
            losses: isWin ? 0 : 1,
            games_played: 1,
            current_streak: isWin ? 1 : 0,
            best_streak: isWin ? 1 : 0,
            last_game_at: new Date().toISOString(),
          });

        if (insertError) {
          console.error("Error inserting player stats:", insertError);
        } else {
          console.log(
            `📊 Created new stats for ${userName || userId}: ELO ${newElo}`
          );
        }
      }
    } catch (err) {
      console.error("Error updating player stats:", err);
    }
  }

  /**
   * Record match in history (disabled - no match_history table)
   */
  async recordMatch(matchData) {
    // Disabled - match_history table doesn't exist
    // Could be enabled later if needed
    console.log(
      "📊 Match recorded (in memory):",
      matchData.winnerName,
      "beat",
      matchData.loserName
    );
  }

  /**
   * Get leaderboard for a game type
   * @param {string} gameType - 'briskula', 'treseta', or 'all'
   * @param {number} limit - Number of players to return
   */
  async getLeaderboard(gameType = "all", limit = 50) {
    if (!this.supabase) {
      console.log("📊 [Mock] Leaderboard - no Supabase");
      return [];
    }

    try {
      let query = this.supabase
        .from("player_stats")
        .select("*")
        .order("elo", { ascending: false })
        .limit(limit);

      if (gameType !== "all") {
        query = query.eq("game_type", gameType);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error fetching leaderboard:", error);
        return [];
      }

      // Get user names from profiles table for users without user_name in player_stats
      const userIdsWithoutName = (data || [])
        .filter((p) => !p.user_name)
        .map((p) => p.user_id);

      let profileMap = new Map();
      if (userIdsWithoutName.length > 0) {
        const { data: profiles } = await this.supabase
          .from("profiles")
          .select("id, display_name, email")
          .in("id", userIdsWithoutName);

        profileMap = new Map((profiles || []).map((p) => [p.id, p]));
      }

      return (data || []).map((player, index) => {
        // Use user_name from player_stats first, then fall back to profiles
        let displayName = player.user_name;
        if (!displayName) {
          const profile = profileMap.get(player.user_id);
          displayName =
            profile?.display_name ||
            profile?.email?.split("@")[0] ||
            player.user_id?.slice(0, 8) ||
            "Nepoznat";
        }

        return {
          rank: index + 1,
          name: displayName,
          elo: player.elo,
          highestElo: player.highest_elo,
          wins: player.wins,
          losses: player.losses,
          gamesPlayed: player.games_played,
          winRate:
            player.games_played > 0
              ? ((player.wins / player.games_played) * 100).toFixed(1)
              : "0.0",
          bestStreak: player.best_streak,
          currentStreak: player.current_streak,
          userId: player.user_id,
          gameType: player.game_type,
        };
      });
    } catch (err) {
      console.error("Error fetching leaderboard:", err);
      return [];
    }
  }

  /**
   * Get player's rank on leaderboard
   */
  async getPlayerRank(userId, gameType) {
    if (!this.supabase) return null;

    try {
      const { data: playerStats } = await this.supabase
        .from("player_stats")
        .select("elo")
        .eq("user_id", userId)
        .eq("game_type", gameType)
        .single();

      if (!playerStats) return null;

      const { count } = await this.supabase
        .from("player_stats")
        .select("*", { count: "exact", head: true })
        .eq("game_type", gameType)
        .gt("elo", playerStats.elo);

      return (count || 0) + 1;
    } catch (err) {
      console.error("Error getting player rank:", err);
      return null;
    }
  }
}

// Singleton instance
const eloService = new EloService();
export default eloService;
