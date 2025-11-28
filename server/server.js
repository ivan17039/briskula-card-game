// server.js - Glavni Socket.io server za Briskulu (1v1 + 2v2)

// Load environment variables
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import TournamentManager from "./TournamentManager.js";

// Import novih managera
import ManagerFactory from "./ManagerFactory.js";

const app = express();
const server = http.createServer(app);

// Inicijaliziraj managere based on environment
let sessionManager;
let gameStateManager;
const initManagers = async () => {
  sessionManager = await ManagerFactory.createSessionManager();
  gameStateManager = await ManagerFactory.createGameStateManager();
};
await initManagers();

// CORS konfiguracija
const allowedOrigins = [
  "http://localhost:5173", // Local development
  "https://briskula-card-game.vercel.app", // Production Vercel
  "https://briskula-card-game-*.vercel.app", // Vercel preview deployments
  "https://briskula-treseta.games", // Production domain
  "https://*.briskula-treseta.games", // Production subdomains
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Add JSON parsing middleware
app.use(express.json());

const io = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Strukture za čuvanje stanja
const connectedUsers = new Map(); // socketId -> user info
const gameRooms = new Map(); // roomId -> game state
const waitingQueue1v1 = []; // korisnici koji čekaju 1v1 protivnika
const waitingQueue2v2 = []; // korisnici koji čekaju 2v2 protivnike
// Tournament match readiness: matchId -> Set of user keys who clicked "Igraj sada"
const tournamentReady = new Map();
// Player session mapping for reconnection: playerId -> {roomId, playerNumber, socketId}
const playerSessions = new Map();

// Reconnect grace period (ms) - configurable via environment variable
const GRACE_PERIOD_MS = parseInt(process.env.GRACE_PERIOD_MS || "60000", 10); // default 60s

// --- Player Session Management ---
function createPlayerSession(playerId, roomId, playerNumber, socketId) {
  playerSessions.set(playerId, {
    roomId,
    playerNumber,
    socketId,
    lastSeen: Date.now(),
  });
  console.log(
    `📋 Created player session: ${playerId} -> Room ${roomId}, Player ${playerNumber}`
  );
}

function updatePlayerSession(playerId, socketId) {
  const session = playerSessions.get(playerId);
  if (session) {
    session.socketId = socketId;
    session.lastSeen = Date.now();
    console.log(`🔄 Updated player session: ${playerId} -> Socket ${socketId}`);
  }
}

function removePlayerSession(playerId) {
  if (playerSessions.has(playerId)) {
    console.log(`🗑️ Removed player session: ${playerId}`);
    playerSessions.delete(playerId);
  }
}

function getPlayerSession(playerId) {
  return playerSessions.get(playerId);
}

// --- Disconnect Helpers ---

function markPlayerSoftDisconnected(room, player) {
  if (!room || !player) return;
  player.isConnected = false;
  player.disconnectedAt = Date.now();
  if (!room.disconnectTimeouts) room.disconnectTimeouts = new Map();
  if (room.disconnectTimeouts.has(player.playerNumber)) {
    clearTimeout(room.disconnectTimeouts.get(player.playerNumber));
  }
  const timeoutId = setTimeout(() => {
    // If still disconnected when grace ends -> forfeit with old system
    const stillRoom = gameRooms.get(room.id || room.roomId);
    if (!stillRoom) return;
    const pl = stillRoom.players.find(
      (p) => p.playerNumber === player.playerNumber
    );
    if (pl && !pl.isConnected && !pl.permanentlyLeft) {
      // Use old system cleanup instead of finalizeForfeitRoom
      pl.permanentlyLeft = true;
      pl.forfeited = true;

      // Remove player session
      if (pl.playerId) {
        removePlayerSession(pl.playerId);
      }

      const roomId = stillRoom.id || stillRoom.roomId;
      let timeoutMessage;
      if (stillRoom.gameMode === "2v2") {
        const teamInfo = `Tim ${pl.team} (igrač ${pl.playerNumber})`;
        timeoutMessage = `${pl.name} je napustio sobu - ${teamInfo}`;
      } else {
        timeoutMessage = `${pl.name} je napustio sobu.`;
      }

      // Notify other players about timeout leave
      io.to(roomId).emit("playerLeft", {
        playerNumber: pl.playerNumber,
        message: timeoutMessage,
        gameMode: stillRoom.gameMode,
        playerTeam: pl.team || null,
        permanent: true, // This is after timeout, so it's permanent
      });

      // Clean up and send roomDeleted like old system
      setTimeout(async () => {
        try {
          await gameStateManager.deleteGame(roomId);
          console.log(`🗑️ Deleted game storage for room ${roomId}`);
        } catch (error) {
          console.log("Game storage cleanup failed:", error.message);
        }

        try {
          for (const player of stillRoom.players) {
            const playerSession = await sessionManager.findSessionByUser(
              player.name
            );
            if (playerSession) {
              await sessionManager.markSessionAsLeft(playerSession.id);
            }
          }
        } catch (error) {
          console.log(
            "Session cleanup for room players failed:",
            error.message
          );
        }

        io.to(roomId).emit("roomDeleted", {
          message: `Protivnik je odustao od igre. Soba je obrisana.`,
          redirectToMenu: true,
        });

        gameRooms.delete(roomId);
        console.log(`🗑️ Soba ${roomId} obrisana zbog timeout-a.`);
      }, 1000);
    }
  }, GRACE_PERIOD_MS);
  room.disconnectTimeouts.set(player.playerNumber, timeoutId);
}

// Helper to broadcast public game state to all spectators
function broadcastSpectatorUpdate(room) {
  if (!room || !room.spectators || room.spectators.length === 0) return;
  const publicState = getPublicGameState(room.gameState);
  room.spectators.forEach((sid) => {
    io.to(sid).emit("spectatorUpdate", {
      roomId: room.id,
      gameType: room.gameType,
      gameMode: room.gameMode,
      gameState: publicState,
      players: room.players.map((p) => ({
        name: p.name,
        userId: p.userId,
        playerNumber: p.playerNumber,
        isConnected: p.isConnected,
      })),
    });
  });
}

// --- HELPER FUNCTIONS ---

// Kreira "public" verziju game state-a za spectatore (bez tuđih karata)
function getPublicGameState(gameState) {
  if (!gameState) return null;

  return {
    ...gameState,
    // Spectatori vide samo broj karata, ne i same karte
    player1Hand: gameState.player1Hand
      ? gameState.player1Hand.map(() => ({ hidden: true }))
      : [],
    player2Hand: gameState.player2Hand
      ? gameState.player2Hand.map(() => ({ hidden: true }))
      : [],
    // Ostale informacije su javne
    playedCards: gameState.playedCards,
    trump: gameState.trump,
    trumpSuit: gameState.trumpSuit,
    currentPlayer: gameState.currentPlayer,
    gamePhase: gameState.gamePhase,
    winner: gameState.winner,
    gameType: gameState.gameType,
    remainingDeck: gameState.remainingDeck
      ? gameState.remainingDeck.map(() => ({ hidden: true }))
      : [],
    // Za Trešetu - javni bodovi i partije
    ...(gameState.gameType === "treseta" && {
      totalPlayer1Points: gameState.totalPlayer1Points,
      totalPlayer2Points: gameState.totalPlayer2Points,
      partijas: gameState.partijas,
      currentPartija: gameState.currentPartija,
      targetScore: gameState.targetScore,
    }),
  };
}

// Tournament manager (DB aware if Supabase env vars present)
const tournamentManager = new TournamentManager({ io });

// Disabled auto-creation - manual control only
console.log("🎯 Tournament auto-creation disabled - use manual endpoints");

app.use(express.json());

// Root endpoint - jednostavan ping za provjeru servera
app.get("/", (req, res) => {
  res.json({
    message: "Briskula Card Game Server",
    status: "running",
    timestamp: new Date().toISOString(),
  });
});

// Enhanced API endpoints
app.get("/api/status", (req, res) => {
  try {
    const sessionStats = sessionManager.getStats();
    const gameStats = gameStateManager.getStats();

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        platform: process.platform,
        nodeVersion: process.version,
      },
      sessions: sessionStats,
      games: gameStats,
      queues: {
        queue1v1: waitingQueue1v1.length,
        queue2v2: waitingQueue2v2.length,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// DEV: Hard reset tournaments & related tables (NOT for production)
app.post("/api/dev/reset-tournaments", async (req, res) => {
  try {
    const result = await tournamentManager.resetAll({ includeSessions: true });
    if (result.success) {
      res.json({ success: true, message: "Tournaments and sessions reset" });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Create sample tournaments manually
app.post("/api/dev/create-sample-tournaments", async (req, res) => {
  try {
    await tournamentManager.ensureSampleTournaments();
    res.json({ success: true, message: "Sample tournaments created" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// List tournaments (REST)
app.get("/api/tournaments", async (req, res) => {
  try {
    const list = await tournamentManager.listTournaments(req.query.gameType);
    res.json(list.map((t) => tournamentManager._publicTournament(t)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get bracket for a tournament
app.get("/api/tournaments/:id/bracket", async (req, res) => {
  try {
    const t = await tournamentManager.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: "Not found" });
    const bracket = await tournamentManager.getBracket(req.params.id);
    res.json({ tournament: tournamentManager._publicTournament(t), bracket });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 🧹 Cleanup endpoint - Delete all Supabase games (for testing/cleanup)
app.post("/api/cleanup/games", async (req, res) => {
  try {
    console.log("🧹 Cleanup request received - deleting all Supabase games");

    const result = await gameStateManager.deleteAllGameStates();

    if (result.success) {
      const stats = await gameStateManager.getStats();
      res.json({
        success: true,
        message: `Successfully deleted ${
          result.deletedCount || "all"
        } game states`,
        deletedCount: result.deletedCount,
        currentStats: stats,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        message: "Failed to delete game states",
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("Error in cleanup endpoint:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: "Internal server error during cleanup",
      timestamp: new Date().toISOString(),
    });
  }
});

// Osnovni endpoint za provjeru servera
app.get("/api/status", (req, res) => {
  res.json({
    status: "Server is running",
    connectedUsers: connectedUsers.size,
    activeRooms: gameRooms.size,
    waitingQueue1v1: waitingQueue1v1.length,
    waitingQueue2v2: waitingQueue2v2.length,
  });
});

// Health check endpoint za UptimeRobot - sprječava spavanje na Render free tier
app.get("/healthz", (req, res) => {
  try {
    // Provjeri osnovnu funkcionalnost servera
    const serverStatus = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      connectedUsers: connectedUsers.size,
      activeRooms: gameRooms.size,
      memory: process.memoryUsage(),
    };

    // Jednostavna provjera da li server radi normalno
    if (connectedUsers !== undefined && gameRooms !== undefined) {
      res.status(200).json(serverStatus);
    } else {
      res.status(500).json({
        status: "unhealthy",
        message: "Server internal state error",
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(500).json({
      status: "unhealthy",
      message: "Health check failed",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Socket.io logika
io.on("connection", (socket) => {
  console.log(`🔌 Nova konekcija: ${socket.id}`);

  // NOTE: Previous in-memory tournament mock removed. Using TournamentManager.

  // Enhanced registration with session management
  socket.on("register", async (userData) => {
    try {
      console.log(`📝 Registracija zahtjev od ${socket.id}:`, {
        name: userData.name,
        isGuest: userData.isGuest,
        hasSessionToken: !!userData.sessionToken,
      });

      let session = null;

      // Ako korisnik šalje session token, pokušaj reconnect
      if (userData.sessionToken) {
        const validation = await sessionManager.validateSession(
          userData.sessionToken
        );
        if (validation.valid) {
          // Reconnect postojeće sesije
          const reconnectResult = await sessionManager.reconnectSession(
            userData.sessionToken,
            socket.id
          );
          if (reconnectResult.success) {
            session = reconnectResult.session;

            // Dodaj u connected users
            connectedUsers.set(socket.id, {
              id: socket.id,
              name: session.userName,
              isGuest: session.isGuest,
              email: session.email,
              userId: session.userId,
              sessionToken: userData.sessionToken,
              joinedAt: new Date(),
            });

            // 🔧 KLJUČNO: Ažuriraj player.id u svim rooms gdje je ovaj user
            console.log(
              "🔄 Updating player.id in game rooms for session reconnect..."
            );
            let gameResumeData = null;

            for (const [roomId, room] of gameRooms.entries()) {
              const player = room.players?.find(
                (p) =>
                  // Primary match: sessionToken (most reliable)
                  p.sessionToken === userData.sessionToken ||
                  // Secondary match: userId (if available)
                  (p.userId && p.userId === session.userId) ||
                  // Fallback match: guest name (least reliable)
                  (session.isGuest && p.name === session.userName && p.isGuest)
              );

              if (player) {
                const oldId = player.id;
                player.id = socket.id;
                player.isConnected = true;
                player.sessionToken = userData.sessionToken; // Update sessionToken
                player.userId = session.userId; // Update userId to stable version
                delete player.disconnectedAt;

                // Clear disconnect timeout if exists
                if (
                  room.disconnectTimeouts &&
                  room.disconnectTimeouts.has(player.playerNumber)
                ) {
                  clearTimeout(
                    room.disconnectTimeouts.get(player.playerNumber)
                  );
                  room.disconnectTimeouts.delete(player.playerNumber);
                  console.log(
                    `⏰ Cleared disconnect timeout for player ${player.playerNumber} in room ${roomId}`
                  );
                }

                console.log(
                  `🔄 Updated player in room ${roomId}: ${oldId} → ${socket.id} (${player.name})`
                );

                // Join socket to room
                socket.join(roomId);

                // Prepare game state for frontend
                let gameResumeData;

                if (room.gameMode === "1v1") {
                  // 1v1 game structure
                  const opponent = room.players.find(
                    (p) => p.playerNumber !== player.playerNumber
                  );

                  gameResumeData = {
                    roomId,
                    playerNumber: player.playerNumber,
                    opponent: opponent
                      ? {
                          name: opponent.name,
                          userId: opponent.userId,
                          playerNumber: opponent.playerNumber,
                          isConnected: opponent.isConnected,
                        }
                      : null,
                    gameType: room.gameType,
                    gameMode: room.gameMode,
                    players: room.players.map((p) => ({
                      name: p.name,
                      playerNumber: p.playerNumber,
                      isConnected: p.isConnected,
                      userId: p.userId,
                    })),
                    gameState: {
                      ...room.gameState,
                      myHand:
                        room.gameState[`player${player.playerNumber}Hand`] ||
                        [],
                      opponentHand:
                        room.gameState[
                          `player${player.playerNumber === 1 ? 2 : 1}Hand`
                        ]?.map(() => ({ hidden: true })) || [],
                    },
                  };
                } else if (room.gameMode === "2v2") {
                  // 2v2 game structure - provide complete game state
                  gameResumeData = {
                    roomId,
                    playerNumber: player.playerNumber,
                    myTeam: player.team, // Add team info for 2v2
                    gameType: room.gameType,
                    gameMode: room.gameMode,
                    akuzeEnabled: room.akuzeEnabled, // Add akuze flag
                    players: room.players.map((p) => ({
                      name: p.name,
                      playerNumber: p.playerNumber,
                      isConnected: p.isConnected,
                      userId: p.userId,
                      team: p.team,
                    })),
                    gameState: {
                      ...room.gameState,
                      // Provide player's own hand
                      myHand:
                        room.gameState[`player${player.playerNumber}Hand`] ||
                        [],
                      // Hide other players' hands
                      player1Hand:
                        player.playerNumber === 1
                          ? room.gameState.player1Hand
                          : room.gameState.player1Hand?.map(() => ({
                              hidden: true,
                            })) || [],
                      player2Hand:
                        player.playerNumber === 2
                          ? room.gameState.player2Hand
                          : room.gameState.player2Hand?.map(() => ({
                              hidden: true,
                            })) || [],
                      player3Hand:
                        player.playerNumber === 3
                          ? room.gameState.player3Hand
                          : room.gameState.player3Hand?.map(() => ({
                              hidden: true,
                            })) || [],
                      player4Hand:
                        player.playerNumber === 4
                          ? room.gameState.player4Hand
                          : room.gameState.player4Hand?.map(() => ({
                              hidden: true,
                            })) || [],
                    },
                  };
                } // Notify others that player reconnected
                socket.to(roomId).emit("playerReconnected", {
                  playerNumber: player.playerNumber,
                  playerName: player.name,
                  message: `${player.name} se vratio u igru`,
                });

                break; // Player can only be in one room
              }
            }

            // Send sessionReconnected response with optional game data
            socket.emit("sessionReconnected", {
              success: true,
              session: {
                sessionToken: userData.sessionToken,
                sessionId: session.sessionId,
                wasInGame: reconnectResult.wasInGame,
              },
              user: {
                name: session.userName,
                email: session.email,
                isGuest: session.isGuest,
                userId: session.userId,
              },
              message: `Dobrodošli nazad, ${session.userName}!`,
              // Include game data if player was in a game
              ...(gameResumeData && { gameData: gameResumeData }),
            });

            console.log(
              `✅ Session reconnected: ${session.userName} (${session.sessionId})`
            );
            return;
          }
        }
      }

      // Provjeri da li korisnik već ima aktivnu sesiju (bez session token-a)
      const existingSession = await sessionManager.findSessionByUser(
        userData.userId || userData.id,
        userData.name,
        userData.isGuest
      );

      if (existingSession) {
        // Reconnect postojeće sesije
        const reconnectResult = await sessionManager.reconnectSession(
          existingSession.sessionToken,
          socket.id
        );
        if (reconnectResult.success) {
          session = reconnectResult.session;

          // Dodaj u connected users
          connectedUsers.set(socket.id, {
            id: socket.id,
            name: session.userName,
            isGuest: session.isGuest,
            email: session.email,
            userId: session.userId,
            sessionToken: existingSession.sessionToken,
            joinedAt: new Date(),
          });

          // 🔧 KLJUČNO: Ažuriraj player.id u svim rooms gdje je ovaj user
          console.log(
            "🔄 Updating player.id in game rooms for existing session..."
          );
          let gameResumeData = null;

          for (const [roomId, room] of gameRooms.entries()) {
            const player = room.players?.find(
              (p) =>
                // Primary match: sessionToken (most reliable)
                p.sessionToken === existingSession.sessionToken ||
                // Secondary match: userId (if available)
                (p.userId && p.userId === session.userId) ||
                // Fallback match: guest name (least reliable)
                (session.isGuest && p.name === session.userName && p.isGuest)
            );

            if (player) {
              const oldId = player.id;
              player.id = socket.id;
              player.isConnected = true;
              player.sessionToken = existingSession.sessionToken; // Update sessionToken
              player.userId = session.userId; // Update userId to stable version
              delete player.disconnectedAt;

              // Clear disconnect timeout if exists
              if (
                room.disconnectTimeouts &&
                room.disconnectTimeouts.has(player.playerNumber)
              ) {
                clearTimeout(room.disconnectTimeouts.get(player.playerNumber));
                room.disconnectTimeouts.delete(player.playerNumber);
                console.log(
                  `⏰ Cleared disconnect timeout for player ${player.playerNumber} in room ${roomId}`
                );
              }

              console.log(
                `🔄 Updated player in room ${roomId}: ${oldId} → ${socket.id} (${player.name})`
              );

              // Join socket to room
              socket.join(roomId);

              // Prepare game state for frontend
              let gameResumeData;

              if (room.gameMode === "1v1") {
                // 1v1 game structure
                const opponent = room.players.find(
                  (p) => p.playerNumber !== player.playerNumber
                );

                gameResumeData = {
                  roomId,
                  playerNumber: player.playerNumber,
                  opponent: opponent
                    ? {
                        name: opponent.name,
                        userId: opponent.userId,
                        playerNumber: opponent.playerNumber,
                        isConnected: opponent.isConnected,
                      }
                    : null,
                  gameType: room.gameType,
                  gameMode: room.gameMode,
                  players: room.players.map((p) => ({
                    name: p.name,
                    playerNumber: p.playerNumber,
                    isConnected: p.isConnected,
                    userId: p.userId,
                  })),
                  gameState: {
                    ...room.gameState,
                    myHand:
                      room.gameState[`player${player.playerNumber}Hand`] || [],
                    opponentHand:
                      room.gameState[
                        `player${player.playerNumber === 1 ? 2 : 1}Hand`
                      ]?.map(() => ({ hidden: true })) || [],
                  },
                };
              } else if (room.gameMode === "2v2") {
                // 2v2 game structure - provide complete game state
                gameResumeData = {
                  roomId,
                  playerNumber: player.playerNumber,
                  myTeam: player.team, // Add team info for 2v2
                  gameType: room.gameType,
                  gameMode: room.gameMode,
                  akuzeEnabled: room.akuzeEnabled, // Add akuze flag
                  players: room.players.map((p) => ({
                    name: p.name,
                    playerNumber: p.playerNumber,
                    isConnected: p.isConnected,
                    userId: p.userId,
                    team: p.team,
                  })),
                  gameState: {
                    ...room.gameState,
                    // Provide player's own hand
                    myHand:
                      room.gameState[`player${player.playerNumber}Hand`] || [],
                    // Hide other players' hands
                    player1Hand:
                      player.playerNumber === 1
                        ? room.gameState.player1Hand
                        : room.gameState.player1Hand?.map(() => ({
                            hidden: true,
                          })) || [],
                    player2Hand:
                      player.playerNumber === 2
                        ? room.gameState.player2Hand
                        : room.gameState.player2Hand?.map(() => ({
                            hidden: true,
                          })) || [],
                    player3Hand:
                      player.playerNumber === 3
                        ? room.gameState.player3Hand
                        : room.gameState.player3Hand?.map(() => ({
                            hidden: true,
                          })) || [],
                    player4Hand:
                      player.playerNumber === 4
                        ? room.gameState.player4Hand
                        : room.gameState.player4Hand?.map(() => ({
                            hidden: true,
                          })) || [],
                  },
                };
              }

              // Notify others that player reconnected
              socket.to(roomId).emit("playerReconnected", {
                playerNumber: player.playerNumber,
                playerName: player.name,
                message: `${player.name} se vratio u igru`,
              });

              break; // Player can only be in one room
            }
          }

          // Send sessionReconnected response with optional game data
          socket.emit("sessionReconnected", {
            success: true,
            session: {
              sessionToken: existingSession.sessionToken,
              sessionId: session.sessionId,
              wasInGame: reconnectResult.wasInGame,
            },
            user: {
              name: session.userName,
              email: session.email,
              isGuest: session.isGuest,
              userId: session.userId,
            },
            message: `Dobrodošli nazad, ${session.userName}!`,
            // Include game data if player was in a game
            ...(gameResumeData && { gameData: gameResumeData }),
          });

          console.log(`✅ Existing session reconnected: ${session.userName}`);
          return;
        }
      }

      // Stvori novu sesiju
      const sessionData = await sessionManager.createSession(
        userData,
        socket.id
      );

      console.log("🔍 Debug sessionData:", sessionData);

      const user = {
        id: socket.id,
        name: userData.name || `Guest_${socket.id.substring(0, 6)}`,
        isGuest: userData.isGuest !== false,
        email: userData.email || null,
        userId: sessionData.userId || userData.userId, // Use stable userId from session
        sessionToken: sessionData.sessionToken,
        joinedAt: new Date(),
      };

      console.log("🔍 Debug user before emit:", {
        sessionToken: user.sessionToken,
        hasSessionData: !!sessionData,
      });

      connectedUsers.set(socket.id, user);

      // 🆘 FALLBACK: Check if this new user should reconnect to an existing game
      // This handles cases where user lost sessionToken but has game in localStorage
      let fallbackGameResumeData = null;
      console.log("🔍 Checking for fallback game reconnection...");

      for (const [roomId, room] of gameRooms.entries()) {
        const player = room.players?.find(
          (p) =>
            // Match by name for guests who lost sessionToken
            (user.isGuest &&
              p.name === user.name &&
              p.isGuest &&
              !p.isConnected) ||
            // Match by userId if it exists and is stable
            (p.userId && p.userId === user.userId && !p.isConnected)
        );

        if (player) {
          console.log(
            `🔄 Fallback reconnection found for ${user.name} in room ${roomId}`
          );

          // Update player with new connection info
          const oldId = player.id;
          player.id = socket.id;
          player.isConnected = true;
          player.sessionToken = user.sessionToken; // Update to new sessionToken
          player.userId = user.userId; // Ensure userId is current
          delete player.disconnectedAt;

          // Clear disconnect timeout if exists
          if (
            room.disconnectTimeouts &&
            room.disconnectTimeouts.has(player.playerNumber)
          ) {
            clearTimeout(room.disconnectTimeouts.get(player.playerNumber));
            room.disconnectTimeouts.delete(player.playerNumber);
            console.log(
              `⏰ Cleared disconnect timeout for player ${player.playerNumber} in room ${roomId}`
            );
          }

          console.log(
            `🔄 Fallback updated player in room ${roomId}: ${oldId} → ${socket.id} (${player.name})`
          );

          // Join socket to room
          socket.join(roomId);

          // Prepare game state for frontend
          let fallbackGameResumeData;

          if (room.gameMode === "1v1") {
            // 1v1 game structure
            const opponent = room.players.find(
              (p) => p.playerNumber !== player.playerNumber
            );

            fallbackGameResumeData = {
              roomId,
              playerNumber: player.playerNumber,
              opponent: opponent
                ? {
                    name: opponent.name,
                    userId: opponent.userId,
                    playerNumber: opponent.playerNumber,
                    isConnected: opponent.isConnected,
                  }
                : null,
              gameType: room.gameType,
              gameMode: room.gameMode,
              players: room.players.map((p) => ({
                name: p.name,
                playerNumber: p.playerNumber,
                isConnected: p.isConnected,
                userId: p.userId,
              })),
              gameState: {
                ...room.gameState,
                myHand:
                  room.gameState[`player${player.playerNumber}Hand`] || [],
                opponentHand:
                  room.gameState[
                    `player${player.playerNumber === 1 ? 2 : 1}Hand`
                  ]?.map(() => ({ hidden: true })) || [],
              },
            };
          } else if (room.gameMode === "2v2") {
            // 2v2 game structure - provide complete game state like Game2v2 expects
            fallbackGameResumeData = {
              roomId,
              playerNumber: player.playerNumber,
              myTeam: player.team, // Add team info for 2v2
              gameType: room.gameType,
              gameMode: room.gameMode,
              akuzeEnabled: room.akuzeEnabled, // Add akuze flag
              players: room.players.map((p) => ({
                name: p.name,
                playerNumber: p.playerNumber,
                isConnected: p.isConnected,
                userId: p.userId,
                team: p.team,
              })),
              gameState: {
                ...room.gameState,
                // Provide player's own hand
                myHand:
                  room.gameState[`player${player.playerNumber}Hand`] || [],
                // Hide other players' hands
                player1Hand:
                  player.playerNumber === 1
                    ? room.gameState.player1Hand
                    : room.gameState.player1Hand?.map(() => ({
                        hidden: true,
                      })) || [],
                player2Hand:
                  player.playerNumber === 2
                    ? room.gameState.player2Hand
                    : room.gameState.player2Hand?.map(() => ({
                        hidden: true,
                      })) || [],
                player3Hand:
                  player.playerNumber === 3
                    ? room.gameState.player3Hand
                    : room.gameState.player3Hand?.map(() => ({
                        hidden: true,
                      })) || [],
                player4Hand:
                  player.playerNumber === 4
                    ? room.gameState.player4Hand
                    : room.gameState.player4Hand?.map(() => ({
                        hidden: true,
                      })) || [],
              },
            };
          }

          // Notify others that player reconnected
          socket.to(roomId).emit("playerReconnected", {
            playerNumber: player.playerNumber,
            playerName: player.name,
            message: `${player.name} se vratio u igru`,
          });

          break; // Player can only be in one room
        }
      }

      socket.emit("registered", {
        success: true,
        session: sessionData,
        user: user,
        message: `Dobrodošli, ${user.name}!`,
        // Include game data if fallback reconnection found
        ...(fallbackGameResumeData && { gameData: fallbackGameResumeData }),
      });

      console.log(
        `✅ Nova sesija kreirana: ${user.name} (${
          user.isGuest ? "Guest" : "Registered"
        })`
      );
    } catch (error) {
      console.error("Error during registration:", error);
      socket.emit("registrationError", {
        success: false,
        message: "Greška prilikom registracije",
        error: error.message,
      });
    }
  });

  // Heartbeat handler
  socket.on("heartbeat", async (data) => {
    if (data.sessionToken) {
      const updated = sessionManager.updateHeartbeat(data.sessionToken);
      if (!updated) {
        socket.emit("sessionExpired", { message: "Sesija je istekla" });
      }
    }
  });

  // Custom game handlers
  socket.on("createGame", async (gameData) => {
    const user = connectedUsers.get(socket.id);
    if (!user) {
      socket.emit("gameCreationError", {
        message: "Korisnik nije registriran",
      });
      return;
    }

    console.log("🎮 Received createGame request:", gameData);
    console.log("🎮 From user:", user);

    try {
      const roomId = uuidv4();
      const customRoom = {
        id: roomId,
        name: gameData.gameName,
        gameType: gameData.gameType,
        gameMode: gameData.gameMode,
        creator: user.name,
        createdAt: new Date(),
        isCustom: true,
        hasPassword: !!gameData.password,
        password: gameData.password || null,
        maxPlayers: gameData.gameMode === "2v2" ? 4 : 2,
        // Include akuze setting for Treseta
        ...(gameData.gameType === "treseta" &&
          gameData.akuzeEnabled !== undefined && {
            akuzeEnabled: gameData.akuzeEnabled,
          }),
        players: [
          {
            id: socket.id,
            name: user.name,
            userId: user.userId,
            sessionToken: user.sessionToken, // Add sessionToken for reliable reconnection
            isGuest: user.isGuest,
            playerNumber: 1,
            isConnected: true,
            team: gameData.gameMode === "2v2" ? 1 : null,
          },
        ],
        spectators: [], // Array of socket IDs for spectators
        gameState: {
          gamePhase: "waiting", // waiting, playing, finished
          version: 1,
        },
        status: "waiting", // waiting, full, playing
      };

      gameRooms.set(roomId, customRoom);
      socket.join(roomId);

      console.log(
        `🎮 Custom game created: ${gameData.gameName} by ${user.name}`
      );

      socket.emit("gameCreated", {
        success: true,
        roomId: roomId,
        gameData: customRoom,
      });

      // Broadcast updated game list to all clients in lobby
      broadcastGameList();
    } catch (error) {
      console.error("Error creating custom game:", error);
      socket.emit("gameCreationError", {
        message: "Greška prilikom stvaranja igre",
        error: error.message,
      });
    }
  });

  socket.on("deleteGame", async (deleteData) => {
    const user = connectedUsers.get(socket.id);
    if (!user) {
      socket.emit("gameDeletionError", {
        message: "Korisnik nije registriran",
      });
      return;
    }

    const { roomId } = deleteData;
    const room = gameRooms.get(roomId);

    if (!room) {
      socket.emit("gameDeletionError", { message: "Igra ne postoji" });
      return;
    }

    if (!room.isCustom) {
      socket.emit("gameDeletionError", {
        message: "Ova igra nije custom igra",
      });
      return;
    }

    // Check if user is the creator
    if (room.creator !== user.name) {
      socket.emit("gameDeletionError", {
        message: "Možete obrisati samo igre koje ste vi stvorili",
      });
      return;
    }

    if (room.status === "playing") {
      socket.emit("gameDeletionError", {
        message: "Ne možete obrisati igru koja je u tijeku",
      });
      return;
    }

    try {
      console.log(`🗑️ Deleting game: ${room.name} by ${user.name}`);

      // Notify all players in the room that the game is being deleted
      room.players.forEach((player) => {
        if (player.id !== socket.id) {
          io.to(player.id).emit("gameDeleted", {
            message: `Igra "${room.name}" je obrisana od strane kreatora.`,
            roomId: roomId,
          });
        }
      });

      // Remove all players from the room
      room.players.forEach((player) => {
        io.sockets.sockets.get(player.id)?.leave(roomId);
      });

      // Remove the room
      gameRooms.delete(roomId);

      socket.emit("gameDeleted", {
        success: true,
        message: `Igra "${room.name}" je uspješno obrisana.`,
        roomId: roomId,
      });

      // Broadcast updated game list to all clients in lobby
      broadcastGameList();
    } catch (error) {
      console.error("Error deleting game:", error);
      socket.emit("gameDeletionError", {
        message: "Greška prilikom brisanja igre",
        error: error.message,
      });
    }
  });

  socket.on("joinGame", async (joinData) => {
    const user = connectedUsers.get(socket.id);
    if (!user) {
      socket.emit("joinGameError", { message: "Korisnik nije registriran" });
      return;
    }

    const { roomId, password } = joinData;
    const room = gameRooms.get(roomId);

    if (!room) {
      socket.emit("joinGameError", { message: "Igra ne postoji" });
      return;
    }

    if (!room.isCustom) {
      socket.emit("joinGameError", { message: "Ova igra nije custom igra" });
      return;
    }

    if (room.status === "playing") {
      socket.emit("joinGameError", { message: "Igra je već u tijeku" });
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit("joinGameError", { message: "Igra je puna" });
      return;
    }

    // Check if player is already in the room
    const existingPlayer = room.players.find(
      (p) =>
        (p.userId === user.userId && !user.isGuest) ||
        (p.name === user.name && user.isGuest)
    );

    if (existingPlayer) {
      socket.emit("joinGameError", { message: "Već ste u ovoj igri" });
      return;
    }

    if (room.hasPassword && room.password !== password) {
      socket.emit("joinGameError", { message: "Neispravna šifra" });
      return;
    }

    // Add player to room
    const playerNumber = room.players.length + 1;
    const newPlayer = {
      id: socket.id,
      name: user.name,
      userId: user.userId,
      sessionToken: user.sessionToken, // Add sessionToken for reliable reconnection
      isGuest: user.isGuest,
      playerNumber: playerNumber,
      isConnected: true,
      team: room.gameMode === "2v2" ? Math.ceil(playerNumber / 2) : null,
    };

    room.players.push(newPlayer);
    socket.join(roomId);

    console.log(`👥 ${user.name} joined custom game: ${room.name}`);

    // Update room status
    if (room.players.length === room.maxPlayers) {
      room.status = "full";
    }

    socket.emit("gameJoined", {
      success: true,
      roomId: roomId,
      gameData: room,
    });

    // Notify all players in the room
    io.to(roomId).emit("playerJoined", {
      player: newPlayer,
      gameData: room,
    });

    // If room is full, start the game
    if (room.players.length === room.maxPlayers) {
      startCustomGame(roomId);
    }

    // Broadcast updated game list
    broadcastGameList();
  });

  socket.on("getActiveGames", (data) => {
    const requestedGameType = data?.gameType;
    console.log(
      `📋 Requesting active games for gameType: ${requestedGameType}`
    );

    let customGames = Array.from(gameRooms.values()).filter(
      (room) => room.isCustom && room.status !== "playing"
    );

    // Filter by gameType if specified
    if (requestedGameType) {
      customGames = customGames.filter(
        (room) => room.gameType === requestedGameType
      );
      console.log(
        `🎯 Filtered to ${customGames.length} ${requestedGameType} games`
      );
    }

    const gamesList = customGames.map((room) => ({
      id: room.id,
      name: room.name,
      gameType: room.gameType,
      gameMode: room.gameMode,
      creator: room.creator,
      playerCount: room.players.length,
      maxPlayers: room.maxPlayers,
      hasPassword: room.hasPassword,
      status: room.status,
      createdAt: room.createdAt,
    }));

    socket.emit("activeGamesUpdate", gamesList);
  });

  socket.on("leaveCustomGame", (roomId) => {
    const user = connectedUsers.get(socket.id);
    const room = gameRooms.get(roomId);

    if (!room || !user) return;

    const playerIndex = room.players.findIndex((p) => p.id === socket.id);
    if (playerIndex === -1) return;

    const leavingPlayer = room.players[playerIndex];
    room.players.splice(playerIndex, 1);
    socket.leave(roomId);

    console.log(`🚪 ${user.name} left custom game: ${room.name}`);

    // If room is empty, delete it
    if (room.players.length === 0) {
      gameRooms.delete(roomId);
      console.log(`🗑️ Empty custom room deleted: ${room.name}`);
    } else {
      // Update player numbers and teams
      room.players.forEach((player, index) => {
        player.playerNumber = index + 1;
        if (room.gameMode === "2v2") {
          player.team = Math.ceil(player.playerNumber / 2);
        }
      });

      // If creator left, assign new creator
      if (leavingPlayer.name === room.creator) {
        room.creator = room.players[0].name;
      }

      room.status = "waiting";

      // Notify remaining players
      io.to(roomId).emit("playerLeft", {
        playerName: leavingPlayer.name,
        gameData: room,
      });
    }

    broadcastGameList();
  });

  // Traženje protivnika (matchmaking) - UPDATED za 1v1 i 2v2 + gameType
  socket.on("findMatch", (data) => {
    const user = connectedUsers.get(socket.id);
    if (!user) {
      socket.emit("error", { message: "Morate se prvo registrirati" });
      return;
    }

    const gameMode = data?.gameMode || "1v1";
    const gameType = data?.gameType || "briskula"; // Dodano gameType
    const queue = gameMode === "1v1" ? waitingQueue1v1 : waitingQueue2v2;
    const playersNeeded = gameMode === "1v1" ? 2 : 4;

    // Dodaj gameType informaciju u user podatke za queue
    const userWithGameInfo = { ...user, gameType };

    // Provjeri je li korisnik već u bilo kojem queue-u
    const existingIndex1v1 = waitingQueue1v1.findIndex(
      (u) => u.id === socket.id
    );
    const existingIndex2v2 = waitingQueue2v2.findIndex(
      (u) => u.id === socket.id
    );

    if (existingIndex1v1 !== -1 || existingIndex2v2 !== -1) {
      socket.emit("matchmaking", {
        status: "already_waiting",
        message: "Već čekate protivnike...",
        queuePosition: Math.max(existingIndex1v1, existingIndex2v2) + 1,
      });
      return;
    }

    // Dodaj u odgovarajući queue
    queue.push(userWithGameInfo);

    // Ako ima dovoljno korisnika u queue, napravi match
    if (queue.length >= playersNeeded) {
      const players = [];
      for (let i = 0; i < playersNeeded; i++) {
        players.push(queue.shift());
      }

      // Provjeri da svi igrači igraju isti gameType
      const firstGameType = players[0].gameType;
      const allSameGameType = players.every(
        (p) => p.gameType === firstGameType
      );

      if (!allSameGameType) {
        // Ako gameType nije isti, vrati igrače u queue
        players.forEach((player) => queue.unshift(player));
        socket.emit("matchmaking", {
          status: "waiting",
          message: `Tražimo igrače za ${gameType}...`,
          queuePosition: queue.length,
        });
        return;
      }

      if (gameMode === "1v1") {
        createGameRoom1v1(players[0], players[1], firstGameType);
      } else {
        createGameRoom2v2(players, firstGameType);
      }
    } else {
      socket.emit("matchmaking", {
        status: "waiting",
        message: `Tražimo ${gameMode === "1v1" ? "protivnika" : "igrače"}...`,
        queuePosition: queue.length,
      });
    }
  });

  // Odustajanje od traženja - UPDATED
  socket.on("cancelMatch", () => {
    // Ukloni iz oba queue-a
    const index1v1 = waitingQueue1v1.findIndex((u) => u.id === socket.id);
    const index2v2 = waitingQueue2v2.findIndex((u) => u.id === socket.id);

    if (index1v1 !== -1) {
      waitingQueue1v1.splice(index1v1, 1);
    }
    if (index2v2 !== -1) {
      waitingQueue2v2.splice(index2v2, 1);
    }

    socket.emit("matchmaking", { status: "cancelled" });
  });

  // Igranje karte - UPDATED za oba načina
  socket.on("playCard", (data) => {
    const { roomId, card } = data;
    console.log(`🎴 Pokušaj igranja karte:`, {
      playerId: socket.id,
      roomId,
      cardName: card?.name + " " + card?.suit,
    });

    const room = gameRooms.get(roomId);

    if (!room) {
      console.log(`❌ Soba ${roomId} ne postoji`);
      socket.emit("error", { message: "Soba ne postoji" });
      return;
    }

    // Provjeri je li red ovog igrača
    const player = room.players.find((p) => p.id === socket.id);

    // Guards against spectators / forfeited players
    if (!player) {
      socket.emit("error", { message: "Niste igrač u ovoj sobi" });
      return;
    }
    if (player.permanentlyLeft) {
      socket.emit("error", { message: "Napustili ste ovu igru" });
      return;
    }
    if (!player.isConnected) {
      socket.emit("error", { message: "Niste trenutno povezani u igri" });
      return;
    }
    const playerNumber = player?.playerNumber;

    console.log(`🔍 Provjera reda:`, {
      playerNumber,
      currentPlayer: room.gameState.currentPlayer,
      isPlayersTurn: room.gameState.currentPlayer === playerNumber,
    });

    if (!playerNumber || room.gameState.currentPlayer !== playerNumber) {
      console.log(
        `❌ Nije red igrača ${playerNumber}, trenutni red: ${room.gameState.currentPlayer}`
      );
      socket.emit("error", { message: "Nije vaš red" });
      return;
    }

    // Additional check: Has this player already played a card this round?
    const playerAlreadyPlayed =
      room.gameState.playedCards &&
      room.gameState.playedCards.some(
        (playedCard) => playedCard && playedCard.playerNumber === playerNumber
      );

    if (playerAlreadyPlayed) {
      console.log(`❌ Igrač ${playerNumber} je već odigrao kartu u ovoj rundi`);
      socket.emit("error", { message: "Već ste odigrali kartu u ovoj rundi" });
      return;
    }

    console.log(`✅ Kartu može igrati, obrađujem potez`);

    // Obradi potez ovisno o načinu igre
    if (room.gameMode === "1v1") {
      processCardPlay1v1(roomId, socket.id, card);
    } else {
      processCardPlay2v2(roomId, socket.id, card);
    }
  });

  // Akuže handler for Treseta (1v1 and 2v2)
  socket.on("akuze", (data) => {
    const { roomId, akuz } = data;
    console.log(`🃏 Akuže declared:`, {
      playerId: socket.id,
      roomId,
      akuz,
    });

    const room = gameRooms.get(roomId);
    if (!room || room.gameType !== "treseta") {
      socket.emit("error", { message: "Akuže nije dostupno za ovu igru" });
      return;
    }

    // Check if akuze is enabled (for both 1v1 and 2v2)
    if (room.akuzeEnabled === false) {
      socket.emit("error", { message: "Akuže je onemogućeno za ovu igru" });
      return;
    }

    const player = room.players.find((p) => p.id === socket.id);

    if (!player) {
      socket.emit("error", { message: "Niste igrač u ovoj sobi" });
      return;
    }
    if (player.permanentlyLeft) {
      socket.emit("error", { message: "Napustili ste ovu igru" });
      return;
    }
    if (!player.isConnected) {
      socket.emit("error", { message: "Niste trenutno povezani u igri" });
      return;
    }
    const playerNumber = player?.playerNumber;

    if (!playerNumber) {
      socket.emit("error", { message: "Igrač nije pronađen" });
      return;
    }

    // Add akuz to player's akuze list
    const akuzeKey = `player${playerNumber}Akuze`;
    if (!room.gameState[akuzeKey]) {
      room.gameState[akuzeKey] = { points: 0, details: [] };
    }

    room.gameState[akuzeKey].details.push(akuz);
    room.gameState[akuzeKey].points += akuz.points;

    console.log(`✅ Akuže registered for player ${playerNumber}:`, akuz);

    if (room.gameMode === "2v2") {
      // 2v2 mode - also add to team akuze for tracking
      const team = playerNumber === 1 || playerNumber === 3 ? 1 : 2;
      const teamAkuzeKey = `team${team}Akuze`;
      if (!room.gameState[teamAkuzeKey]) {
        room.gameState[teamAkuzeKey] = [];
      }
      room.gameState[teamAkuzeKey].push({
        playerNumber,
        playerName: player.name,
        ...akuz,
      });

      // Broadcast akuze to all players with team info
      io.to(roomId).emit("akuzeAnnounced", {
        playerNumber,
        playerName: player.name,
        akuz,
        team,
      });
    } else {
      // 1v1 mode - simple broadcast without team info
      io.to(roomId).emit("akuzeAnnounced", {
        playerNumber,
        playerName: player.name,
        akuz,
      });
    }

    // Save updated game state
    gameStateManager.saveGameState(roomId, room);
    // Inform spectators (public view only) about akuze changes
    broadcastSpectatorUpdate(room);
  });

  // Start new partija event (for manual trigger)
  socket.on("startNewPartija", (data) => {
    const { roomId, playerNumber } = data;
    console.log(
      `🔄 Player ${playerNumber} requesting new partija in room ${roomId}`
    );

    const room = gameRooms.get(roomId);
    if (!room) {
      socket.emit("error", { message: "Soba ne postoji" });
      return;
    }

    if (room.gameType !== "treseta" || room.gameMode !== "1v1") {
      socket.emit("error", {
        message: "Nova partija je dostupna samo za Trešeta 1v1",
      });
      return;
    }

    // Check if this is a valid request (partija just finished)
    if (!room.gameState.totalPlayer1Points !== undefined) {
      socket.emit("error", {
        message: "Nova partija nije moguća u ovom trenutku",
      });
      return;
    }

    // Start new partija immediately
    startNewPartija(room);
  });

  // Leave room event (temporary - can reconnect)
  socket.on("leaveRoom", (roomId) => {
    const room = gameRooms.get(roomId);
    if (!room) return;

    // Check if this is a spectator first
    if (room.spectators && room.spectators.includes(socket.id)) {
      console.log(`👁️ Spectator ${socket.id} left room ${roomId}`);
      // Remove from spectators list only - don't disrupt the game
      room.spectators = room.spectators.filter((id) => id !== socket.id);
      socket.leave(roomId);
      return;
    }

    const leavingPlayer = room.players.find((p) => p.id === socket.id);
    if (!leavingPlayer) return;

    // Note: Actual disconnect handling is done by handlePlayerDisconnectWithReconnect
    // in the main 'disconnect' event. This is just for explicit leave requests.
    console.log(
      `🚪 Player ${leavingPlayer.name} explicitly requested to leave room ${roomId}`
    );
    socket.leave(roomId); // remove this socket from room
  });

  // Leave room permanently (no reconnect possible)
  socket.on("leaveRoomPermanently", async (roomId) => {
    const room = gameRooms.get(roomId);
    if (!room) return;

    // Check if this is a spectator first
    if (room.spectators && room.spectators.includes(socket.id)) {
      console.log(`👁️ Spectator ${socket.id} left room ${roomId} permanently`);
      // Remove from spectators list only - don't disrupt the game
      room.spectators = room.spectators.filter((id) => id !== socket.id);
      socket.leave(roomId);
      return;
    }

    const leavingPlayer = room.players.find((p) => p.id === socket.id);
    if (!leavingPlayer) return;

    console.log(
      `🚪 Igrač ${leavingPlayer.name} (${leavingPlayer.playerNumber}) je trajno napustio ${room.gameMode} igru`
    );

    // Clear any saved session/game state for this player
    try {
      const userSession = await sessionManager.findSessionByUser(
        leavingPlayer.name
      );
      if (userSession) {
        await sessionManager.markSessionAsLeft(userSession.id);
        console.log(`🗑️ Cleared session for ${leavingPlayer.name}`);
      }
    } catch (error) {
      console.log("Session cleanup failed:", error.message);
    }

    let message;
    if (room.gameMode === "2v2") {
      const teamInfo = `Tim ${leavingPlayer.team} (igrač ${leavingPlayer.playerNumber})`;
      message = `${leavingPlayer.name} je napustio sobu - ${teamInfo}`;
    } else {
      message = `${leavingPlayer.name} je napustio sobu.`;
    }

    const isTournamentRoom = room.type === "tournament";
    leavingPlayer.permanentlyLeft = true;
    leavingPlayer.isConnected = false;

    let opponent = null;
    if (room.players.length > 1) {
      opponent = room.players.find(
        (p) => p.playerNumber !== leavingPlayer.playerNumber
      );
    }

    // Remove player from active list then cleanup like old system
    leavingPlayer.permanentlyLeft = true;
    leavingPlayer.forfeited = true;

    // Remove player session (prevents future reconnection)
    if (leavingPlayer.playerId) {
      removePlayerSession(leavingPlayer.playerId);
    }

    // Use old cleanup system with clear roomDeleted message
    let leaveMessage;
    if (room.gameMode === "2v2") {
      const teamInfo = `Tim ${leavingPlayer.team} (igrač ${leavingPlayer.playerNumber})`;
      leaveMessage = `${leavingPlayer.name} je napustio sobu - ${teamInfo}`;
    } else {
      leaveMessage = `${leavingPlayer.name} je napustio sobu.`;
    }

    // Notify other players about leave
    io.to(roomId).emit("playerLeft", {
      playerNumber: leavingPlayer.playerNumber,
      message: leaveMessage,
      gameMode: room.gameMode,
      playerTeam: leavingPlayer.team || null,
      permanent: true,
    });

    // Clean up game storage
    try {
      await gameStateManager.deleteGame(roomId);
      console.log(`🗑️ Deleted game storage for room ${roomId}`);
    } catch (error) {
      console.log("Game storage cleanup failed:", error.message);
    }

    // Clean up sessions for all players
    try {
      for (const player of room.players) {
        const playerSession = await sessionManager.findSessionByUser(
          player.name
        );
        if (playerSession) {
          await sessionManager.markSessionAsLeft(playerSession.id);
          console.log(`🗑️ Cleared session for ${player.name}`);
        }
      }
    } catch (error) {
      console.log("Session cleanup for room players failed:", error.message);
    }

    // Send the old clear roomDeleted message that worked well
    io.to(roomId).emit("roomDeleted", {
      message: `Protivnik je odustao od igre. Soba je obrisana.`,
      redirectToMenu: true,
    });

    gameRooms.delete(roomId);
    socket.leave(roomId);
  });

  // Handle reconnect dismissal - when player chooses to abandon reconnection
  socket.on("dismissReconnect", async (roomId) => {
    console.log(
      `🚫 Player ${socket.id} dismissed reconnection to room ${roomId}`
    );

    const room = gameRooms.get(roomId);
    if (!room) {
      console.log(`❌ Room ${roomId} not found for dismissal`);
      return;
    }

    // Find the player who is dismissing
    const dismissingPlayer = room.players.find((p) => p.id === socket.id);
    const dismissingPlayerName = dismissingPlayer
      ? dismissingPlayer.name
      : "Unknown Player";

    console.log(
      `🚫 ${dismissingPlayerName} odustaje od ponovnog spajanja na sobu ${roomId}`
    );

    // Delete the room and all related data since one player abandoned reconnection
    try {
      await gameStateManager.deleteGame(roomId);
      console.log(`🗑️ Deleted game storage for abandoned room ${roomId}`);
    } catch (error) {
      console.log("Game storage cleanup failed:", error.message);
    }

    // Clear sessions for all players in this room
    try {
      for (const player of room.players) {
        const playerSession = await sessionManager.findSessionByUser(
          player.name
        );
        if (playerSession) {
          await sessionManager.markSessionAsLeft(playerSession.id);
          console.log(
            `🗑️ Cleared session for ${player.name} due to room abandonment`
          );
        }
      }
    } catch (error) {
      console.log("Session cleanup for abandoned room failed:", error.message);
    }

    // Notify any other players who might be trying to reconnect
    io.to(roomId).emit("roomDeleted", {
      message: `Protivnik je odustao od igre. Soba je obrisana.`,
      redirectToMenu: true,
    });

    // Delete room from memory
    gameRooms.delete(roomId);
    socket.leave(roomId);
    console.log(
      `🗑️ Soba ${roomId} obrisana jer je igrač odustao od reconnection-a.`
    );
  });

  // Leave tournament view (non-destructive, only leaves socket room)
  socket.on("leaveTournamentView", (roomId) => {
    try {
      const room = gameRooms.get(roomId);
      if (!room) return;
      const player = room.players.find((p) => p.id === socket.id);
      console.log(
        `👀 ${
          player?.name || socket.id
        } left tournament view for room ${roomId}`
      );
      socket.leave(roomId);
    } catch (e) {
      console.log("leaveTournamentView error:", e.message);
    }
  });

  // Legacy reconnection handler for old format
  socket.on("reconnectToGameLegacy", async (reconnectData) => {
    try {
      console.log(`  Legacy reconnection attempt from ${socket.id}:`, {
        roomId: reconnectData?.roomId,
        sessionToken: reconnectData?.sessionToken ? "present" : "missing",
        userName: reconnectData?.playerName,
      });

      if (!reconnectData || !reconnectData.roomId) {
        socket.emit("reconnectFailed", {
          message: "Neispravni podaci za reconnect",
        });
        return;
      }

      // This handler now serves as legacy fallback only
      // Main reconnection should use the simpler handler below
      socket.emit("reconnectFailed", {
        message: "Koristi novi reconnect method",
      });
    } catch (error) {
      socket.emit("reconnectFailed", {
        message: "Greška prilikom reconnection",
        error: error.message,
      });
    }
  });

  // Simple reconnect by playerId/roomId (for refresh scenarios)
  socket.on(
    "reconnectToGame",
    async ({ playerId, roomId, sessionToken, playerName, userId }) => {
      try {
        console.log(
          `🔄 Simple reconnect attempt: ${playerId} -> Room ${roomId}`,
          {
            hasSessionToken: !!sessionToken,
            playerName,
            userId,
          }
        );

        if (!playerId || !roomId) {
          socket.emit("reconnectError", {
            message: "Nedostaju podaci za reconnect",
          });
          return;
        }

        // Validate session if provided
        if (sessionToken) {
          try {
            const userSession = await sessionManager.findSessionByToken(
              sessionToken
            );
            if (!userSession) {
              socket.emit("reconnectError", {
                message: "Sesija nije važeća",
              });
              return;
            }
          } catch (err) {
            console.log("Session validation failed:", err.message);
          }
        }

        const room = gameRooms.get(roomId);
        if (!room) {
          console.log(`❌ Room ${roomId} not found`);
          socket.emit("reconnectError", { message: "Soba više ne postoji" });
          return;
        }

        // Find player by sessionToken or fallback to name/userId
        let player = null;

        if (sessionToken) {
          // Try to find player by sessionToken through session manager
          try {
            const userSession = await sessionManager.findSessionByToken(
              sessionToken
            );
            if (userSession) {
              // Find player by userId or name from session
              player = room.players.find(
                (p) =>
                  (p.userId === userSession.userId && !userSession.isGuest) ||
                  (p.name === userSession.userName && userSession.isGuest)
              );

              if (!player) {
                // Fallback: find by playerName and userId from request
                player = room.players.find(
                  (p) => p.name === playerName || p.userId === userId
                );
              }
            }
          } catch (err) {
            console.log("Session-based player lookup failed:", err.message);
          }
        }

        // Final fallback: try original playerId lookup AND userId/name matching
        if (!player) {
          player = room.players.find(
            (p) =>
              p.id === playerId ||
              p.playerId === playerId ||
              p.name === playerName ||
              (p.userId && userId && p.userId === userId)
          );
        }

        // If still not found, try disconnected player matching
        if (!player) {
          player = room.players.find(
            (p) =>
              !p.isConnected &&
              (p.name === playerName ||
                (p.userId && userId && p.userId === userId))
          );

          if (player) {
            console.log(
              `🔄 Found disconnected player ${player.name} for reconnection`
            );
          }
        }

        if (!player) {
          console.log(`❌ Player ${playerId} not found in room ${roomId}`, {
            requestedPlayerId: playerId,
            requestedPlayerName: playerName,
            requestedUserId: userId,
            playersInRoom: room.players.map((p) => ({
              id: p.id,
              playerId: p.playerId,
              name: p.name,
              userId: p.userId,
              playerNumber: p.playerNumber,
              isConnected: p.isConnected,
            })),
          });
          socket.emit("reconnectError", { message: "Niste dio ove igre" });
          return;
        }

        if (player.permanentlyLeft) {
          console.log(`❌ Player ${playerId} permanently left`);
          socket.emit("reconnectError", {
            message: "Napustili ste ovu igru i ne možete se vratiti",
          });
          return;
        }

        // Update player connection
        player.id = socket.id;
        player.isConnected = true;
        delete player.disconnectedAt;

        // Clear disconnect timeout if exists
        if (
          room.disconnectTimeouts &&
          room.disconnectTimeouts.has(player.playerNumber)
        ) {
          const timeoutId = room.disconnectTimeouts.get(player.playerNumber);
          clearTimeout(timeoutId);
          room.disconnectTimeouts.delete(player.playerNumber);
          console.log(
            `⏰ Cleared disconnect timeout ${timeoutId} for player ${player.playerNumber} in room ${roomId}`
          );
        } else {
          console.log(
            `⚠️ No disconnect timeout found for player ${player.playerNumber} in room ${roomId}`
          );
        }

        // Update session mapping
        updatePlayerSession(playerId, socket.id);

        // Update connected users
        connectedUsers.set(socket.id, {
          ...player,
          id: socket.id,
          sessionToken: sessionToken,
          name: player.name,
          userId: player.userId || userId,
        });

        // Join socket room
        socket.join(roomId);

        // Calculate playable cards for Treseta
        let playableCards = null;
        if (
          room.gameType === "treseta" &&
          room.gameState.gamePhase === "playing"
        ) {
          const gameLogic = await import("../core/gameLogicTreseta.js");
          const { getPlayableCards } = gameLogic;
          const playedCardsOnly = room.gameState.playedCards.map(
            (pc) => pc.card
          );
          const playerHand = room.gameState[`player${player.playerNumber}Hand`];
          playableCards = getPlayableCards(playerHand, playedCardsOnly);
        }

        // Send personalized game state based on game mode
        let reconnectResponse;

        if (room.gameMode === "1v1") {
          // 1v1 game structure
          const opponent = room.players.find(
            (p) => p.playerNumber !== player.playerNumber
          );

          reconnectResponse = {
            success: true,
            roomId,
            playerId: playerId, // Include playerId for frontend storage
            playerNumber: player.playerNumber,
            opponent: opponent
              ? {
                  name: opponent.name,
                  userId: opponent.userId,
                  playerNumber: opponent.playerNumber,
                  isConnected: opponent.isConnected,
                }
              : null,
            gameType: room.gameType,
            gameMode: room.gameMode,
            players: room.players.map((p) => ({
              name: p.name,
              playerNumber: p.playerNumber,
              isConnected: p.isConnected,
              userId: p.userId,
            })),
            gameState: {
              ...room.gameState,
              // Show my cards, hide opponent's cards
              [`player${player.playerNumber}Hand`]:
                room.gameState[`player${player.playerNumber}Hand`],
              [`player${player.playerNumber === 1 ? 2 : 1}Hand`]:
                room.gameState[
                  `player${player.playerNumber === 1 ? 2 : 1}Hand`
                ].map(() => ({ hidden: true })),
              playableCards: playableCards || [],
              // Add personalized points mapping
              myPoints:
                player.playerNumber === 1
                  ? room.gameState.player1Points || 0
                  : room.gameState.player2Points || 0,
              opponentPoints:
                player.playerNumber === 1
                  ? room.gameState.player2Points || 0
                  : room.gameState.player1Points || 0,
            },
            isTournamentMatch: room.type === "tournament",
            tournamentId: room.tournamentId,
            matchId: room.matchId,
          };
        } else if (room.gameMode === "2v2") {
          // 2v2 game structure - like gameStart format
          reconnectResponse = {
            success: true,
            roomId,
            playerId: playerId,
            playerNumber: player.playerNumber,
            myTeam: player.team,
            gameType: room.gameType,
            gameMode: room.gameMode,
            akuzeEnabled: room.akuzeEnabled,
            players: room.players.map((p) => ({
              name: p.name,
              userId: p.userId,
              playerNumber: p.playerNumber,
              isConnected: p.isConnected,
              team: p.team,
            })),
            gameState: {
              ...room.gameState,
              // Provide player's own hand
              myHand: room.gameState[`player${player.playerNumber}Hand`] || [],
              // Hide other players' hands
              player1Hand:
                player.playerNumber === 1
                  ? room.gameState.player1Hand
                  : room.gameState.player1Hand?.map(() => ({ hidden: true })) ||
                    [],
              player2Hand:
                player.playerNumber === 2
                  ? room.gameState.player2Hand
                  : room.gameState.player2Hand?.map(() => ({ hidden: true })) ||
                    [],
              player3Hand:
                player.playerNumber === 3
                  ? room.gameState.player3Hand
                  : room.gameState.player3Hand?.map(() => ({ hidden: true })) ||
                    [],
              player4Hand:
                player.playerNumber === 4
                  ? room.gameState.player4Hand
                  : room.gameState.player4Hand?.map(() => ({ hidden: true })) ||
                    [],
              playableCards: playableCards || [],
            },
            isTournamentMatch: room.type === "tournament",
            tournamentId: room.tournamentId,
            matchId: room.matchId,
          };
        }

        console.log(
          `[reconnectToGame] Sending gameStateReconnected to ${player.name}:`,
          {
            roomId: reconnectResponse.roomId,
            playerNumber: reconnectResponse.playerNumber,
            myHandCount:
              reconnectResponse.gameState[`player${player.playerNumber}Hand`]
                ?.length,
            opponentHandCount:
              reconnectResponse.gameState[
                `player${player.playerNumber === 1 ? 2 : 1}Hand`
              ]?.length,
            playableCardsCount:
              reconnectResponse.gameState.playableCards?.length,
            gamePhase: reconnectResponse.gameState.gamePhase,
          }
        );

        socket.emit("gameStateReconnected", reconnectResponse);

        // Notify others
        socket.to(roomId).emit("playerReconnected", {
          playerNumber: player.playerNumber,
          playerName: player.name,
          message: `${player.name} se reconnected`,
        });

        console.log(
          `✅ ${player.name} successfully reconnected to room ${roomId}`
        );
      } catch (error) {
        console.error("Error in simple reconnect:", error);
        socket.emit("reconnectError", { message: "Greška pri reconnection" });
      }
    }
  );

  // New resumeGame handler - send gameStart instead of gameStateReconnected
  socket.on("resumeGame", async ({ roomId, sessionToken }) => {
    try {
      console.log(
        `🔄 Resume game attempt: Room ${roomId}, Session ${sessionToken}`
      );

      if (!roomId || !sessionToken) {
        socket.emit("reconnectError", {
          message: "Nedostaju podaci za resume",
        });
        return;
      }

      // Find user by sessionToken
      const userSession = await sessionManager.findSessionByToken(sessionToken);
      if (!userSession) {
        socket.emit("reconnectError", {
          message: "Sesija nije važeća",
        });
        return;
      }

      const room = gameRooms.get(roomId);
      if (!room) {
        console.log(`❌ Room ${roomId} not found`);
        socket.emit("reconnectError", { message: "Soba više ne postoji" });
        return;
      }

      // Find player in room by name or userId
      const player = room.players.find(
        (p) =>
          p.name === userSession.user.name ||
          p.userId === userSession.user.userId
      );
      if (!player) {
        console.log(
          `❌ Player ${userSession.user.name} not found in room ${roomId}`
        );
        socket.emit("reconnectError", { message: "Niste dio ove igre" });
        return;
      }

      if (player.permanentlyLeft) {
        console.log(`❌ Player ${userSession.user.name} permanently left`);
        socket.emit("reconnectError", {
          message: "Napustili ste ovu igru i ne možete se vratiti",
        });
        return;
      }

      // Update player connection
      player.id = socket.id;
      player.isConnected = true;
      delete player.disconnectedAt;

      // Clear disconnect timeout if exists
      if (
        room.disconnectTimeouts &&
        room.disconnectTimeouts.has(player.playerNumber)
      ) {
        clearTimeout(room.disconnectTimeouts.get(player.playerNumber));
        room.disconnectTimeouts.delete(player.playerNumber);
        console.log(
          `⏰ Cleared disconnect timeout for player ${player.playerNumber}`
        );
      }

      // Update connected users
      connectedUsers.set(socket.id, {
        ...userSession.user,
        id: socket.id,
        sessionToken: sessionToken,
      });

      // Join socket room
      socket.join(roomId);

      // Send personalized gameStart like when game originally started
      let gameLogic;
      if (room.gameType === "treseta") {
        gameLogic = await import("../core/gameLogicTreseta.js");
      } else {
        gameLogic = await import("../core/gameLogicBriskula.js");
      }

      const { getPlayableCards } = gameLogic;

      // Calculate playable cards for current player
      let playableCards = [];
      if (room.gameState.gamePhase === "playing") {
        if (room.gameType === "treseta") {
          const playedCardsOnly = room.gameState.playedCards.map(
            (pc) => pc.card
          );
          const playerHand = room.gameState[`player${player.playerNumber}Hand`];
          playableCards = getPlayableCards(playerHand, playedCardsOnly);
        } else {
          // Briskula - all cards are playable
          playableCards = room.gameState[
            `player${player.playerNumber}Hand`
          ].map((c) => c.id);
        }
      }

      // Create personalized gameStart payload like in normal game creation
      const opponent = room.players.find(
        (p) => p.playerNumber !== player.playerNumber
      );

      const resumePayload = {
        roomId,
        playerId: player.playerId || `${roomId}_p${player.playerNumber}`,
        playerNumber: player.playerNumber,
        opponent: opponent
          ? {
              name: opponent.name,
              userId: opponent.userId,
              playerNumber: opponent.playerNumber,
              isConnected: opponent.isConnected,
            }
          : null,
        gameType: room.gameType,
        gameMode: room.gameMode,
        players: room.players.map((p) => ({
          name: p.name,
          playerNumber: p.playerNumber,
          isConnected: p.isConnected,
          userId: p.userId,
        })),
        gameState: {
          ...room.gameState,
          // Show my cards, hide opponent's cards
          [`player${player.playerNumber}Hand`]:
            room.gameState[`player${player.playerNumber}Hand`],
          [`player${player.playerNumber === 1 ? 2 : 1}Hand`]: room.gameState[
            `player${player.playerNumber === 1 ? 2 : 1}Hand`
          ].map(() => ({ hidden: true })),
          playableCards: playableCards,
          // Add personalized points mapping
          myPoints:
            player.playerNumber === 1
              ? room.gameState.player1Points || 0
              : room.gameState.player2Points || 0,
          opponentPoints:
            player.playerNumber === 1
              ? room.gameState.player2Points || 0
              : room.gameState.player1Points || 0,
        },
        ...(room.gameType === "treseta" &&
          room.akuzeEnabled !== undefined && {
            akuzeEnabled: room.akuzeEnabled,
          }),
        isTournamentMatch: room.isTournamentMatch || false,
        tournamentId: room.tournamentId,
        matchId: room.matchId,
        isResume: true, // Flag to indicate this is a resume/reconnect, not a new game
      };

      console.log(`[resumeGame] Sending gameStart to ${player.name}:`, {
        roomId: resumePayload.roomId,
        playerNumber: resumePayload.playerNumber,
        myHandCount:
          resumePayload.gameState[`player${player.playerNumber}Hand`]?.length,
        opponentHandCount:
          resumePayload.gameState[
            `player${player.playerNumber === 1 ? 2 : 1}Hand`
          ]?.length,
        playableCardsCount: resumePayload.gameState.playableCards?.length,
        gamePhase: resumePayload.gameState.gamePhase,
      });

      // Send gameStart event so frontend creates state normally
      socket.emit("gameStart", resumePayload);

      // Notify others that player reconnected
      socket.to(roomId).emit("playerReconnected", {
        playerNumber: player.playerNumber,
        playerName: player.name,
        message: `${player.name} se vratio u igru`,
        isConnected: true,
      });

      console.log(
        `✅ [resumeGame] ${player.name} (p${player.playerNumber}) successfully resumed game in room ${roomId}`
      );
    } catch (error) {
      console.error("Error in resumeGame:", error);
      socket.emit("reconnectError", { message: "Greška pri resume" });
    }
  });

  // Force logout handler for development/cleanup
  socket.on("forceLogout", async (data) => {
    console.log(`🧹 Force logout requested from ${socket.id}`);

    const user = connectedUsers.get(socket.id);

    if (user && data.sessionToken) {
      // Invalidate session completely
      const removed = await sessionManager.invalidateSession(data.sessionToken);
      if (removed) {
        console.log(`✅ Session ${data.sessionToken} forcefully removed`);
      }

      // Remove from game rooms if active
      await handlePlayerDisconnectWithReconnect(socket.id, true); // force = true

      // Remove from queues
      const queueIndex1v1 = waitingQueue1v1.findIndex(
        (u) => u.id === socket.id
      );
      const queueIndex2v2 = waitingQueue2v2.findIndex(
        (u) => u.id === socket.id
      );

      if (queueIndex1v1 !== -1) {
        waitingQueue1v1.splice(queueIndex1v1, 1);
      }
      if (queueIndex2v2 !== -1) {
        waitingQueue2v2.splice(queueIndex2v2, 1);
      }

      // Remove from connected users
      connectedUsers.delete(socket.id);

      // Confirm logout to client
      socket.emit("forceLogoutComplete", {
        success: true,
        message: "Sesija je potpuno obrisana",
      });

      console.log(`🧹 Force logout completed for ${user.name}`);
    }
  });

  // Continue to next partija handler
  socket.on("continueNextPartija", async (data) => {
    const { roomId } = data;
    console.log(
      `🔄 Player ${socket.id} wants to continue next partija in room ${roomId}`
    );

    const room = gameRooms.get(roomId);
    if (!room) {
      console.log(`❌ Room ${roomId} not found for partija continuation`);
      socket.emit("error", { message: "Soba ne postoji" });
      return;
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      console.log(`❌ Player ${socket.id} not found in room ${roomId}`);
      socket.emit("error", { message: "Niste u toj sobi" });
      return;
    }

    // Mark this player as ready for next partija
    if (!room.nextPartidaReady) {
      room.nextPartidaReady = new Set();
    }

    room.nextPartidaReady.add(player.playerNumber);

    console.log(
      `✅ Player ${
        player.playerNumber
      } marked as ready. Ready players: ${Array.from(
        room.nextPartidaReady
      ).join(", ")}`
    );

    // Check if both players are ready
    const totalPlayers = room.gameMode === "1v1" ? 2 : 4;
    if (room.nextPartidaReady.size >= totalPlayers) {
      console.log(
        `🎮 All players ready, starting new partija for room ${roomId}...`
      );

      // Clear ready status
      room.nextPartidaReady.clear();

      // Start new partija
      await startNewPartija(room);
    } else {
      // Notify waiting for other players
      const waitingFor = totalPlayers - room.nextPartidaReady.size;
      console.log(`⏳ Waiting for ${waitingFor} more players to be ready`);

      // Send different status to each player
      room.players.forEach((roomPlayer) => {
        const playerSocket = io.sockets.sockets.get(roomPlayer.id);
        if (playerSocket) {
          const isPlayerReady = room.nextPartidaReady.has(
            roomPlayer.playerNumber
          );

          playerSocket.emit("partidaContinueStatus", {
            readyPlayers: Array.from(room.nextPartidaReady),
            waitingFor: waitingFor,
            isPlayerReady: isPlayerReady,
          });

          console.log(
            `📤 Sent status to player ${roomPlayer.playerNumber}: ready=${isPlayerReady}`
          );
        }
      });
    }
  });

  // Handle rematch requests for 2v2 games
  socket.on("requestRematch", async (data) => {
    console.log(
      `🔄 Player ${socket.id} requested rematch in room ${data.gameId}`
    );

    const room = gameRooms.get(data.gameId);
    if (!room) {
      console.log(`⚠️ Room ${data.gameId} not found for rematch`);
      socket.emit("error", { message: "Soba nije pronađena" });
      return;
    }

    // Find player in room
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      console.log(`⚠️ Player ${socket.id} not found in room ${data.gameId}`);
      socket.emit("error", { message: "Niste u ovoj sobi" });
      return;
    }

    // Initialize rematchReady Set if not exists
    if (!room.rematchReady) {
      room.rematchReady = new Set();
    }

    // Add player to rematch ready list
    room.rematchReady.add(player.playerNumber);
    console.log(`✅ Player ${player.playerNumber} ready for rematch`);

    const totalPlayers = room.players.length;

    // Check if all players are ready for rematch
    if (room.rematchReady.size === totalPlayers) {
      console.log("🎯 All players ready for rematch, starting new game...");

      // Store team assignments from current game
      const teamAssignments = {};
      room.players.forEach((p) => {
        teamAssignments[p.playerNumber] =
          p.playerNumber <= 2 ? "team1" : "team2";
      });

      // Clear rematch ready status
      room.rematchReady.clear();

      // Reset game state while preserving teams
      room.gameState = {
        ...createInitialGameState2v2(),
        teams: {
          team1: { players: [1, 2], score: 0 },
          team2: { players: [3, 4], score: 0 },
        },
      };

      // Emit rematch accepted to all players
      room.players.forEach((roomPlayer) => {
        const playerSocket = io.sockets.sockets.get(roomPlayer.id);
        if (playerSocket) {
          playerSocket.emit("rematchAccepted", {
            gameState: room.gameState,
            myTeam: teamAssignments[roomPlayer.playerNumber],
          });
          console.log(
            `📤 Sent rematch accepted to player ${roomPlayer.playerNumber}`
          );
        }
      });

      // Start first round of new game
      await startNewRound2v2(room);
    } else {
      // Notify about rematch status
      const waitingFor = totalPlayers - room.rematchReady.size;
      console.log(`⏳ Waiting for ${waitingFor} more players for rematch`);

      room.players.forEach((roomPlayer) => {
        const playerSocket = io.sockets.sockets.get(roomPlayer.id);
        if (playerSocket) {
          const isPlayerReady = room.rematchReady.has(roomPlayer.playerNumber);

          playerSocket.emit("rematchStatus", {
            readyPlayers: Array.from(room.rematchReady),
            waitingFor: waitingFor,
            isPlayerReady: isPlayerReady,
          });

          console.log(
            `📤 Sent rematch status to player ${roomPlayer.playerNumber}: ready=${isPlayerReady}`
          );
        }
      });
    }
  });

  // Handle rematch decline (1v1 and 2v2) - accepts roomId or gameId
  socket.on("declineRematch", async (data = {}) => {
    const roomId = data.roomId || data.gameId; // support both payload shapes
    console.log(`❌ Player ${socket.id} declined rematch in room ${roomId}`);

    if (!roomId) {
      console.log(`⚠️ declineRematch missing roomId/gameId in payload`);
      return;
    }

    const room = gameRooms.get(roomId);
    if (!room) {
      console.log(`⚠️ Room ${roomId} not found for decline`);
      return;
    }

    // Find player in room
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      console.log(`⚠️ Player ${socket.id} not found in room ${roomId}`);
      return;
    }

    // Clear rematch ready status if present
    if (room.rematchReady) {
      room.rematchReady.clear();
    }

    // Notify all players that rematch was declined
    room.players.forEach((roomPlayer) => {
      const playerSocket = io.sockets.sockets.get(roomPlayer.id);
      if (playerSocket) {
        playerSocket.emit("rematchDeclined", {
          declinedBy: player.playerNumber,
        });
        console.log(
          `📤 Sent rematch declined to player ${roomPlayer.playerNumber}`
        );
      }
    });
  });

  // Tournament handlers
  socket.on("getTournaments", async (data) => {
    const requestedGameType = data?.gameType;
    try {
      const list = await tournamentManager.listTournaments(requestedGameType);
      let requesterUserId = null;
      const requester = connectedUsers.get(socket.id);
      if (requester) requesterUserId = requester.userId || requester.name;
      const publicList = [];
      for (const t of list) {
        let isRegistered = false;
        if (requesterUserId) {
          try {
            isRegistered = await tournamentManager.isPlayerRegistered(
              t.id,
              requesterUserId
            );
          } catch (e) {
            // silent
          }
        }
        publicList.push({
          id: t.id,
          name: t.name,
          gameType: t.gameType,
          maxParticipants: t.maxParticipants,
          currentParticipants:
            t.currentParticipants || t.participants?.length || 0,
          registrationDeadline: t.registrationDeadline,
          status: t.status,
          prizePool: t.prizePool,
          createdAt: t.createdAt || t.created_at,
          winner: t.winner,
          isRegistered,
        });
      }
      socket.emit("tournamentsUpdate", publicList);
    } catch (e) {
      socket.emit("tournamentError", { message: e.message });
    }
  });

  socket.on("createTournament", async (data) => {
    try {
      // basic admin check (simple token or flag can be added later)
      if (!connectedUsers.get(socket.id)) throw new Error("Auth required");
      const t = await tournamentManager.createTournament(
        data,
        connectedUsers.get(socket.id).userId ||
          connectedUsers.get(socket.id).name
      );
      socket.emit("tournamentCreated", { id: t.id });
    } catch (e) {
      socket.emit("tournamentError", { message: e.message });
    }
  });

  socket.on("registerForTournament", async (data) => {
    try {
      const user = connectedUsers.get(socket.id);
      if (!user) throw new Error("User not found");
      // Ensure user has a stable userId (fallback to name)
      const regUser = {
        ...user,
        userId: user.userId || user.name,
      };
      await tournamentManager.registerPlayer(data.tournamentId, regUser);
      socket.emit("tournamentRegistered", {
        tournamentId: data.tournamentId,
        message: "Prijava uspješna",
        isRegistered: true,
      });
    } catch (e) {
      socket.emit("tournamentError", { message: e.message });
    }
  });

  socket.on("getTournamentBracket", async (data) => {
    try {
      const t = await tournamentManager.getTournament(data.tournamentId);
      if (!t) throw new Error("Tournament not found");
      const bracket = await tournamentManager.getBracket(data.tournamentId);
      // Ensure participant count (DB tournaments don't store it directly)
      let participantCount =
        t.currentParticipants || t.participants?.length || 0;
      if (participantCount === 0) {
        try {
          const players = await tournamentManager.listPlayers(
            data.tournamentId
          );
          participantCount = players.length;
        } catch (_) {}
      }
      socket.emit("tournamentBracketData", {
        tournamentId: data.tournamentId,
        tournament: {
          id: t.id,
          name: t.name,
          gameType: t.gameType,
          status: t.status,
          currentParticipants: participantCount,
          maxParticipants: t.maxParticipants,
          prizePool: t.prizePool,
          startedAt: t.startedAt,
          winner: t.winner,
        },
        bracket,
      });
    } catch (e) {
      socket.emit("tournamentError", { message: e.message });
    }
  });

  socket.on("reportMatchResult", async (data) => {
    try {
      const user = connectedUsers.get(socket.id);
      if (!user) throw new Error("Auth required");
      await tournamentManager.reportMatchResult(
        data.tournamentId,
        data.matchId,
        data.winnerId
      );
    } catch (e) {
      socket.emit("tournamentError", { message: e.message });
    }
  });

  // Handle forfeit match for tournaments
  socket.on("forfeitMatch", async (data) => {
    const { roomId, reason } = data;
    const user = connectedUsers.get(socket.id);

    if (!user) {
      console.log("❌ Forfeit failed - user not authenticated");
      return;
    }

    console.log(
      `🏳️ Player ${user.name} forfeiting match in room ${roomId}, reason: ${reason}`
    );

    const room = gameRooms.get(roomId);
    if (!room) {
      console.log(`❌ Forfeit failed - room ${roomId} not found`);
      return;
    }

    // Find the forfeiting player
    const forfeitingPlayer = room.players.find((p) => p.id === socket.id);
    if (!forfeitingPlayer) {
      console.log(`❌ Forfeit failed - player not found in room ${roomId}`);
      return;
    }

    // Determine the winner (the other player)
    const winnerPlayer = room.players.find((p) => p.id !== socket.id);
    if (!winnerPlayer) {
      console.log(`❌ Forfeit failed - winner not found in room ${roomId}`);
      return;
    }

    console.log(
      `🏆 ${winnerPlayer.name} wins by forfeit from ${forfeitingPlayer.name}`
    );

    // Set the game to finished with winner getting full points
    const isBreakula = room.gameState?.gameType === "briskula";
    const isTreseta = room.gameState?.gameType === "treseta";
    const winnerPoints = isTreseta ? 31 : isBreakula ? 61 : 31; // Default to 31 for Treseta

    // Update game state to show forfeit win
    room.gameState = {
      ...room.gameState,
      gamePhase: "finished",
      winner: winnerPlayer.playerNumber,
      // For Treseta - set total points
      ...(isTreseta && {
        totalPlayer1Points: winnerPlayer.playerNumber === 1 ? winnerPoints : 0,
        totalPlayer2Points: winnerPlayer.playerNumber === 2 ? winnerPoints : 0,
        // Set current partija points too
        player1Points: winnerPlayer.playerNumber === 1 ? winnerPoints : 0,
        player2Points: winnerPlayer.playerNumber === 2 ? winnerPoints : 0,
        currentPartija: 1, // Set to partija 1 since it ended early
        partijas: [
          {
            partija: 1,
            player1Points: winnerPlayer.playerNumber === 1 ? winnerPoints : 0,
            player2Points: winnerPlayer.playerNumber === 2 ? winnerPoints : 0,
          },
        ],
      }),
      // For Briskula - set card points
      ...(isBreakula && {
        [`player${winnerPlayer.playerNumber}Points`]: winnerPoints,
        [`player${forfeitingPlayer.playerNumber}Points`]: 0,
      }),
      message: `${forfeitingPlayer.name} je predao meč. ${winnerPlayer.name} pobjeđuje!`,
    };

    console.log(
      `🎯 Game finished - ${winnerPlayer.name} gets ${winnerPoints} points by forfeit`
    );

    // For tournament matches, report the result immediately
    if (
      room.gameState?.isTournamentMatch &&
      room.gameState?.tournamentId &&
      room.gameState?.matchId
    ) {
      try {
        // Report the match result to tournament manager - use name for display
        await tournamentManager.reportMatchResult(
          room.gameState.tournamentId,
          room.gameState.matchId,
          winnerPlayer.name || winnerPlayer.userId
        );
        console.log(
          `📊 Tournament result reported: ${winnerPlayer.name} wins match ${room.gameState.matchId}`
        );
      } catch (error) {
        console.error("❌ Failed to report tournament forfeit result:", error);
      }
    }

    // Emit forfeit event to all players in the room with updated game state
    room.players.forEach((player) => {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) {
        playerSocket.emit("playerForfeited", {
          playerName: forfeitingPlayer.name,
          winnerPlayerNumber: winnerPlayer.playerNumber,
          reason: reason,
          roomId: roomId,
          gameState: room.gameState, // Include updated game state
        });
      }
    });

    // Clean up the room
    gameRooms.delete(roomId);

    // Remove player sessions for this room
    for (const [playerId, session] of playerSessions.entries()) {
      if (session.roomId === roomId) {
        removePlayerSession(playerId);
      }
    }

    console.log(`🧹 Room ${roomId} cleaned up after forfeit`);
  });

  socket.on("getTournamentLeaderboard", async () => {
    const lb = await tournamentManager.getLeaderboard();
    socket.emit("tournamentLeaderboard", lb);
  });

  // Manual start (admin)
  socket.on("startTournament", async (data) => {
    try {
      const user = connectedUsers.get(socket.id);
      if (!user) throw new Error("Auth required");
      await tournamentManager.startTournament(data.tournamentId);
    } catch (e) {
      socket.emit("tournamentError", { message: e.message });
    }
  });

  // Player clicks ready for a tournament match
  socket.on("tournamentReady", async (data) => {
    const { tournamentId, matchId } = data;
    const user = connectedUsers.get(socket.id);

    if (!user) {
      socket.emit("tournamentError", { message: "User not authenticated" });
      return;
    }

    console.log(`🎮 ${user.name} ready for tournament match: ${matchId}`);
    const tournament = await tournamentManager.getTournament(tournamentId);
    if (!tournament) {
      socket.emit("tournamentError", { message: "Tournament not found" });
      return;
    }
    const bracket = await tournamentManager.getBracket(tournamentId);
    if (!bracket || !bracket.length) {
      socket.emit("tournamentError", {
        message: "Tournament bracket not ready",
      });
      return;
    }

    // Find the match
    let targetMatch = null;

    for (const round of bracket) {
      const match = round.matches.find((m) => m.id === matchId);
      if (match) {
        targetMatch = match;
        break;
      }
    }

    if (!targetMatch) {
      socket.emit("tournamentError", { message: "Match not found" });
      return;
    }

    // Check if user is participant in this match - check both userId and name
    const userKey = user.userId || user.name;
    const isParticipant =
      targetMatch.player1 === user.userId ||
      targetMatch.player1 === user.name ||
      targetMatch.player2 === user.userId ||
      targetMatch.player2 === user.name;

    if (!isParticipant) {
      socket.emit("tournamentError", {
        message: "You are not a participant in this match",
      });
      return;
    }

    if (targetMatch.status !== "pending") {
      socket.emit("tournamentError", {
        message: "Match is not ready to start",
      });
      return;
    }
    // Mark current user as ready; wait for both to confirm
    try {
      const userKey = user.userId || user.name;
      if (!tournamentReady.has(matchId))
        tournamentReady.set(matchId, new Set());
      const readySet = tournamentReady.get(matchId);
      readySet.add(userKey);

      // Inform only this player of their ready status
      io.to(socket.id).emit("tournamentMatchReadyStatus", {
        matchId,
        readyCount: readySet.size,
        required: 2,
        youAreReady: true,
      });

      console.log(
        `🎮 ${user.name} ready for tournament match: ${matchId} (${readySet.size}/2)`
      );

      // If both ready, start the match
      // Check if both players are ready by looking for any user that matches each player slot
      const player1Ready = Array.from(readySet).some((readyUserKey) => {
        const readyUser = Array.from(connectedUsers.values()).find(
          (u) => (u.userId || u.name) === readyUserKey
        );
        return (
          readyUser &&
          (readyUser.userId === targetMatch.player1 ||
            readyUser.name === targetMatch.player1)
        );
      });

      const player2Ready = Array.from(readySet).some((readyUserKey) => {
        const readyUser = Array.from(connectedUsers.values()).find(
          (u) => (u.userId || u.name) === readyUserKey
        );
        return (
          readyUser &&
          (readyUser.userId === targetMatch.player2 ||
            readyUser.name === targetMatch.player2)
        );
      });

      if (player1Ready && player2Ready) {
        tournamentReady.delete(matchId);

        const roomId = uuidv4();

        // Resolve player connections with flexible matching
        const player1User = Array.from(connectedUsers.values()).find(
          (u) =>
            u.userId === targetMatch.player1 || u.name === targetMatch.player1
        );
        const player2User = Array.from(connectedUsers.values()).find(
          (u) =>
            u.userId === targetMatch.player2 || u.name === targetMatch.player2
        );

        if (!player1User || !player2User) {
          io.to(socket.id).emit("tournamentError", {
            message: "Jedan od igrača je offline",
          });
          return;
        }

        // Build room
        const room = {
          id: roomId,
          type: "tournament",
          tournamentId,
          matchId,
          gameType: tournament.gameType,
          gameMode: "1v1",
          players: [
            {
              id: player1User.id,
              name: player1User.name,
              userId: player1User.userId,
              isGuest: player1User.isGuest,
              playerNumber: 1,
              isConnected: true,
              playerId: `${roomId}_p1`, // Add playerId for reconnect
            },
            {
              id: player2User.id,
              name: player2User.name,
              userId: player2User.userId,
              isGuest: player2User.isGuest,
              playerNumber: 2,
              isConnected: true,
              playerId: `${roomId}_p2`, // Add playerId for reconnect
              isConnected: true,
            },
          ],
          spectators: [], // Array of socket IDs for spectators
          createdAt: new Date(),
          status: "playing",
        };

        console.log(
          `🎮 Tournament room players:`,
          room.players.map((p) => ({
            name: p.name,
            playerNumber: p.playerNumber,
          }))
        );

        // Initialize game state
        let gameLogic;
        if (tournament.gameType === "treseta") {
          gameLogic = await import("../core/gameLogicTreseta.js");
        } else {
          gameLogic = await import("../core/gameLogicBriskula.js");
        }
        const { createDeck, shuffleDeck, dealCards } = gameLogic;
        const deck = shuffleDeck(createDeck());
        const dealt = dealCards(deck);

        // Ensure every card has an id (suit-value uniqueness) to avoid React key issues
        const ensureIds = (arr) =>
          (arr || []).map((c, idx) => ({
            ...c,
            id:
              c.id ||
              `${c.suit || c.Suit || "S"}-${c.value || c.rank || "R"}-${idx}`,
          }));
        dealt.player1Hand = ensureIds(dealt.player1Hand);
        dealt.player2Hand = ensureIds(dealt.player2Hand);
        if (dealt.trump && !dealt.trump.id) {
          dealt.trump.id = `TRUMP-${dealt.trump.suit}-${dealt.trump.value}`;
        }

        // Standardize state fields like non-tournament games
        const gameState = {
          player1Hand: dealt.player1Hand,
          player2Hand: dealt.player2Hand,
          player1Cards: [],
          player2Cards: [],
          remainingDeck: dealt.remainingDeck || dealt.remaining || [],
          currentPlayer: 1,
          playedCards: [],
          gamePhase: "playing",
          winner: null,
          gameType: tournament.gameType,
          version: Date.now(),
          lastMove: new Date(),
          isTournamentMatch: true,
          tournamentId,
          matchId,
          ...(tournament.gameType === "briskula" && {
            trump: dealt.trump || dealt.trumpCard,
            trumpSuit: (dealt.trump || dealt.trumpCard)?.suit,
            lastTrickWinner: null,
          }),
          ...(tournament.gameType === "treseta" && {
            player1Akuze: { points: 0, details: [] },
            player2Akuze: { points: 0, details: [] },
            ultimaWinner: null,
            totalPlayer1Points: 0,
            totalPlayer2Points: 0,
            partijas: [],
            currentPartija: 1,
            targetScore: 31,
            hasPlayedFirstCard: false,
          }),
        };

        room.gameState = gameState;
        gameRooms.set(roomId, room);

        // Create player sessions for reconnection
        createPlayerSession(`${roomId}_p1`, roomId, 1, player1User.id);
        createPlayerSession(`${roomId}_p2`, roomId, 2, player2User.id);

        // Join sockets
        const p1Sock = io.sockets.sockets.get(player1User.id);
        const p2Sock = io.sockets.sockets.get(player2User.id);
        p1Sock?.join(roomId);
        p2Sock?.join(roomId);

        // Persist match as playing
        try {
          await tournamentManager.startMatch(tournamentId, matchId, roomId);
        } catch (e) {
          console.error("Failed to set match playing:", e.message);
        }

        // Enrich ELO
        try {
          const playerList = await tournamentManager.listPlayers(tournamentId);
          const eloMap = new Map(playerList.map((p) => [p.userId, p.elo]));
          room.players = room.players.map((p) => ({
            ...p,
            elo: eloMap.get(p.userId) || 1000,
          }));
        } catch (e) {}

        // Send personalized start like normal lobby games
        const getPlayableCards =
          tournament.gameType === "treseta"
            ? (await import("../core/gameLogicTreseta.js")).getPlayableCards
            : null;

        // --- FIX: Svaki igrač dobiva SVOJE karte, protivničke skrivene ---
        const p1Hand = room.gameState.player1Hand;
        const p2Hand = room.gameState.player2Hand;
        const p1Payload = {
          roomId,
          playerId: `${roomId}_p1`, // Add playerId for localStorage
          playerNumber: 1,
          opponent: { name: room.players[1].name },
          gameType: tournament.gameType,
          gameMode: "1v1",
          isTournamentMatch: true,
          tournamentId,
          matchId,
          gameState: {
            ...room.gameState,
            player1Hand: p1Hand, // IGRAČ 1 vidi SVOJE karte
            player2Hand: p2Hand.map(() => ({ hidden: true })), // Protivničke skrivene
            playableCards:
              tournament.gameType === "treseta"
                ? getPlayableCards(p1Hand, [])
                : p1Hand.map((c) => c.id),
          },
          players: room.players,
        };

        const p2Payload = {
          roomId,
          playerId: `${roomId}_p2`, // Add playerId for localStorage
          playerNumber: 2,
          opponent: { name: room.players[0].name },
          gameType: tournament.gameType,
          gameMode: "1v1",
          isTournamentMatch: true,
          tournamentId,
          matchId,
          gameState: {
            ...room.gameState,
            player1Hand: p1Hand.map(() => ({ hidden: true })), // Protivničke skrivene
            player2Hand: p2Hand, // IGRAČ 2 vidi SVOJE karte
            playableCards:
              tournament.gameType === "treseta"
                ? getPlayableCards(p2Hand, [])
                : p2Hand.map((c) => c.id),
          },
          players: room.players,
        };

        // Debug logovi za karte
        console.log("🃏 [Tournament] Player 1 hand:", p1Hand);
        console.log("🃏 [Tournament] Player 2 hand:", p2Hand);
        console.log("🃏 [Tournament] p1Payload sent:", {
          playerNumber: p1Payload.playerNumber,
          myHand: p1Payload.gameState.player1Hand,
          opponentHand: p1Payload.gameState.player2Hand,
        });
        console.log("🃏 [Tournament] p2Payload sent:", {
          playerNumber: p2Payload.playerNumber,
          myHand: p2Payload.gameState.player2Hand,
          opponentHand: p2Payload.gameState.player1Hand,
        });

        // Emit standard gameStart event so client uses same init path
        console.log(`📤 Sending gameStart to player 1 (${player1User.name}):`, {
          playerNumber: p1Payload.playerNumber,
          opponent: p1Payload.opponent,
          gameType: p1Payload.gameType,
          roomPlayers: room.players.map((p) => ({
            name: p.name,
            playerNumber: p.playerNumber,
          })),
        });
        p1Sock?.emit("gameStart", p1Payload);

        console.log(`📤 Sending gameStart to player 2 (${player2User.name}):`, {
          playerNumber: p2Payload.playerNumber,
          opponent: p2Payload.opponent,
          gameType: p2Payload.gameType,
          roomPlayers: room.players.map((p) => ({
            name: p.name,
            playerNumber: p.playerNumber,
          })),
        });
        p2Sock?.emit("gameStart", p2Payload);

        await gameStateManager.saveGameState(roomId, room);

        const latestBracket = await tournamentManager.getBracket(tournamentId);
        io.emit("bracketUpdated", { tournamentId, bracket: latestBracket });
      } else {
        // Broadcast interim readiness update to both players (if opponent not connected skip)
        const p1 = Array.from(connectedUsers.values()).find(
          (u) => (u.userId || u.name) === targetMatch.player1
        );
        const p2 = Array.from(connectedUsers.values()).find(
          (u) => (u.userId || u.name) === targetMatch.player2
        );
        [p1, p2].forEach((pl) => {
          if (!pl) return;
          const s = io.sockets.sockets.get(pl.id);
          s?.emit("tournamentMatchReadyStatus", {
            matchId,
            readyCount: readySet.size,
            required: 2,
            youAreReady: (pl.userId || pl.name) === userKey,
          });
        });
      }
    } catch (error) {
      console.error("Error starting tournament match:", error);
      socket.emit("tournamentError", {
        message: "Failed to start match: " + error.message,
      });
    }
  });

  // Spectate tournament match - UPDATED: pravi spectator mode
  socket.on("spectateTournamentMatch", async ({ tournamentId, matchId }) => {
    try {
      if (!tournamentId || !matchId) {
        socket.emit("tournamentError", { message: "Nedostaju parametri" });
        return;
      }
      const bracket = await tournamentManager.getBracket(tournamentId);
      let targetMatch;
      for (const round of bracket) {
        const found = round.matches.find((m) => m.id === matchId);
        if (found) {
          targetMatch = found;
          break;
        }
      }
      if (!targetMatch) {
        socket.emit("tournamentError", { message: "Meč nije pronađen" });
        return;
      }
      if (targetMatch.status !== "playing" && !targetMatch.gameRoomId) {
        socket.emit("tournamentError", { message: "Meč još nije započeo" });
        return;
      }
      const room = gameRooms.get(targetMatch.gameRoomId);
      if (!room) {
        socket.emit("tournamentError", { message: "Soba meča nije aktivna" });
        return;
      }

      // --- NOVO: Dodaj socket u spectators, ne u players ---
      socket.join(targetMatch.gameRoomId);

      // Inicijaliziraj spectators array ako ne postoji
      if (!room.spectators) room.spectators = [];

      // Dodaj spectator-a u listu
      if (!room.spectators.includes(socket.id)) {
        room.spectators.push(socket.id);
      }

      // Mark user as spectating in connectedUsers (important for proper handling)
      const user = connectedUsers.get(socket.id);
      if (user) {
        user.room = targetMatch.gameRoomId;
        user.status = "spectating"; // Different from "in-game"
      }

      console.log(
        `👁️ Spectator ${socket.id} joined room ${targetMatch.gameRoomId} (${room.spectators.length} spectators)`
      );

      // Koristi getPublicGameState helper za spectatore
      const publicState = getPublicGameState(room.gameState);

      // Emit gameStart for spectators with proper spectator flags
      socket.emit("gameStart", {
        roomId: targetMatch.gameRoomId,
        tournamentId,
        matchId,
        gameType: room.gameType || publicState.gameType,
        gameMode: room.gameMode || "1v1",
        players: room.players.map((p) => ({
          name: p.name,
          userId: p.userId,
          playerNumber: p.playerNumber, // Make sure playerNumber is included
        })),
        gameState: publicState, // Only public state for spectators
        spectator: true, // Mark as spectator
        playerNumber: null, // No player number for spectators
        opponent: null, // No specific opponent for spectators
        isTournamentMatch: true,
      });
      broadcastSpectatorUpdate(room);
    } catch (err) {
      console.error("spectateTournamentMatch error:", err);
      socket.emit("tournamentError", { message: "Greška pri spectate" });
    }
  });

  // --- NOVO: Generički joinAsSpectator handler za bilo koju sobu ---
  socket.on("joinAsSpectator", async ({ roomId }) => {
    try {
      const room = gameRooms.get(roomId);
      if (!room) {
        socket.emit("spectatorError", { message: "Soba ne postoji" });
        return;
      }

      // Dodaj socket u sobu za broadcast
      socket.join(roomId);

      // Inicijaliziraj spectators array ako ne postoji
      if (!room.spectators) room.spectators = [];

      // Dodaj u spectators listu
      if (!room.spectators.includes(socket.id)) {
        room.spectators.push(socket.id);
      }

      console.log(
        `👁️ Spectator ${socket.id} joined room ${roomId} (${room.spectators.length} spectators)`
      );

      // Send spectator gameStart event instead of spectatorJoined
      socket.emit("gameStart", {
        roomId,
        gameType: room.gameType,
        gameMode: room.gameMode,
        players: room.players,
        gameState: getPublicGameState(room.gameState), // Only public state
        spectator: true, // Mark as spectator
        playerNumber: null, // No player number for spectators
        opponent: null, // No specific opponent for spectators
        isTournamentMatch: room.type === "tournament",
        tournamentId: room.tournamentId,
        matchId: room.matchId,
      });
      broadcastSpectatorUpdate(room);
    } catch (err) {
      console.error("joinAsSpectator error:", err);
      socket.emit("spectatorError", { message: "Greška pri spectate" });
    }
  });

  // (Legacy reconnect handler removed - unified into enhanced handler above)

  // Listen for tournament game completion
  socket.on("tournamentGameFinished", async (data) => {
    await handleTournamentGameFinished(data);
  });

  // Join as spectator handler
  socket.on("joinAsSpectator", ({ roomId }) => {
    try {
      console.log(`👁️ ${user?.name} wants to spectate room ${roomId}`);

      if (!roomId) {
        socket.emit("spectatorError", { message: "Room ID required" });
        return;
      }

      const room = gameRooms.get(roomId);
      if (!room) {
        socket.emit("spectatorError", { message: "Room not found" });
        return;
      }

      // Add spectator to room
      if (!room.spectators) room.spectators = [];
      if (!room.spectators.includes(socket.id)) {
        room.spectators.push(socket.id);
      }

      socket.join(roomId);

      // Send spectator start event
      const spectatorPayload = {
        roomId,
        roomPlayers: room.players.map((p) => ({
          name: p.name,
          playerNumber: p.playerNumber,
          isConnected: p.isConnected,
          team: p.team, // for 2v2 mode
        })),
        gameType: room.gameType,
        gameMode: room.gameMode,
        publicState: {
          playedCards: room.gameState.playedCards || [],
          trump: room.gameState.trump,
          remainingCardsCount: (room.gameState.remainingDeck || []).length,
          currentPlayer: room.gameState.currentPlayer,
          gamePhase: room.gameState.gamePhase,
          winner: room.gameState.winner,
          // Add points based on game mode
          ...(room.gameMode === "2v2"
            ? {
                team1Points: room.gameState.team1Points || 0,
                team2Points: room.gameState.team2Points || 0,
              }
            : {
                player1Points: room.gameState.player1Points || 0,
                player2Points: room.gameState.player2Points || 0,
              }),
          // Add treseta specific data
          ...(room.gameType === "treseta" && {
            totalPlayer1Points: room.gameState.totalPlayer1Points || 0,
            totalPlayer2Points: room.gameState.totalPlayer2Points || 0,
            partijas: room.gameState.partijas || [],
            currentPartija: room.gameState.currentPartija || 1,
            targetScore: room.gameState.targetScore || 31,
          }),
        },
        isTournamentMatch: room.type === "tournament",
        tournamentId: room.tournamentId,
        matchId: room.matchId,
      };

      socket.emit("spectatorStart", spectatorPayload);

      console.log(`✅ ${user?.name} joined as spectator in room ${roomId}`);
    } catch (error) {
      console.error("Error in joinAsSpectator:", error);
      socket.emit("spectatorError", { message: "Failed to join as spectator" });
    }
  });

  // Handle disconnect
  socket.on("disconnect", async (reason) => {
    console.log(`❌ Korisnik ${socket.id} se odspojio: ${reason}`);

    // Remove from spectator lists first
    gameRooms.forEach((room, roomId) => {
      if (room.spectators && room.spectators.includes(socket.id)) {
        room.spectators = room.spectators.filter((id) => id !== socket.id);
        console.log(`👁️ Removed spectator ${socket.id} from room ${roomId}`);
      }
    });

    const user = connectedUsers.get(socket.id);

    // Ukloni iz waiting queue-a
    const queueIndex1v1 = waitingQueue1v1.findIndex((u) => u.id === socket.id);
    const queueIndex2v2 = waitingQueue2v2.findIndex((u) => u.id === socket.id);

    if (queueIndex1v1 !== -1) {
      waitingQueue1v1.splice(queueIndex1v1, 1);
    }
    if (queueIndex2v2 !== -1) {
      waitingQueue2v2.splice(queueIndex2v2, 1);
    }

    // Handle game disconnection with session preservation
    if (user) {
      // Mark session as disconnected but don't invalidate it
      if (user.sessionToken) {
        const session = sessionManager.activeSessions.get(user.sessionToken);
        if (session) {
          session.isActive = false;
          session.disconnectedAt = new Date();
          console.log(`💤 Session marked as disconnected: ${user.name}`);
        }
      }

      // Handle game room disconnection
      await handlePlayerDisconnectWithReconnect(socket.id);
    }

    // Ukloni iz connected users
    connectedUsers.delete(socket.id);
  });
});

// Function to handle tournament game completion (both manual and automatic) via TournamentManager
const handleTournamentGameFinished = async (data) => {
  const { roomId, tournamentId, matchId, winnerId } = data;
  const room = gameRooms.get(roomId);
  if (!room) return;

  const finalTournamentId = tournamentId || room.gameState?.tournamentId;
  const finalMatchId = matchId || room.gameState?.matchId;
  const winnerPlayer = room.players.find((p) => p.playerNumber === winnerId);
  const winnerUserId = winnerPlayer?.userId || winnerPlayer?.name;

  // Check if this is a complete match finish (not just a partija)
  const isFinalGameOver =
    room.gameState?.gamePhase === "finished" && room.gameState?.winner !== null;

  // For Treseta, check if match is complete (target score reached)
  const isTresetaMatchComplete =
    room.gameType === "treseta" &&
    ((room.gameState?.totalPlayer1Points || 0) >=
      (room.gameState?.targetScore || 31) ||
      (room.gameState?.totalPlayer2Points || 0) >=
        (room.gameState?.targetScore || 31));

  try {
    await tournamentManager.reportMatchResult(
      finalTournamentId,
      finalMatchId,
      winnerUserId
    );
    const updatedBracket = await tournamentManager.getBracket(
      finalTournamentId
    );
    const t = await tournamentManager.getTournament(finalTournamentId);
    io.emit("bracketUpdated", {
      tournamentId: finalTournamentId,
      bracket: updatedBracket,
    });
    if (t.status === "finished") {
      io.emit("tournamentFinished", {
        tournamentId: finalTournamentId,
        winner: t.winner,
      });
    }
  } catch (e) {
    console.error("Finish tournament match error:", e.message);
  } finally {
    // Only delete room if this is truly the end of the match, not just a partija
    if (isFinalGameOver || isTresetaMatchComplete) {
      console.log(`🗑️ Tournament match completed, deleting room ${roomId}`);
      gameRooms.delete(roomId);
    } else {
      console.log(
        `🎮 Tournament match partija completed, keeping room ${roomId} for next partija`
      );
    }
  }
};

/**
 * Kreira novu sobu za 1v1 igru
 */
async function createGameRoom1v1(player1, player2, gameType = "briskula") {
  const roomId = uuidv4();

  // Importiraj odgovarajuću game logiku
  let gameLogic;
  if (gameType === "treseta") {
    gameLogic = await import("../core/gameLogicTreseta.js");
  } else {
    gameLogic = await import("../core/gameLogicBriskula.js");
  }

  const { createDeck, shuffleDeck, dealCards } = gameLogic;

  const deck = createDeck();
  const shuffledDeck = shuffleDeck(deck);
  const dealt = dealCards(shuffledDeck, false);

  const gameRoom = {
    id: roomId,
    gameMode: "1v1",
    gameType: gameType, // DODANO
    // Enable akuze by default for Treseta games
    ...(gameType === "treseta" && { akuzeEnabled: true }),
    players: [
      {
        ...player1,
        playerNumber: 1,
        isConnected: true,
        playerId: `${roomId}_p1`,
      },
      {
        ...player2,
        playerNumber: 2,
        isConnected: true,
        playerId: `${roomId}_p2`,
      },
    ],
    spectators: [], // Array of socket IDs for spectators
    gameState: {
      player1Hand: dealt.player1Hand,
      player2Hand: dealt.player2Hand,
      player1Cards: [],
      player2Cards: [],
      remainingDeck: dealt.remainingDeck,
      currentPlayer: 1,
      playedCards: [],
      gamePhase: "playing",
      winner: null,
      gameType: gameType, // DODANO
      version: Date.now(), // Add version for sync
      lastMove: new Date(),
      // Specifične za Briskula
      ...(gameType === "briskula" && {
        trump: dealt.trump,
        trumpSuit: dealt.trump.suit,
        lastTrickWinner: null, // Dodano za tie-breaker 60-60
      }),
      // Specifične za Trešeta
      ...(gameType === "treseta" && {
        player1Akuze: { points: 0, details: [] },
        player2Akuze: { points: 0, details: [] },
        ultimaWinner: null, // Tko će dobiti zadnji punat

        // Long-term scoring for 1v1 Treseta
        totalPlayer1Points: 0,
        totalPlayer2Points: 0,
        partijas: [], // History of completed partijas
        currentPartija: 1,
        targetScore: 31, // Target score for match victory
        hasPlayedFirstCard: false,
      }),
    },
    createdAt: new Date(),
  };

  gameRooms.set(roomId, gameRoom);

  // Create player sessions for reconnection
  createPlayerSession(`${roomId}_p1`, roomId, 1, player1.id);
  createPlayerSession(`${roomId}_p2`, roomId, 2, player2.id);

  // Assign players to sessions if they have session tokens
  if (player1.sessionToken) {
    sessionManager.assignToGameRoom(player1.sessionToken, roomId, 1);
  }
  if (player2.sessionToken) {
    sessionManager.assignToGameRoom(player2.sessionToken, roomId, 2);
  }

  // Save game state
  await gameStateManager.saveGameState(roomId, gameRoom);

  // Pošalji igračima da je igra počela
  const player1Socket = io.sockets.sockets.get(player1.id);
  const player2Socket = io.sockets.sockets.get(player2.id);

  if (player1Socket && player2Socket) {
    // Pridruži oba igrača u Socket.io room
    player1Socket.join(roomId);
    player2Socket.join(roomId);

    // Pošalji početno stanje svakom igraču (personalizirano)
    const { getPlayableCards } = gameLogic;

    const player1PlayableCards =
      gameType === "treseta"
        ? getPlayableCards(
            gameRoom.gameState.player1Hand,
            gameRoom.gameState.playedCards
          )
        : gameRoom.gameState.player1Hand.map((card) => card.id); // Briskula - sve karte igrive

    const player2PlayableCards =
      gameType === "treseta"
        ? getPlayableCards(
            gameRoom.gameState.player2Hand,
            gameRoom.gameState.playedCards
          )
        : gameRoom.gameState.player2Hand.map((card) => card.id); // Briskula - sve karte igrive

    player1Socket.emit("gameStart", {
      roomId: roomId,
      playerId: `${roomId}_p1`, // Add playerId for localStorage
      playerNumber: 1,
      opponent: { name: player2.name },
      gameType: gameType,
      gameMode: "1v1",
      ...(gameType === "treseta" &&
        gameRoom.akuzeEnabled !== undefined && {
          akuzeEnabled: gameRoom.akuzeEnabled,
        }),
      gameState: {
        ...gameRoom.gameState,
        player2Hand: gameRoom.gameState.player2Hand.map(() => ({
          hidden: true,
        })), // Sakrij karte protivnika
        playableCards: player1PlayableCards,
      },
    });

    player2Socket.emit("gameStart", {
      roomId: roomId,
      playerId: `${roomId}_p2`, // Add playerId for localStorage
      playerNumber: 2,
      opponent: { name: player1.name },
      gameType: gameType,
      gameMode: "1v1",
      ...(gameType === "treseta" &&
        gameRoom.akuzeEnabled !== undefined && {
          akuzeEnabled: gameRoom.akuzeEnabled,
        }),
      gameState: {
        ...gameRoom.gameState,
        player1Hand: gameRoom.gameState.player1Hand.map(() => ({
          hidden: true,
        })), // Sakrij karte protivnika
        playableCards: player2PlayableCards,
      },
    });

    console.log(
      `Nova 1v1 igra stvorena: ${player1.name} vs ${player2.name} (Room: ${roomId})`
    );
  }
}

/**
 * Kreira novu sobu za 2v2 igru - ISPRAVLJENA LOGIKA
 */
async function createGameRoom2v2(players, gameType = "briskula") {
  const roomId = uuidv4();

  // Importiraj game logiku ovisno o gameType
  let gameState;
  if (gameType === "treseta") {
    const treseta2v2 = await import("../core/gameLogicTreseta2v2.js");
    gameState = treseta2v2.createGameState2v2();
  } else {
    const logic2v2 = await import("../core/gameLogicBriskula2v2.js");
    gameState = logic2v2.createGameState2v2();
  }

  // ISPRAVKA: Assign teams correctly: 1&3 = team 1, 2&4 = team 2
  const gameRoom = {
    id: roomId,
    gameMode: "2v2",
    gameType: gameType, // DODANO
    players: players.map((player, index) => {
      const playerNumber = index + 1;
      const team = playerNumber === 1 || playerNumber === 3 ? 1 : 2; // 1&3=tim1, 2&4=tim2

      console.log(
        `🎮 Player ${playerNumber} (${player.name}) assigned to team ${team}`
      );

      return {
        ...player,
        playerNumber,
        team,
        playerId: `${roomId}_p${playerNumber}`, // Add unique playerId
      };
    }),
    spectators: [], // Array of socket IDs for spectators
    gameState,
    createdAt: new Date(),
  };

  gameRooms.set(roomId, gameRoom);

  // Create player sessions for reconnection
  players.forEach((player, index) => {
    const playerNumber = index + 1;
    createPlayerSession(
      `${roomId}_p${playerNumber}`,
      roomId,
      playerNumber,
      player.id
    );
  });

  // Join all players to the room and send game start data
  players.forEach((player, index) => {
    const playerSocket = io.sockets.sockets.get(player.id);
    if (playerSocket) {
      playerSocket.join(roomId);

      const playerNumber = index + 1;
      const team = playerNumber === 1 || playerNumber === 3 ? 1 : 2;

      playerSocket.emit("gameStart", {
        roomId: roomId,
        playerId: `${roomId}_p${playerNumber}`, // Add playerId for localStorage
        playerNumber: playerNumber,
        myTeam: team,
        gameType: gameType, // DODANO
        gameMode: "2v2",
        players: gameRoom.players.map((p) => ({
          name: p.name,
          playerNumber: p.playerNumber,
          team: p.team,
        })),
        gameState: {
          ...gameState,
          // Send actual hand lengths but hide the cards themselves
          player1Hand:
            playerNumber === 1
              ? gameState.player1Hand
              : new Array(gameState.player1Hand.length).fill({}),
          player2Hand:
            playerNumber === 2
              ? gameState.player2Hand
              : new Array(gameState.player2Hand.length).fill({}),
          player3Hand:
            playerNumber === 3
              ? gameState.player3Hand
              : new Array(gameState.player3Hand.length).fill({}),
          player4Hand:
            playerNumber === 4
              ? gameState.player4Hand
              : new Array(gameState.player4Hand.length).fill({}),
          // Dodaj playableCards za Trešetu 2v2
          playableCards:
            gameType === "treseta"
              ? gameState[`player${playerNumber}PlayableCards`] || []
              : [],
        },
      });
    }
  });

  // Notify all players that the game is starting
  io.to(roomId).emit("matchmaking", {
    status: "players_found",
    message: "Svi igrači pronađeni! Igra počinje...",
    players: gameRoom.players.map((p) => ({
      name: p.name,
      team: p.team,
    })),
  });

  console.log(
    `Nova 2v2 igra stvorena: ${players
      .map((p) => p.name)
      .join(", ")} (Room: ${roomId})`
  );
  console.log(
    `Timovi: Tim 1 (${gameRoom.players
      .filter((p) => p.team === 1)
      .map((p) => p.name)
      .join(", ")}) vs Tim 2 (${gameRoom.players
      .filter((p) => p.team === 2)
      .map((p) => p.name)
      .join(", ")})`
  );
}

/**
 * Obrađuje igranje karte za 1v1 - AŽURIRANO za gameType
 */
async function processCardPlay1v1(roomId, playerId, card) {
  const room = gameRooms.get(roomId);
  if (!room) return;

  // Importiraj odgovarajuću logiku
  let gameLogic;
  if (room.gameType === "treseta") {
    gameLogic = await import("../core/gameLogicTreseta.js");
  } else {
    gameLogic = await import("../core/gameLogicBriskula.js");
  }

  const {
    determineRoundWinner,
    calculatePoints,
    checkGameEnd,
    isValidMove,
    getPlayableCards,
  } = gameLogic;

  // Za Trešetu - provjeri je li potez valjan
  if (room.gameType === "treseta") {
    const playerNumber = room.players.find(
      (p) => p.id === playerId
    ).playerNumber;
    const playerHand =
      playerNumber === 1
        ? room.gameState.player1Hand
        : room.gameState.player2Hand;

    const moveValidation = isValidMove(
      card,
      playerHand,
      room.gameState.playedCards
    );

    if (!moveValidation.isValid) {
      console.log(`❌ Nevaljan potez: ${moveValidation.reason}`);
      const playerSocket = io.sockets.sockets.get(playerId);
      if (playerSocket) {
        playerSocket.emit("invalidMove", {
          message: moveValidation.reason,
          card: card,
        });
      }
      return;
    }
  }

  // Dodaj kartu u odigrane karte
  const playerNumber = room.players.find((p) => p.id === playerId).playerNumber;
  room.gameState.playedCards.push({
    card: card,
    playerNumber: playerNumber,
  });

  // Ukloni kartu iz ruke igrača
  if (playerNumber === 1) {
    room.gameState.player1Hand = room.gameState.player1Hand.filter(
      (c) => c.id !== card.id
    );
  } else {
    room.gameState.player2Hand = room.gameState.player2Hand.filter(
      (c) => c.id !== card.id
    );
  }

  const playerName = room.players.find((p) => p.id === playerId).name;
  // Pošalji ažuriranje svim igračima u sobi
  io.to(roomId).emit("cardPlayed", {
    playerId: playerId,
    playerNumber: playerNumber,
    playerName: playerName,
    card: card,
    playedCards: room.gameState.playedCards.map((pc) => ({
      ...pc.card,
      playerNumber: pc.playerNumber,
      playerName: room.players.find((p) => p.playerNumber === pc.playerNumber)
        ?.name,
    })),
  });
  broadcastSpectatorUpdate(room);

  // Ako su odigrane 2 karte, završi rundu
  if (room.gameState.playedCards.length === 2) {
    setTimeout(() => finishRound1v1(roomId), 1500); // Kratka pauza za animaciju
  } else {
    // Promijeni red
    room.gameState.currentPlayer = room.gameState.currentPlayer === 1 ? 2 : 1;
    const currentPlayerName = room.players.find(
      (p) => p.playerNumber === room.gameState.currentPlayer
    ).name;

    // Za Trešetu - pošaljite ažurirane playableCards svakom igraču
    if (room.gameType === "treseta") {
      // Extract just the cards from playedCards for getPlayableCards function
      const playedCardsOnly = room.gameState.playedCards.map((pc) => pc.card);

      const player1PlayableCards = getPlayableCards(
        room.gameState.player1Hand,
        playedCardsOnly
      );
      const player2PlayableCards = getPlayableCards(
        room.gameState.player2Hand,
        playedCardsOnly
      );

      console.log(`🎮 Trešeta playableCards mid-round update:`, {
        player1PlayableCards: player1PlayableCards.length,
        player2PlayableCards: player2PlayableCards.length,
        playedCards: room.gameState.playedCards.length,
        nextPlayer: room.gameState.currentPlayer,
        leadSuit: playedCardsOnly[0]?.suit,
      });

      const player1Socket = io.sockets.sockets.get(
        room.players.find((p) => p.playerNumber === 1)?.id
      );
      const player2Socket = io.sockets.sockets.get(
        room.players.find((p) => p.playerNumber === 2)?.id
      );

      if (player1Socket) {
        player1Socket.emit("playableCardsUpdate", {
          playableCards: player1PlayableCards,
        });
      }
      if (player2Socket) {
        player2Socket.emit("playableCardsUpdate", {
          playableCards: player2PlayableCards,
        });
      }
    }

    io.to(roomId).emit("turnChange", {
      currentPlayer: room.gameState.currentPlayer,
      currentPlayerName: currentPlayerName,
    });
  }
}

/**
 * Obrađuje igranje karte za 2v2 - NOVO
 */
async function processCardPlay2v2(roomId, playerId, card) {
  const room = gameRooms.get(roomId);
  if (!room) return;

  // Import correct logic based on gameType
  let getNextPlayer2v2, isValidMove, getPlayableCards;
  if (room.gameType === "treseta") {
    const treseta2v2 = await import("../core/gameLogicTreseta2v2.js");
    getNextPlayer2v2 = treseta2v2.getNextPlayer2v2;
    isValidMove = treseta2v2.isValidMove;
    getPlayableCards = treseta2v2.getPlayableCards;
  } else {
    const logic2v2 = await import("../core/gameLogicBriskula2v2.js");
    getNextPlayer2v2 = logic2v2.getNextPlayer2v2;
  }

  const playerNumber = room.players.find((p) => p.id === playerId).playerNumber;
  const playerHand = room.gameState[`player${playerNumber}Hand`];

  // Validate move for Trešeta
  if (room.gameType === "treseta") {
    const playedCardsOnly = room.gameState.playedCards.map((pc) => pc.card);
    const validation = isValidMove(card, playerHand, playedCardsOnly);

    if (!validation.isValid) {
      console.log(`❌ Invalid move: ${validation.reason}`);
      const playerSocket = io.sockets.sockets.get(playerId);
      if (playerSocket) {
        playerSocket.emit("invalidMove", { reason: validation.reason });
      }
      return;
    }
  }

  // Ako je prva karta u rundi, zapišii tko je počeo
  if (room.gameState.playedCards.length === 0) {
    room.gameState.roundStartPlayer = playerNumber;
  }

  room.gameState.playedCards.push({
    card: card,
    playerNumber: playerNumber,
  });

  room.gameState[`player${playerNumber}Hand`] = room.gameState[
    `player${playerNumber}Hand`
  ].filter((c) => c.id !== card.id);

  const playerName = room.players.find((p) => p.id === playerId).name;
  io.to(roomId).emit("cardPlayed", {
    playerId: playerId,
    playerNumber: playerNumber,
    playerName: playerName,
    card: card,
    playedCards: room.gameState.playedCards.map((pc) => ({
      ...pc.card,
      playerNumber: pc.playerNumber,
      playerName: room.players.find((p) => p.playerNumber === pc.playerNumber)
        ?.name,
    })),
  });
  broadcastSpectatorUpdate(room);

  if (room.gameState.playedCards.length === 4) {
    setTimeout(() => finishRound2v2(roomId), 2000);
  } else {
    room.gameState.currentPlayer = getNextPlayer2v2(
      room.gameState.currentPlayer
    );

    // Ažuriraj playableCards za Trešetu nakon odigrane karte
    if (room.gameType === "treseta") {
      const tresetaLogic = await import("../core/gameLogicTreseta2v2.js");
      const playedCardsOnly = room.gameState.playedCards.map((pc) => pc.card);

      room.gameState.player1PlayableCards = tresetaLogic.getPlayableCards(
        room.gameState.player1Hand,
        playedCardsOnly
      );
      room.gameState.player2PlayableCards = tresetaLogic.getPlayableCards(
        room.gameState.player2Hand,
        playedCardsOnly
      );
      room.gameState.player3PlayableCards = tresetaLogic.getPlayableCards(
        room.gameState.player3Hand,
        playedCardsOnly
      );
      room.gameState.player4PlayableCards = tresetaLogic.getPlayableCards(
        room.gameState.player4Hand,
        playedCardsOnly
      );

      // Pošalji ažurirane playableCards svim igračima
      io.to(roomId).emit("playableCardsUpdate", {
        player1PlayableCards: room.gameState.player1PlayableCards,
        player2PlayableCards: room.gameState.player2PlayableCards,
        player3PlayableCards: room.gameState.player3PlayableCards,
        player4PlayableCards: room.gameState.player4PlayableCards,
      });
    }

    const currentPlayerName = room.players.find(
      (p) => p.playerNumber === room.gameState.currentPlayer
    ).name;
    io.to(roomId).emit("turnChange", {
      currentPlayer: room.gameState.currentPlayer,
      currentPlayerName: currentPlayerName,
    });
  }
}

/**
 * Završava rundu za 1v1 - AŽURIRANO za gameType
 */
async function finishRound1v1(roomId) {
  const room = gameRooms.get(roomId);
  if (!room || room.gameState.playedCards.length !== 2) return;

  // Importiraj odgovarajuću logiku
  let gameLogic;
  if (room.gameType === "treseta") {
    gameLogic = await import("../core/gameLogicTreseta.js");
  } else {
    gameLogic = await import("../core/gameLogicBriskula.js");
  }

  const { determineRoundWinner, calculatePoints, checkGameEnd } = gameLogic;

  const [cardA, cardB] = room.gameState.playedCards;
  const firstPlayer = room.gameState.currentPlayer === 1 ? 2 : 1;
  // cardA je prva karta (igrao ju je firstPlayer), cardB je druga karta
  const card1 = cardA.card; // Karta koju je igrao firstPlayer
  const card2 = cardB.card; // Karta koju je igrao drugi igrač

  console.log(`🎯 Pozivam determineRoundWinner za ${room.gameType}:`, {
    card1: `${card1.name} ${card1.suit}`,
    card2: `${card2.name} ${card2.suit}`,
    firstPlayer: firstPlayer,
    explanation: `Igrač ${firstPlayer} je igrao prvi (${card1.name} ${card1.suit})`,
  });

  let roundWinner;
  if (room.gameType === "treseta") {
    // Trešeta nema trump suit
    roundWinner = determineRoundWinner(card1, card2, firstPlayer);
  } else {
    // Briskula ima trump suit
    roundWinner = determineRoundWinner(
      card1,
      card2,
      room.gameState.trumpSuit,
      firstPlayer
    );
  }

  // Dodijeli karte pobjedniku
  if (roundWinner === 1) {
    room.gameState.player1Cards.push(...room.gameState.playedCards);
  } else {
    room.gameState.player2Cards.push(...room.gameState.playedCards);
  }

  // Uzmi nove karte iz špila i čuvaj informacije o pokupljenim kartama
  let newCards = { player1: null, player2: null };

  if (room.gameState.remainingDeck.length >= 2) {
    // Normalno uzimanje - pobjednik uzima prvu, drugi uzima drugu
    if (roundWinner === 1) {
      const card1 = room.gameState.remainingDeck[0];
      const card2 = room.gameState.remainingDeck[1];
      room.gameState.player1Hand.push(card1);
      room.gameState.player2Hand.push(card2);
      newCards = { player1: card1, player2: card2 };
    } else {
      const card1 = room.gameState.remainingDeck[0];
      const card2 = room.gameState.remainingDeck[1];
      room.gameState.player2Hand.push(card1);
      room.gameState.player1Hand.push(card2);
      newCards = { player1: card2, player2: card1 };
    }
    room.gameState.remainingDeck = room.gameState.remainingDeck.slice(2);
  } else if (room.gameState.remainingDeck.length === 1) {
    // Zadnja karta u špilu
    if (room.gameType === "briskula") {
      // Briskula: pobjednik uzima zadnju kartu, drugi uzima trump
      if (roundWinner === 1) {
        const lastCard = room.gameState.remainingDeck[0];
        const trumpCard = room.gameState.trump;
        room.gameState.player1Hand.push(lastCard);
        room.gameState.player2Hand.push(trumpCard);
        newCards = { player1: lastCard, player2: trumpCard };
      } else {
        const lastCard = room.gameState.remainingDeck[0];
        const trumpCard = room.gameState.trump;
        room.gameState.player2Hand.push(lastCard);
        room.gameState.player1Hand.push(trumpCard);
        newCards = { player1: trumpCard, player2: lastCard };
      }
      room.gameState.trump = null;
    } else {
      // Trešeta: samo pobjednik uzima zadnju kartu
      const lastCard = room.gameState.remainingDeck[0];
      if (roundWinner === 1) {
        room.gameState.player1Hand.push(lastCard);
        newCards = { player1: lastCard, player2: null };
      } else {
        room.gameState.player2Hand.push(lastCard);
        newCards = { player1: null, player2: lastCard };
      }
    }
    room.gameState.remainingDeck = [];
  }

  // Provjeri završetak igre - različito za Briskula/Trešeta
  let gameEnd;
  let player1Points, player2Points;

  if (room.gameType === "treseta") {
    // Trešeta logika
    player1Points = calculatePoints(
      room.gameState.player1Cards,
      room.gameState.ultimaWinner,
      1
    );
    player2Points = calculatePoints(
      room.gameState.player2Cards,
      room.gameState.ultimaWinner,
      2
    );

    // Izračunaj akuže ako su sve karte odigrane
    const isPartidaFinished =
      room.gameState.remainingDeck.length === 0 &&
      room.gameState.player1Hand.length === 0 &&
      room.gameState.player2Hand.length === 0;

    if (isPartidaFinished) {
      room.gameState.ultimaWinner = roundWinner; // Zadnja ruka
    }

    // For 1v1 Treseta with long-term scoring
    console.log(`🔍 Checking long-term scoring conditions:`, {
      gameMode: room.gameMode,
      totalPlayer1Points: room.gameState.totalPlayer1Points,
      isPartidaFinished,
      condition1: room.gameMode === "1v1",
      condition2: room.gameState.totalPlayer1Points !== undefined,
    });

    if (
      room.gameMode === "1v1" &&
      room.gameState.totalPlayer1Points !== undefined
    ) {
      if (isPartidaFinished) {
        // Points already include akuze from client calculation
        const player1PartidaPoints = player1Points.points;
        const player2PartidaPoints = player2Points.points;

        // Add partija points to totals
        room.gameState.totalPlayer1Points += player1PartidaPoints;
        room.gameState.totalPlayer2Points += player2PartidaPoints;

        // Add to partijas history
        room.gameState.partijas.push({
          partija: room.gameState.currentPartija,
          player1Points: player1PartidaPoints,
          player2Points: player2PartidaPoints,
          winner:
            player1PartidaPoints > player2PartidaPoints
              ? 1
              : player2PartidaPoints > player1PartidaPoints
              ? 2
              : 0,
        });

        // Check if match is finished (target score reached)
        const matchFinished =
          room.gameState.totalPlayer1Points >= room.gameState.targetScore ||
          room.gameState.totalPlayer2Points >= room.gameState.targetScore;

        if (matchFinished) {
          // Match is completely finished
          gameEnd = {
            isGameOver: true,
            isPartidaOver: true,
            winner:
              room.gameState.totalPlayer1Points >= room.gameState.targetScore
                ? 1
                : 2,
            reason: `Match finished: ${room.gameState.totalPlayer1Points} - ${room.gameState.totalPlayer2Points}`,
          };
        } else {
          // Just partija finished, match continues
          gameEnd = {
            isGameOver: false,
            isPartidaOver: true,
            winner: null,
            reason: `Partija ${room.gameState.currentPartija} finished: ${player1PartidaPoints} - ${player2PartidaPoints}`,
          };
          console.log(
            `🏆 Partija ${room.gameState.currentPartija} finished. Total scores: ${room.gameState.totalPlayer1Points} - ${room.gameState.totalPlayer2Points}. Will start new partija.`
          );
        }
      } else {
        // Round finished but partija continues
        gameEnd = { isGameOver: false, isPartidaOver: false };
      }
    } else {
      // Original single-game logic for non-1v1 or games without long-term scoring
      gameEnd = checkGameEnd(
        player1Points,
        player2Points,
        room.gameState.player1Akuze,
        room.gameState.player2Akuze,
        room.gameState.remainingDeck,
        room.gameState.player1Hand,
        room.gameState.player2Hand,
        room.gameState.totalPlayer1Points || 0,
        room.gameState.totalPlayer2Points || 0,
        room.gameState.targetScore
      );
    }
  } else {
    // Briskula logika
    player1Points = calculatePoints(room.gameState.player1Cards);
    player2Points = calculatePoints(room.gameState.player2Cards);

    // Za Briskulu, čuvaj ko je uzeo zadnju štiku za tie-breaker
    room.gameState.lastTrickWinner = roundWinner;

    gameEnd = checkGameEnd(
      player1Points,
      player2Points,
      room.gameState.remainingDeck,
      room.gameState.player1Hand,
      room.gameState.player2Hand,
      room.gameState.lastTrickWinner
    );
  }

  // Ažuriraj stanje
  room.gameState.playedCards = [];
  room.gameState.currentPlayer = roundWinner;
  room.gameState.version = Date.now(); // Add version for sync
  room.gameState.lastMove = new Date();

  // Handle game end logic
  if (gameEnd.isGameOver) {
    // Ažuriraj totalScore ako je Trešeta
    if (
      room.gameType === "treseta" &&
      gameEnd.newTotalPlayer1Points !== undefined
    ) {
      room.gameState.totalPlayer1Points = gameEnd.newTotalPlayer1Points;
      room.gameState.totalPlayer2Points = gameEnd.newTotalPlayer2Points;
    }

    if (gameEnd.isFinalGameOver) {
      // Konačna pobjeda - završi sovu
      room.gameState.gamePhase = "finished";
      room.gameState.winner = gameEnd.winner;

      gameStateManager.markGameAsFinished(room.id).catch((err) => {
        console.error(`Error marking game as finished for ${room.id}:`, err);
      });
    } else if (
      room.gameType === "treseta" &&
      gameEnd.isFinalGameOver === false
    ) {
      // Partija završena u Trešeti, pripremi novu partiju
      room.gameState.gamePhase = "partidaFinished";
      room.gameState.winner = gameEnd.partidaWinner;

      console.log(
        `🏆 Partija finished for room ${room.id}. Total scores: ${gameEnd.newTotalPlayer1Points} - ${gameEnd.newTotalPlayer2Points}. Preparing new partija...`
      );

      // Ne označavaj kao finished - serija nastavlja!
    } else {
      // Standardna pobjeda za ostale tipove igara
      room.gameState.gamePhase = "finished";
      room.gameState.winner = gameEnd.winner;

      gameStateManager.markGameAsFinished(room.id).catch((err) => {
        console.error(`Error marking game as finished for ${room.id}:`, err);
      });
    }
  } else if (gameEnd.isPartidaOver) {
    // For Treseta 1v1: partija finished but match continues
    room.gameState.gamePhase = "partidaFinished";
    // DON'T mark as finished - match continues!
    console.log(
      `🏆 Partija finished for room ${room.id}. Waiting for players to continue...`
    );
  }

  // Save game state asynchronously
  gameStateManager.saveGameState(room.id, room).catch((err) => {
    console.error("Error saving game state:", err);
  });

  // Pošalji ažuriranje
  const roundFinishedData = {
    roundWinner: roundWinner,
    player1Points: player1Points,
    player2Points: player2Points,
    gameEnd: gameEnd,
    currentPlayer: room.gameState.currentPlayer,
    remainingCards: room.gameState.remainingDeck.length,
    player1Hand: room.gameState.player1Hand,
    player2Hand: room.gameState.player2Hand,
    gameType: room.gameType,
    newCards: newCards, // Dodano: karte pokupljene iz špila
  };

  // Dodaj specifične podatke ovisno o gameType
  if (room.gameType === "treseta") {
    roundFinishedData.player1Akuze = room.gameState.player1Akuze;
    roundFinishedData.player2Akuze = room.gameState.player2Akuze;
    roundFinishedData.ultimaWinner = room.gameState.ultimaWinner;
  } else {
    roundFinishedData.trump = room.gameState.trump; // Može biti null ako je uzeta
    roundFinishedData.trumpSuit = room.gameState.trumpSuit;
  }

  // Za Trešetu - pošaljite ažurirane playableCards ako igra nije završena
  if (room.gameType === "treseta" && !gameEnd.isGameOver) {
    const { getPlayableCards } = gameLogic;

    // playedCards should be empty at start of new round
    const playedCardsOnly = room.gameState.playedCards.map((pc) => pc.card);

    const player1PlayableCards = getPlayableCards(
      room.gameState.player1Hand,
      playedCardsOnly
    );
    const player2PlayableCards = getPlayableCards(
      room.gameState.player2Hand,
      playedCardsOnly
    );

    console.log(`🎮 Trešeta playableCards update after round:`, {
      player1PlayableCards: player1PlayableCards.length,
      player2PlayableCards: player2PlayableCards.length,
      playedCards: room.gameState.playedCards.length,
      player1HandSize: room.gameState.player1Hand.length,
      player2HandSize: room.gameState.player2Hand.length,
    });

    roundFinishedData.player1PlayableCards = player1PlayableCards;
    roundFinishedData.player2PlayableCards = player2PlayableCards;
  }

  io.to(roomId).emit("roundFinished", roundFinishedData);
  broadcastSpectatorUpdate(room);

  // Check if this is a tournament match that just finished
  if (gameEnd.isGameOver && room.gameState.isTournamentMatch) {
    console.log(`🏆 Tournament match finished in room ${roomId}`, {
      tournamentId: room.gameState.tournamentId,
      matchId: room.gameState.matchId,
      winner: gameEnd.winner,
    });

    // Automatically report tournament result
    setTimeout(() => {
      // Emit tournament game finished event to trigger bracket update
      io.emit("tournamentGameFinished", {
        roomId: roomId,
        tournamentId: room.gameState.tournamentId,
        matchId: room.gameState.matchId,
        winnerId: gameEnd.winner,
        gameResult: {
          player1Score: player1Points,
          player2Score: player2Points,
          gameType: room.gameType,
        },
      });
    }, 2000); // Give players time to see the result
  }

  // Only delete room after timeout if it's truly game over (not just partija over for Treseta)
  if (
    gameEnd.isGameOver &&
    (room.gameType !== "treseta" || gameEnd.isFinalGameOver === true)
  ) {
    setTimeout(() => {
      gameRooms.delete(roomId);
      console.log(`Soba obrisana: ${roomId}`);
    }, 30000);
  }
}

/**
 * Završava rundu za 2v2 - ISPRAVLJENA LOGIKA
 */
async function finishRound2v2(roomId) {
  const room = gameRooms.get(roomId);
  if (!room || room.gameState.playedCards.length !== 4) return;

  // Import correct logic based on gameType
  let determineRoundWinner2v2, getPlayerTeam, calculatePoints, checkGameEnd2v2;

  if (room.gameType === "treseta") {
    const tresetaLogic = await import("../core/gameLogicTreseta2v2.js");
    // Za Trešetu proslijedi playedCards direktno
    determineRoundWinner2v2 = (playedCards, firstPlayer) => {
      return tresetaLogic.determineRoundWinner(playedCards, firstPlayer);
    };
    getPlayerTeam = tresetaLogic.getWinningTeam;
    calculatePoints = tresetaLogic.calculateTeamPoints;
    checkGameEnd2v2 = tresetaLogic.checkGameEnd; // Use new checkGameEnd function
  } else {
    const logic2v2 = await import("../core/gameLogicBriskula2v2.js");
    determineRoundWinner2v2 = logic2v2.determineRoundWinner2v2;
    getPlayerTeam = logic2v2.getPlayerTeam;
    calculatePoints = logic2v2.calculatePoints;
    checkGameEnd2v2 = logic2v2.checkGameEnd2v2;
  }

  // Tko je počeo ovu rundu
  const firstPlayerInRound = room.gameState.roundStartPlayer;

  console.log(`🎯 Round analysis: First player was ${firstPlayerInRound}`);
  console.log(
    `🎯 Cards played in order:`,
    room.gameState.playedCards.map(
      (pc) => `P${pc.playerNumber}: ${pc.card.name} ${pc.card.suit}`
    )
  );

  const roundWinner = determineRoundWinner2v2(
    room.gameState.playedCards,
    firstPlayerInRound,
    room.gameState.trumpSuit
  );

  const winningTeam = getPlayerTeam(roundWinner);
  const roundCards = room.gameState.playedCards.map((pc) => pc.card);

  console.log(`🏆 Round winner: Player ${roundWinner} (Team ${winningTeam})`);

  // Add cards to winning team
  if (winningTeam === 1) {
    room.gameState.team1Cards.push(...roundCards);
  } else {
    room.gameState.team2Cards.push(...roundCards);
  }

  // Draw new cards (same logic as 1v1, but for 4 players)
  if (room.gameState.remainingDeck.length >= 4) {
    // Winner draws first, then in order
    const drawOrder = [];
    let nextPlayer = roundWinner;
    for (let i = 0; i < 4; i++) {
      drawOrder.push(nextPlayer);
      nextPlayer = nextPlayer === 4 ? 1 : nextPlayer + 1;
    }

    console.log(`🃏 Draw order: ${drawOrder.join(" → ")}`);

    drawOrder.forEach((playerNum, index) => {
      room.gameState[`player${playerNum}Hand`].push(
        room.gameState.remainingDeck[index]
      );
    });
    room.gameState.remainingDeck = room.gameState.remainingDeck.slice(4);
  } else if (room.gameState.remainingDeck.length > 0) {
    // Handle remaining cards + trump
    const remaining = [...room.gameState.remainingDeck];
    if (room.gameState.trump) remaining.push(room.gameState.trump);

    // Distribute remaining cards starting with winner
    let playerIndex = roundWinner;
    remaining.forEach((card) => {
      room.gameState[`player${playerIndex}Hand`].push(card);
      playerIndex = playerIndex === 4 ? 1 : playerIndex + 1;
    });

    room.gameState.remainingDeck = [];
    room.gameState.trump = null;
  }

  const allHands = [
    room.gameState.player1Hand,
    room.gameState.player2Hand,
    room.gameState.player3Hand,
    room.gameState.player4Hand,
  ];

  // Calculate points - check if all cards are played for ultima bonus
  const allCardsPlayed =
    room.gameState.remainingDeck.length === 0 &&
    allHands.every((hand) => hand.length === 0);

  const ultimaWinner = allCardsPlayed ? winningTeam : null;

  const team1Points = calculatePoints(
    room.gameState.team1Cards,
    ultimaWinner,
    1
  );
  const team2Points = calculatePoints(
    room.gameState.team2Cards,
    ultimaWinner,
    2
  );

  // Calculate base points from won cards only (no akuze during game)
  let team1TotalPoints = team1Points.points;
  let team2TotalPoints = team2Points.points;

  // DON'T add akuze points here - they are added only at the end of partija
  console.log(
    `📊 Current score: Team 1: ${team1TotalPoints}, Team 2: ${team2TotalPoints} (prije akuža)`
  );

  let gameEnd;
  if (room.gameType === "treseta") {
    // Use new checkGameEnd with totalScore for Treseta 2v2
    const team1Akuze = room.gameState.team1Akuze || [];
    const team2Akuze = room.gameState.team2Akuze || [];

    gameEnd = checkGameEnd2v2(
      team1Points,
      team2Points,
      team1Akuze,
      team2Akuze,
      room.gameState.remainingDeck,
      room.gameState.player1Hand,
      room.gameState.player2Hand,
      room.gameState.player3Hand,
      room.gameState.player4Hand,
      room.gameState.totalTeam1Points || 0,
      room.gameState.totalTeam2Points || 0,
      room.gameState.targetScore
    );
  } else {
    gameEnd = checkGameEnd2v2(
      team1Points,
      team2Points,
      room.gameState.remainingDeck,
      allHands
    );
  }

  room.gameState.playedCards = [];
  room.gameState.currentPlayer = roundWinner; // Pobjednik počinje sljedeću rundu
  room.gameState.roundStartPlayer = roundWinner; // I on je početni igrač sljedeće runde
  room.gameState.roundNumber++;

  if (gameEnd.isGameOver) {
    // Ažuriraj totalScore ako je Trešeta
    if (
      room.gameType === "treseta" &&
      gameEnd.newTotalTeam1Points !== undefined
    ) {
      room.gameState.totalTeam1Points = gameEnd.newTotalTeam1Points;
      room.gameState.totalTeam2Points = gameEnd.newTotalTeam2Points;
    }

    if (gameEnd.isFinalGameOver) {
      // Konačna pobjeda - završi sobu
      room.gameState.gamePhase = "finished";
      room.gameState.winner = gameEnd.winner;

      gameStateManager.markGameAsFinished(room.id).catch((err) => {
        console.error("Error marking game as finished:", err);
      });
    } else if (
      room.gameType === "treseta" &&
      gameEnd.isFinalGameOver === false
    ) {
      // Partija završena u Trešeti, pripremi novu partiju
      room.gameState.gamePhase = "partidaFinished";
      room.gameState.winner = gameEnd.partidaWinner;

      console.log(
        `🏆 Partija finished for room ${room.id}. Total scores: ${gameEnd.newTotalTeam1Points} - ${gameEnd.newTotalTeam2Points}. Preparing new partija...`
      );

      // Ne označavaj kao finished - serija nastavlja!
    } else {
      // Standardna pobjeda za ostale tipove igara
      room.gameState.gamePhase = "finished";
      room.gameState.winner = gameEnd.winner;

      gameStateManager.markGameAsFinished(room.id).catch((err) => {
        console.error("Error marking game as finished:", err);
      });
    }

    console.log(
      `🎮 Game Over! Winner: ${
        gameEnd.winner ? `Team ${gameEnd.winner}` : "Draw"
      } (${gameEnd.reason})`
    );
  }

  const roundFinishedData = {
    roundWinner: roundWinner,
    roundWinningTeam: winningTeam,
    team1Points: {
      ...team1Points,
      points: team1TotalPoints, // Send total points including akuze
    },
    team2Points: {
      ...team2Points,
      points: team2TotalPoints, // Send total points including akuze
    },
    gameEnd: gameEnd,
    currentPlayer: room.gameState.currentPlayer,
    remainingCards: room.gameState.remainingDeck.length,
    player1Hand: room.gameState.player1Hand,
    player2Hand: room.gameState.player2Hand,
    player3Hand: room.gameState.player3Hand,
    player4Hand: room.gameState.player4Hand,
    team1Cards: room.gameState.team1Cards,
    team2Cards: room.gameState.team2Cards,
    trump: room.gameState.trump,
    // Add akuze data for Treseta
    ...(room.gameType === "treseta" &&
      room.akuzeEnabled && {
        team1Akuze: room.gameState.team1Akuze || [],
        team2Akuze: room.gameState.team2Akuze || [],
        player1Akuze: room.gameState.player1Akuze || { points: 0, details: [] },
        player2Akuze: room.gameState.player2Akuze || { points: 0, details: [] },
        player3Akuze: room.gameState.player3Akuze || { points: 0, details: [] },
        player4Akuze: room.gameState.player4Akuze || { points: 0, details: [] },
      }),
  };

  // Add playableCards for Trešeta
  if (room.gameType === "treseta") {
    const tresetaLogic = await import("../core/gameLogicTreseta2v2.js");

    roundFinishedData.player1PlayableCards = tresetaLogic.getPlayableCards(
      room.gameState.player1Hand,
      room.gameState.playedCards.map((pc) => pc.card)
    );
    roundFinishedData.player2PlayableCards = tresetaLogic.getPlayableCards(
      room.gameState.player2Hand,
      room.gameState.playedCards.map((pc) => pc.card)
    );
    roundFinishedData.player3PlayableCards = tresetaLogic.getPlayableCards(
      room.gameState.player3Hand,
      room.gameState.playedCards.map((pc) => pc.card)
    );
    roundFinishedData.player4PlayableCards = tresetaLogic.getPlayableCards(
      room.gameState.player4Hand,
      room.gameState.playedCards.map((pc) => pc.card)
    );
  }

  io.to(roomId).emit("roundFinished", roundFinishedData);
  broadcastSpectatorUpdate(room);

  // Only delete room after timeout if it's truly game over (not just partija over for Treseta)
  if (
    gameEnd.isGameOver &&
    (room.gameType !== "treseta" || gameEnd.isFinalGameOver === true)
  ) {
    setTimeout(() => {
      gameRooms.delete(roomId);
      console.log(`2v2 Soba obrisana: ${roomId}`);
    }, 30000);
  }
}

/**
 * Rukuje disconnection igrača s podrškom za reconnection
 */
async function handlePlayerDisconnectWithReconnect(socketId, force = false) {
  // Pronađi sobu u kojoj je bio igrač ili spectator
  for (const [roomId, room] of gameRooms.entries()) {
    // Provjeri je li pravi igrač
    const disconnectedPlayer = room.players.find((p) => p.id === socketId);
    if (disconnectedPlayer) {
      console.log(
        `🚪 Igrač ${disconnectedPlayer.name} (${disconnectedPlayer.playerNumber}) se odspojio iz ${room.gameMode} igre`
      );

      // Mark player as disconnected but keep them in the room for potential reconnect
      disconnectedPlayer.isConnected = false;
      disconnectedPlayer.disconnectedAt = new Date();

      // Update game state version and save it
      room.gameState.version = Date.now();
      room.gameState.lastMove = new Date();

      // Save game state to preserve it for reconnection
      await gameStateManager.saveGameState(roomId, room);

      let message;
      if (room.gameMode === "2v2") {
        // Za 2v2 igre, prikaži tim informacije
        const teamInfo = `Tim ${disconnectedPlayer.team} (igrač ${disconnectedPlayer.playerNumber})`;
        message = `${disconnectedPlayer.name} se odspojio - ${teamInfo}. Može se reconnectati.`;
      } else {
        // Za 1v1 igre
        message = `${disconnectedPlayer.name} se odspojio. Može se reconnectati.`;
      }

      // Obavijesti ostale igrače
      io.to(roomId).emit("playerDisconnected", {
        disconnectedPlayer: disconnectedPlayer.playerNumber,
        message: message,
        gameMode: room.gameMode,
        playerTeam: disconnectedPlayer.team || null,
        canReconnect: true,
      });

      // Set timeout to delete room if no reconnection happens
      const timeoutId = setTimeout(() => {
        if (gameRooms.has(roomId)) {
          const currentRoom = gameRooms.get(roomId);
          const stillDisconnected = currentRoom.players.find(
            (p) =>
              p.playerNumber === disconnectedPlayer.playerNumber &&
              !p.isConnected
          );

          console.log(
            `⏰ Timeout fired for room ${roomId}, player ${disconnectedPlayer.playerNumber}`
          );
          console.log(
            `📊 Current room players:`,
            currentRoom.players.map((p) => ({
              playerNumber: p.playerNumber,
              name: p.name,
              isConnected: p.isConnected,
              socketId: p.id,
            }))
          );

          if (stillDisconnected) {
            console.log(
              `🗑️ Player ${disconnectedPlayer.playerNumber} still disconnected, deleting room ${roomId}`
            );

            // Mark player as permanently left
            stillDisconnected.permanentlyLeft = true;
            stillDisconnected.forfeited = true;

            // Send permanent disconnect event before deleting room
            io.to(roomId).emit("playerLeft", {
              disconnectedPlayer: stillDisconnected.playerNumber,
              playerName: stillDisconnected.name,
              message: `${stillDisconnected.name} je napustio igru`,
              permanent: true,
              reason: "timeout",
            });

            // Give a moment for the event to be processed, then delete room
            setTimeout(() => {
              gameRooms.delete(roomId);
              io.to(roomId).emit("gameRoomDeleted", {
                message: "Igra je završena zbog dugotrajnog disconnection",
                reason: "timeout",
              });
              console.log(`🗑️ Soba ${roomId} obrisana nakon timeout (60s)`);
            }, 500);
          } else {
            console.log(
              `✅ Player ${disconnectedPlayer.playerNumber} reconnected, keeping room ${roomId}`
            );
          }
        } else {
          console.log(`⏰ Timeout fired but room ${roomId} no longer exists`);
        }
      }, 60000); // 60 seconds timeout

      // Store timeout ID in room for potential cleanup
      if (!room.disconnectTimeouts) {
        room.disconnectTimeouts = new Map();
      }
      room.disconnectTimeouts.set(disconnectedPlayer.playerNumber, timeoutId);
      console.log(
        `⏰ Set disconnect timeout ${timeoutId} for player ${disconnectedPlayer.playerNumber} in room ${roomId}`
      );

      break;
    }
    // --- NOVO: Provjeri je li spectator ---
    else if (room.spectators && room.spectators.includes(socketId)) {
      console.log(`👁️ Spectator ${socketId} left room ${roomId}`);

      // Samo ukloni iz spectators liste - NE prekidaj igru
      room.spectators = room.spectators.filter((id) => id !== socketId);

      console.log(
        `👁️ Remaining spectators in room ${roomId}: ${room.spectators.length}`
      );
      break;
    }
  }
}

/**
 * Rukuje disconnection igrača (original function - deprecated)
 */
function handlePlayerDisconnect(socketId) {
  // Pronađi sobu u kojoj je bio igrač
  for (const [roomId, room] of gameRooms.entries()) {
    const disconnectedPlayer = room.players.find((p) => p.id === socketId);
    if (disconnectedPlayer) {
      console.log(
        `🚪 Igrač ${disconnectedPlayer.name} (${disconnectedPlayer.playerNumber}) se odspojio iz ${room.gameMode} igre`
      );

      let message;
      if (room.gameMode === "2v2") {
        // Za 2v2 igre, prikaži tim informacije
        const teamInfo = `Tim ${disconnectedPlayer.team} (igrač ${disconnectedPlayer.playerNumber})`;
        message = `${disconnectedPlayer.name} se odspojio - ${teamInfo}`;
      } else {
        // Za 1v1 igre
        message = `${disconnectedPlayer.name} se odspojio`;
      }

      // Obavijesti ostale igrače
      io.to(roomId).emit("playerDisconnected", {
        disconnectedPlayer: disconnectedPlayer.playerNumber,
        message: message,
        gameMode: room.gameMode,
        playerTeam: disconnectedPlayer.team || null,
      });

      // Za sada samo obriši sobu, kasnije možemo dodati reconnect logiku
      setTimeout(() => {
        if (gameRooms.has(roomId)) {
          gameRooms.delete(roomId);
          console.log(`🗑️ Soba ${roomId} obrisana nakon disconnection`);
        }
      }, 5000);

      break;
    }
  }
}

// Custom game helper functions
function broadcastGameList() {
  const customGames = Array.from(gameRooms.values())
    .filter((room) => room.isCustom && room.status !== "playing")
    .map((room) => ({
      id: room.id,
      name: room.name,
      gameType: room.gameType,
      gameMode: room.gameMode,
      creator: room.creator,
      playerCount: room.players.length,
      maxPlayers: room.maxPlayers,
      hasPassword: room.hasPassword,
      status: room.status,
      createdAt: room.createdAt,
    }));

  io.emit("activeGamesUpdate", customGames);
}

async function startCustomGame(roomId) {
  const room = gameRooms.get(roomId);
  if (!room) return;

  console.log(
    `🎯 Starting custom ${room.gameMode} ${room.gameType} game: ${room.name}`
  );

  room.status = "playing";
  room.gameState.gamePhase = "playing";

  // Import appropriate game logic
  let gameLogic;
  if (room.gameType === "treseta") {
    if (room.gameMode === "2v2") {
      gameLogic = await import("../core/gameLogicTreseta2v2.js");
    } else {
      gameLogic = await import("../core/gameLogicTreseta.js");
    }
  } else {
    if (room.gameMode === "2v2") {
      gameLogic = await import("../core/gameLogicBriskula2v2.js");
    } else {
      gameLogic = await import("../core/gameLogicBriskula.js");
    }
  }

  const { createDeck, shuffleDeck, dealCards } = gameLogic;

  // Create and deal cards
  const deck = createDeck();
  const shuffledDeck = shuffleDeck(deck);
  const dealt = dealCards(shuffledDeck, room.gameMode === "2v2");

  // Create game state based on mode
  let gameStateData = {
    currentPlayer: 1,
    playedCards: [],
    gamePhase: "playing",
    winner: null,
    gameType: room.gameType,
    version: Date.now(),
    lastMove: new Date(),
  };

  if (room.gameMode === "1v1") {
    gameStateData = {
      ...gameStateData,
      player1Hand: dealt.player1Hand,
      player2Hand: dealt.player2Hand,
      player1Cards: [],
      player2Cards: [],
      remainingDeck: dealt.remainingDeck,
    };

    // Add game-specific data
    if (room.gameType === "briskula") {
      gameStateData.trump = dealt.trump;
      gameStateData.trumpSuit = dealt.trump.suit;
      gameStateData.lastTrickWinner = null;
    } else if (room.gameType === "treseta") {
      gameStateData.player1Akuze = { points: 0, details: [] };
      gameStateData.player2Akuze = { points: 0, details: [] };
      gameStateData.ultimaWinner = null;

      // Long-term scoring for 1v1 Treseta
      gameStateData.totalPlayer1Points = 0;
      gameStateData.totalPlayer2Points = 0;
      gameStateData.partijas = []; // History of completed partijas
      gameStateData.currentPartija = 1;
      gameStateData.targetScore = 31; // Target score for match victory
      gameStateData.hasPlayedFirstCard = false;
    }
  } else {
    // 2v2
    gameStateData = {
      ...gameStateData,
      player1Hand: dealt.player1Hand,
      player2Hand: dealt.player2Hand,
      player3Hand: dealt.player3Hand,
      player4Hand: dealt.player4Hand,
      team1Cards: [],
      team2Cards: [],
      remainingDeck: dealt.remainingDeck,
    };

    // Add game-specific data
    if (room.gameType === "briskula") {
      gameStateData.trump = dealt.trump;
      gameStateData.trumpSuit = dealt.trump.suit;
      gameStateData.lastTrickWinner = null;
    } else if (room.gameType === "treseta") {
      gameStateData.player1Akuze = { points: 0, details: [] };
      gameStateData.player2Akuze = { points: 0, details: [] };
      gameStateData.player3Akuze = { points: 0, details: [] };
      gameStateData.player4Akuze = { points: 0, details: [] };
      gameStateData.ultimaWinner = null;
    }
  }

  // Merge game data with room
  room.gameState = { ...room.gameState, ...gameStateData };

  try {
    await gameStateManager.saveGameState(roomId, room);
  } catch (error) {
    console.error("Failed to save custom game state:", error);
  }

  // Calculate playable cards for each player
  const { getPlayableCards } = gameLogic;

  let player1PlayableCards, player2PlayableCards;

  if (room.gameType === "treseta") {
    // For Treseta, use getPlayableCards function
    player1PlayableCards = getPlayableCards(
      room.gameState.player1Hand,
      room.gameState.playedCards
    );
    player2PlayableCards = getPlayableCards(
      room.gameState.player2Hand,
      room.gameState.playedCards
    );
  } else {
    // For Briskula, all cards are playable
    player1PlayableCards = room.gameState.player1Hand.map((card) => card.id);
    player2PlayableCards = room.gameState.player2Hand.map((card) => card.id);
  }

  // Emit game start to each player individually with their playable cards
  room.players.forEach((player) => {
    const playerSocket = io.sockets.sockets.get(player.id);
    if (playerSocket) {
      const opponent = room.players.find(
        (p) => p.playerNumber !== player.playerNumber
      );
      const playableCards =
        player.playerNumber === 1 ? player1PlayableCards : player2PlayableCards;

      playerSocket.emit("gameStart", {
        gameState: {
          ...room.gameState,
          playableCards: playableCards,
        },
        roomId: roomId,
        gameMode: room.gameMode,
        gameType: room.gameType,
        players: room.players,
        playerNumber: player.playerNumber,
        opponent: opponent ? { name: opponent.name } : null,
        // Include akuze setting for Treseta
        ...(room.gameType === "treseta" &&
          room.akuzeEnabled !== undefined && {
            akuzeEnabled: room.akuzeEnabled,
          }),
      });
    }
  });

  console.log(`📤 Sent individual gameStart events with playableCards:`, {
    roomId: roomId,
    player1PlayableCards: player1PlayableCards.length,
    player2PlayableCards: player2PlayableCards.length,
  });

  // Remove from game list since it's now playing
  broadcastGameList();

  console.log(`✅ Custom game started: ${room.name}`);
}

// Function to automatically start new partija in Treseta 1v1 games
async function startNewPartija(room) {
  if (
    !room ||
    room.gameType !== "treseta" ||
    (room.gameMode !== "1v1" && room.gameMode !== "2v2")
  ) {
    console.log(`❌ Cannot start new partija - invalid room or game type:`, {
      hasRoom: !!room,
      gameType: room?.gameType,
      gameMode: room?.gameMode,
    });
    return;
  }

  console.log(
    `🔄 Starting new partija ${room.gameState.currentPartija + 1} in room ${
      room.id
    } (${room.gameMode})`
  );

  try {
    // Import game logic
    const { createDeck, shuffleDeck, dealCards, getPlayableCards } =
      await import("../core/gameLogicTreseta.js");

    // Create and deal new deck
    const deck = shuffleDeck(createDeck());
    const dealt = dealCards(deck, room.gameMode === "2v2");

    // Reset game state for new partija
    if (room.gameMode === "1v1") {
      room.gameState.player1Hand = dealt.player1Hand;
      room.gameState.player2Hand = dealt.player2Hand;
      room.gameState.player1Cards = [];
      room.gameState.player2Cards = [];

      // Reset akuze for new partija
      room.gameState.player1Akuze = { points: 0, details: [] };
      room.gameState.player2Akuze = { points: 0, details: [] };
    } else if (room.gameMode === "2v2") {
      room.gameState.player1Hand = dealt.player1Hand;
      room.gameState.player2Hand = dealt.player2Hand;
      room.gameState.player3Hand = dealt.player3Hand;
      room.gameState.player4Hand = dealt.player4Hand;
      room.gameState.team1Cards = [];
      room.gameState.team2Cards = [];

      // Reset akuze for new partija
      room.gameState.team1Akuze = [];
      room.gameState.team2Akuze = [];
    }

    room.gameState.remainingDeck = dealt.remainingDeck;
    room.gameState.currentPlayer = 1; // Player 1 always starts new partija
    room.gameState.playedCards = [];
    room.gameState.gamePhase = "playing";
    room.gameState.winner = null;
    room.gameState.ultimaWinner = null;
    room.gameState.hasPlayedFirstCard = false;

    // Increment partija counter (initialize if undefined)
    if (
      !room.gameState.currentPartija ||
      isNaN(room.gameState.currentPartija)
    ) {
      room.gameState.currentPartija = 1;
    } else {
      room.gameState.currentPartija += 1;
    }
    room.gameState.version = Date.now();
    room.gameState.lastMove = new Date();

    console.log(
      `📦 New partija ${room.gameState.currentPartija} prepared. Dealing cards...`
    );

    // Save state
    try {
      await gameStateManager.saveGameState(room.id, room);
      console.log(`💾 Game state saved for new partija`);
    } catch (err) {
      console.error("Error saving new partija state:", err);
    }

    // Calculate playable cards for new partija
    let partidaData;

    if (room.gameMode === "1v1") {
      const player1PlayableCards = getPlayableCards(
        room.gameState.player1Hand,
        []
      );
      const player2PlayableCards = getPlayableCards(
        room.gameState.player2Hand,
        []
      );

      partidaData = {
        currentPlayer: room.gameState.currentPlayer,
        remainingCards: room.gameState.remainingDeck.length,
        player1Hand: room.gameState.player1Hand,
        player2Hand: room.gameState.player2Hand,
        player1PlayableCards,
        player2PlayableCards,
      };
    } else if (room.gameMode === "2v2") {
      const player1PlayableCards = getPlayableCards(
        room.gameState.player1Hand,
        []
      );
      const player2PlayableCards = getPlayableCards(
        room.gameState.player2Hand,
        []
      );
      const player3PlayableCards = getPlayableCards(
        room.gameState.player3Hand,
        []
      );
      const player4PlayableCards = getPlayableCards(
        room.gameState.player4Hand,
        []
      );

      partidaData = {
        currentPlayer: room.gameState.currentPlayer,
        remainingCards: room.gameState.remainingDeck.length,
        player1Hand: room.gameState.player1Hand,
        player2Hand: room.gameState.player2Hand,
        player3Hand: room.gameState.player3Hand,
        player4Hand: room.gameState.player4Hand,
        player1PlayableCards,
        player2PlayableCards,
        player3PlayableCards,
        player4PlayableCards,
      };
    }

    console.log(
      `📤 Sending partidaRestarted event to ${room.players.length} players`
    );

    // Send partidaRestarted event to all players in room
    room.players.forEach((player, index) => {
      if (player.isConnected) {
        console.log(
          `📤 Sending to player ${index + 1}: ${player.name} (${player.id})`
        );
        io.to(player.id).emit("partidaRestarted", partidaData);
      } else {
        console.log(`⚠️ Player ${index + 1}: ${player.name} is not connected`);
      }
    });

    console.log(
      `✅ New partija ${room.gameState.currentPartija} started in room ${room.id}`
    );
    // Notify spectators of the new partija (public info only)
    broadcastSpectatorUpdate(room);
  } catch (error) {
    console.error(`❌ Error starting new partija for room ${room.id}:`, error);
  }
}

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`🎮 Briskula server (1v1 + 2v2) pokrenut na portu ${PORT}`);
  console.log(`📊 Status endpoint: http://localhost:${PORT}/api/status`);
});
