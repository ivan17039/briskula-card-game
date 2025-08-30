// SupabaseSessionManager.js - Session management with Supabase PostgreSQL (ESM)

import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

class SupabaseSessionManager {
  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!this.supabaseUrl || !this.supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables for server");
    }

    this.supabase = createClient(this.supabaseUrl, this.supabaseServiceKey);
    this.sessionTimeout = 300000; // 5 minuta
    this.heartbeatInterval = 30000; // 30 sekundi

    this.initializeTables();
    this.startHeartbeatMonitor();
  }

  /**
   * Initialize sessions table
   */
  async initializeTables() {
    try {
      // Tables should be created manually via Supabase SQL Editor
      // using the provided supabase-setup.sql script
      console.log("✅ Supabase session tables ready");
    } catch (error) {
      console.error("Error initializing session tables:", error);
    }
  }

  /**
   * Generate secure session token
   */
  generateSessionToken() {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Create new session
   */
  async createSession(userData, socketId) {
    try {
      const sessionToken = this.generateSessionToken();
      const sessionId = uuidv4();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.sessionTimeout);

      const sessionData = {
        session_token: sessionToken,
        session_id: sessionId,
        user_id: userData.userId || null,
        user_name: userData.name,
        email: userData.email || null,
        is_guest: userData.isGuest !== false,
        socket_id: socketId,
        is_active: true,
        created_at: now.toISOString(),
        last_activity: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      };

      const { error } = await this.supabase
        .from("user_sessions")
        .upsert(sessionData, { onConflict: "session_token" });

      if (error) {
        console.error("Error creating session:", error);
        throw error;
      }

      console.log(
        `✅ Supabase session created: ${userData.name} (${sessionId})`
      );
      return { sessionToken, sessionId };
    } catch (error) {
      console.error("Error creating session:", error);
      throw error;
    }
  }

  /**
   * Validate session
   */
  async validateSession(sessionToken) {
    try {
      const { data, error } = await this.supabase
        .from("user_sessions")
        .select("*")
        .eq("session_token", sessionToken)
        .single();

      if (error || !data) {
        return { valid: false, reason: "Session not found" };
      }

      // Check if session is expired
      const now = new Date();
      const expiresAt = new Date(data.expires_at);

      if (now > expiresAt) {
        await this.invalidateSession(sessionToken);
        return { valid: false, reason: "Session expired" };
      }

      // Convert to internal format
      const session = this.convertFromSupabaseFormat(data);
      return { valid: true, session };
    } catch (error) {
      console.error("Error validating session:", error);
      return { valid: false, reason: "Validation error" };
    }
  }

  /**
   * Update session heartbeat
   */
  async updateHeartbeat(sessionToken) {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.sessionTimeout);

      const { error } = await this.supabase
        .from("user_sessions")
        .update({
          last_activity: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        })
        .eq("session_token", sessionToken);

      if (error) {
        console.error("Error updating heartbeat:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error updating heartbeat:", error);
      return false;
    }
  }

  /**
   * Reconnect session
   */
  async reconnectSession(sessionToken, newSocketId) {
    try {
      const validation = await this.validateSession(sessionToken);
      if (!validation.valid) {
        return { success: false, reason: validation.reason };
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.sessionTimeout);

      const { data, error } = await this.supabase
        .from("user_sessions")
        .update({
          socket_id: newSocketId,
          is_active: true,
          last_activity: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        })
        .eq("session_token", sessionToken)
        .select()
        .single();

      if (error) {
        console.error("Error reconnecting session:", error);
        return { success: false, reason: "Reconnection error" };
      }

      const session = this.convertFromSupabaseFormat(data);
      return { success: true, session };
    } catch (error) {
      console.error("Error reconnecting session:", error);
      return { success: false, reason: "Reconnection error" };
    }
  }

  /**
   * Assign session to game room
   */
  async assignToGameRoom(sessionToken, roomId, playerNumber) {
    try {
      const { error } = await this.supabase
        .from("user_sessions")
        .update({
          game_room_id: roomId,
          player_number: playerNumber,
        })
        .eq("session_token", sessionToken);

      if (error) {
        console.error("Error assigning to game room:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error assigning to game room:", error);
      return false;
    }
  }

  /**
   * Find session by user
   */
  async findSessionByUser(userId, userName, isGuest) {
    try {
      let query = this.supabase
        .from("user_sessions")
        .select("*")
        .eq("is_active", true);

      if (!isGuest && userId) {
        query = query.eq("user_id", userId).eq("is_guest", false);
      } else {
        query = query.eq("user_name", userName).eq("is_guest", true);
      }

      const { data, error } = await query.single();

      if (error || !data) return null;

      // Check if session is still valid
      const now = new Date();
      const expiresAt = new Date(data.expires_at);

      if (now > expiresAt) {
        await this.invalidateSession(data.session_token);
        return null;
      }

      return this.convertFromSupabaseFormat(data);
    } catch (error) {
      console.error("Error finding session by user:", error);
      return null;
    }
  }

  /**
   * Find player session
   */
  async findPlayerSession(roomId, playerNumber) {
    try {
      const { data, error } = await this.supabase
        .from("user_sessions")
        .select("*")
        .eq("game_room_id", roomId)
        .eq("player_number", playerNumber)
        .eq("is_active", true)
        .single();

      if (error || !data) return null;

      return this.convertFromSupabaseFormat(data);
    } catch (error) {
      console.error("Error finding player session:", error);
      return null;
    }
  }

  /**
   * Invalidate session
   */
  async invalidateSession(sessionToken) {
    try {
      const { error } = await this.supabase
        .from("user_sessions")
        .delete()
        .eq("session_token", sessionToken);

      if (error) {
        console.error("Error invalidating session:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error invalidating session:", error);
      return false;
    }
  }

  /**
   * Convert Supabase format to internal format
   */
  convertFromSupabaseFormat(data) {
    return {
      sessionId: data.session_id,
      sessionToken: data.session_token,
      userId: data.user_id,
      userName: data.user_name,
      email: data.email,
      isGuest: data.is_guest,
      socketId: data.socket_id,
      isActive: data.is_active,
      gameRoomId: data.game_room_id,
      playerNumber: data.player_number,
      createdAt: data.created_at,
      lastActivity: data.last_activity,
    };
  }

  /**
   * Get statistics
   */
  async getStats() {
    try {
      const { count: activeSessions } = await this.supabase
        .from("user_sessions")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);

      const { count: totalSessions } = await this.supabase
        .from("user_sessions")
        .select("*", { count: "exact", head: true });

      return {
        activeSessions: activeSessions || 0,
        totalSessions: totalSessions || 0,
        heartbeatInterval: this.heartbeatInterval,
        sessionTimeout: this.sessionTimeout,
      };
    } catch (error) {
      console.error("Error getting stats:", error);
      return { activeSessions: 0, totalSessions: 0 };
    }
  }

  /**
   * Heartbeat monitor for cleanup
   */
  startHeartbeatMonitor() {
    setInterval(async () => {
      try {
        // Clean up expired sessions
        const { error } = await this.supabase
          .from("user_sessions")
          .delete()
          .lt("expires_at", new Date().toISOString());

        if (error) {
          console.error("Error cleaning up expired sessions:", error);
        }

        // Optionally log stats
        const stats = await this.getStats();
        if (stats.activeSessions > 0) {
          console.log(`📊 Active Sessions: ${stats.activeSessions}`);
        }
      } catch (error) {
        console.error("Error in heartbeat monitor:", error);
      }
    }, this.heartbeatInterval);
  }
}

export default SupabaseSessionManager;
