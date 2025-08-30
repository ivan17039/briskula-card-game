// InMemorySessionManager.js - Simple in-memory session management for fallback

class InMemorySessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionTimeout = 300000; // 5 minutes
    console.log("✅ InMemory session manager initialized");
  }

  // Getter for activeSessions to maintain compatibility
  get activeSessions() {
    return this.sessions;
  }

  async createSession(userData, socketId) {
    const sessionToken = `session_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const sessionId = `id_${Date.now()}`;

    const sessionData = {
      sessionToken,
      sessionId,
      userId: userData.userId || null,
      userName: userData.name,
      email: userData.email || null,
      isGuest: userData.isGuest !== false,
      socketId,
      isActive: true,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.sessions.set(sessionToken, sessionData);

    console.log(`✅ InMemory session created: ${userData.name} (${sessionId})`);
    return { sessionToken, sessionId };
  }

  async validateSession(sessionToken) {
    const session = this.sessions.get(sessionToken);
    if (!session) {
      return { valid: false, reason: "Session not found" };
    }

    // Check if session expired
    const now = new Date();
    const expiresAt = new Date(
      session.lastActivity.getTime() + this.sessionTimeout
    );

    if (now > expiresAt) {
      this.sessions.delete(sessionToken);
      return { valid: false, reason: "Session expired" };
    }

    return { valid: true, session };
  }

  async updateHeartbeat(sessionToken) {
    const session = this.sessions.get(sessionToken);
    if (session) {
      session.lastActivity = new Date();
      return true;
    }
    return false;
  }

  async reconnectSession(sessionToken, newSocketId) {
    const validation = await this.validateSession(sessionToken);
    if (!validation.valid) {
      return { success: false, reason: validation.reason };
    }

    const session = validation.session;
    session.socketId = newSocketId;
    session.isActive = true;
    session.lastActivity = new Date();

    return { success: true, session };
  }

  async assignToGameRoom(sessionToken, roomId, playerNumber) {
    const session = this.sessions.get(sessionToken);
    if (session) {
      session.gameRoomId = roomId;
      session.playerNumber = playerNumber;
      return true;
    }
    return false;
  }

  async findSessionByUser(userId, userName, isGuest) {
    for (const [token, session] of this.sessions.entries()) {
      if (!session.isActive) continue;

      // Check if session is expired
      const now = new Date();
      const expiresAt = new Date(
        session.lastActivity.getTime() + this.sessionTimeout
      );
      if (now > expiresAt) {
        this.sessions.delete(token);
        continue;
      }

      if (!isGuest && userId && session.userId === userId && !session.isGuest) {
        return session;
      } else if (isGuest && session.userName === userName && session.isGuest) {
        return session;
      }
    }
    return null;
  }

  async findPlayerSession(roomId, playerNumber) {
    for (const [token, session] of this.sessions.entries()) {
      if (
        session.gameRoomId === roomId &&
        session.playerNumber === playerNumber &&
        session.isActive
      ) {
        return session;
      }
    }
    return null;
  }

  async invalidateSession(sessionToken) {
    return this.sessions.delete(sessionToken);
  }

  async getStats() {
    const activeSessions = Array.from(this.sessions.values()).filter(
      (s) => s.isActive
    ).length;
    return {
      activeSessions,
      totalSessions: this.sessions.size,
      heartbeatInterval: 30000,
      sessionTimeout: this.sessionTimeout,
    };
  }
}

export default InMemorySessionManager;
