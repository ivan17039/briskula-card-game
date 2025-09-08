// server.js - Glavni Socket.io server za Briskulu (1v1 + 2v2)

// Load environment variables
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";

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
        const validation = sessionManager.validateSession(
          userData.sessionToken
        );
        if (validation.valid) {
          // Reconnect postojeće sesije
          const reconnectResult = sessionManager.reconnectSession(
            userData.sessionToken,
            socket.id
          );
          if (reconnectResult.success) {
            session = reconnectResult.session;

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
            });

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

            console.log(
              `✅ Session reconnected: ${session.userName} (${session.sessionId})`
            );
            return;
          }
        }
      }

      // Provjeri da li korisnik već ima aktivnu sesiju (bez session token-a)
      const existingSession = sessionManager.findSessionByUser(
        userData.userId || userData.id,
        userData.name,
        userData.isGuest
      );

      if (existingSession) {
        // Reconnect postojeće sesije
        const reconnectResult = sessionManager.reconnectSession(
          existingSession.sessionToken,
          socket.id
        );
        if (reconnectResult.success) {
          session = reconnectResult.session;

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
          });

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

          console.log(`✅ Existing session reconnected: ${session.userName}`);
          return;
        }
      }

      // Stvori novu sesiju
      const sessionData = sessionManager.createSession(userData, socket.id);

      console.log("🔍 Debug sessionData:", sessionData);

      const user = {
        id: socket.id,
        name: userData.name || `Guest_${socket.id.substring(0, 6)}`,
        isGuest: userData.isGuest !== false,
        email: userData.email || null,
        userId: userData.userId || null,
        sessionToken: sessionData.sessionToken,
        joinedAt: new Date(),
      };

      console.log("🔍 Debug user before emit:", {
        sessionToken: user.sessionToken,
        hasSessionData: !!sessionData,
      });

      connectedUsers.set(socket.id, user);

      socket.emit("registered", {
        success: true,
        session: sessionData,
        user: user,
        message: `Dobrodošli, ${user.name}!`,
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
            isGuest: user.isGuest,
            playerNumber: 1,
            isConnected: true,
            team: gameData.gameMode === "2v2" ? 1 : null,
          },
        ],
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

    const leavingPlayer = room.players.find((p) => p.id === socket.id);
    if (!leavingPlayer) return;

    console.log(
      `🚪 Igrač ${leavingPlayer.name} (${leavingPlayer.playerNumber}) je privremeno napustio ${room.gameMode} igru (može se reconnect)`
    );

    let message;
    if (room.gameMode === "2v2") {
      // Za 2v2 igre, prikaži tim informacije
      const teamInfo = `Tim ${leavingPlayer.team} (igrač ${leavingPlayer.playerNumber})`;
      message = `${leavingPlayer.name} je napustio sobu - ${teamInfo}`;
    } else {
      // Za 1v1 igre
      message = `${leavingPlayer.name} je napustio sobu.`;
    }

    // Obavijesti ostale igrače
    io.to(roomId).emit("playerLeft", {
      playerNumber: leavingPlayer.playerNumber,
      message: message,
      gameMode: room.gameMode,
      playerTeam: leavingPlayer.team || null,
    });

    // Obriši sobu odmah
    gameRooms.delete(roomId);
    socket.leave(roomId);
    console.log(`🗑️ Soba ${roomId} obrisana jer je igrač napustio.`);
  });

  // Leave room permanently (no reconnect possible)
  socket.on("leaveRoomPermanently", async (roomId) => {
    const room = gameRooms.get(roomId);
    if (!room) return;

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

    // Mark player as permanently left
    leavingPlayer.permanentlyLeft = true;
    leavingPlayer.isConnected = false;

    // Notify other players about permanent leave
    io.to(roomId).emit("playerLeft", {
      playerNumber: leavingPlayer.playerNumber,
      message: message,
      gameMode: room.gameMode,
      playerTeam: leavingPlayer.team || null,
      permanent: true, // Flag to indicate this is permanent
    });

    // Delete the entire room and clean up all storage for all players
    try {
      await gameStateManager.deleteGame(roomId);
      console.log(`🗑️ Deleted game storage for room ${roomId}`);
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
          console.log(`🗑️ Cleared session for ${player.name}`);
        }
      }
    } catch (error) {
      console.log("Session cleanup for room players failed:", error.message);
    }

    // Send roomDeleted event to all remaining players to force them to main menu
    io.to(roomId).emit("roomDeleted", {
      message: "Soba je obrisana jer je igrač trajno napustio igru.",
      redirectToMenu: true,
    });

    // Delete room from memory
    gameRooms.delete(roomId);
    socket.leave(roomId);
    console.log(`🗑️ Soba ${roomId} trajno obrisana.`);
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

  // Enhanced reconnection handler
  socket.on("reconnectToGame", async (reconnectData) => {
    try {
      console.log(`  Reconnection attempt from ${socket.id}:`, {
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

      // Validate session if provided
      let session = null;
      if (reconnectData.sessionToken) {
        const validation = sessionManager.validateSession(
          reconnectData.sessionToken
        );
        if (!validation.valid) {
          socket.emit("reconnectFailed", {
            message: "Sesija je istekla ili neispravna",
          });
          return;
        }
        session = validation.session;
      }

      // Pokušaj pronaći aktivnu sobu
      let room = gameRooms.get(reconnectData.roomId);
      console.log(`🔍 Looking for room ${reconnectData.roomId}:`, {
        foundInMemory: !!room,
        totalRoomsInMemory: gameRooms.size,
        roomIds: Array.from(gameRooms.keys()),
      });

      // Ako soba ne postoji u memoriji, pokušaj je učitati iz storage-a
      if (!room) {
        console.log(
          `🔄 Room not in memory, attempting to restore from storage...`
        );

        // Provjeri da li game postoji u storage
        const gameExists = await gameStateManager.gameExists(
          reconnectData.roomId
        );
        console.log(`📁 Game exists in storage: ${gameExists}`);

        if (gameExists) {
          const restoredGame = await gameStateManager.restoreGame(
            reconnectData.roomId
          );
          console.log(`📖 Restore result:`, {
            restored: !!restoredGame,
            gameMode: restoredGame?.gameMode,
            playerCount: restoredGame?.players?.length,
            gamePhase: restoredGame?.gameState?.gamePhase,
          });

          if (restoredGame) {
            gameRooms.set(reconnectData.roomId, restoredGame);
            room = restoredGame;
            console.log(
              `✅ Game restored from storage: ${reconnectData.roomId}`
            );
          }
        }
      } else {
        console.log(`📋 Room found in memory, checking for sync...`);
        // Ako soba postoji u memoriji, možda treba sync-ati sa storage
        // Ovo pomaže u slučaju kad se jedan igrač disconnectuje a drugi ostane
        const savedGame = await gameStateManager.restoreGame(
          reconnectData.roomId,
          room
        );
        if (savedGame && savedGame.gameState.version > room.gameState.version) {
          // Merge newer saved state while preserving current connections
          room.gameState = savedGame.gameState;
          console.log(
            `🔄 Game state synced from storage: ${reconnectData.roomId}`
          );
        }
      }

      if (!room) {
        console.log(`❌ Room still not found after restore attempt`);
        socket.emit("reconnectFailed", { message: "Soba ne postoji" });
        return;
      }

      // Pronađi igrača u sobi
      let playerInRoom = null;

      if (session) {
        // Koristi session manager za pronalaženje igrača
        playerInRoom = sessionManager.findPlayerSession(
          reconnectData.roomId,
          session.playerNumber
        );
        if (!playerInRoom) {
          // Fallback - potraži u room.players
          playerInRoom = room.players.find(
            (p) =>
              (p.userId === session.userId && !session.isGuest) ||
              (p.name === session.userName && session.isGuest)
          );
        }
      } else {
        // Legacy fallback
        if (reconnectData.isGuest) {
          playerInRoom = room.players.find(
            (p) => p.name === reconnectData.playerName && p.isGuest === true
          );
        } else {
          playerInRoom = room.players.find(
            (p) => p.userId === reconnectData.userId && p.isGuest === false
          );
        }
      }

      if (!playerInRoom) {
        console.log(`❌ Player not found in room`, {
          isGuest: reconnectData.isGuest || session?.isGuest,
          playerName: reconnectData.playerName || session?.userName,
          userId: reconnectData.userId || session?.userId,
          playersInRoom: room.players.map((p) => ({
            name: p.name,
            userId: p.userId,
            isGuest: p.isGuest,
            permanentlyLeft: p.permanentlyLeft,
          })),
        });
        socket.emit("reconnectFailed", {
          message: "Niste dio ove igre",
          reason: "playerNotFound",
        });
        return;
      }

      // Check if player permanently left
      if (playerInRoom.permanentlyLeft) {
        console.log(`❌ Player ${playerInRoom.name} permanently left the game`);
        socket.emit("reconnectFailed", {
          message: "Napustili ste ovu igru i ne možete se vratiti",
          reason: "permanentlyLeft",
        });
        return;
      }

      // Check if any other player permanently left (room should be deleted)
      const someoneLeft = room.players.some((p) => p.permanentlyLeft);
      if (someoneLeft) {
        console.log(
          `❌ Room ${reconnectData.roomId} has players that permanently left`
        );
        // Clean up the room
        try {
          await gameStateManager.deleteGame(reconnectData.roomId);
          gameRooms.delete(reconnectData.roomId);
        } catch (error) {
          console.log("Cleanup failed:", error.message);
        }
        socket.emit("reconnectFailed", {
          message: "Soba više ne postoji jer je netko napustio igru",
          reason: "roomDeleted",
        });
        return;
      }

      // Update player status
      playerInRoom.id = socket.id;
      playerInRoom.isConnected = true;
      delete playerInRoom.disconnectedAt;

      // Clear any disconnect timeout
      if (
        room.disconnectTimeouts &&
        room.disconnectTimeouts.has(playerInRoom.playerNumber)
      ) {
        clearTimeout(room.disconnectTimeouts.get(playerInRoom.playerNumber));
        room.disconnectTimeouts.delete(playerInRoom.playerNumber);
      }

      // Update session manager
      if (session) {
        sessionManager.reconnectSession(session.sessionToken, socket.id);
        sessionManager.assignToGameRoom(
          session.sessionToken,
          reconnectData.roomId,
          playerInRoom.playerNumber
        );
      }

      // Update connected users
      connectedUsers.set(socket.id, playerInRoom);

      // Join socket room
      socket.join(reconnectData.roomId);

      // Ensure all connected players are in the socket room
      room.players.forEach((player) => {
        if (player.isConnected && player.id) {
          const playerSocket = io.sockets.sockets.get(player.id);
          if (playerSocket && !playerSocket.rooms.has(reconnectData.roomId)) {
            playerSocket.join(reconnectData.roomId);
            console.log(
              `🔗 Re-joined player ${player.name} to socket room ${reconnectData.roomId}`
            );
          }
        }
      });

      // Save updated game state
      await gameStateManager.saveGameState(reconnectData.roomId, room);

      // Find opponent for the reconnecting player
      let opponent = null;
      if (room.gameMode === "1v1") {
        opponent = room.players.find(
          (p) => p.playerNumber !== playerInRoom.playerNumber
        );
      }

      // Calculate playableCards for Treseta games during reconnection
      let playableCards = null;
      if (
        room.gameType === "treseta" &&
        room.gameState.gamePhase === "playing"
      ) {
        const gameLogic = await import("../core/gameLogicTreseta.js");
        const { getPlayableCards } = gameLogic;

        const playedCardsOnly = room.gameState.playedCards.map((pc) => pc.card);
        const playerHand =
          playerInRoom.playerNumber === 1
            ? room.gameState.player1Hand
            : room.gameState.player2Hand;

        playableCards = getPlayableCards(playerHand, playedCardsOnly);

        console.log(`🔄 Reconnection playableCards for ${playerInRoom.name}:`, {
          playerNumber: playerInRoom.playerNumber,
          playableCards: playableCards.length,
          totalHand: playerHand.length,
          playedCards: playedCardsOnly.length,
          leadSuit: playedCardsOnly[0]?.suit || "none",
        });
      }

      // Send successful reconnect response with opponent info
      const reconnectResponse = {
        success: true,
        gameState: room.gameState,
        roomId: room.id,
        gameMode: room.gameMode,
        gameType: room.gameType,
        players: room.players,
        playerNumber: playerInRoom.playerNumber,
        opponent: opponent ? { name: opponent.name } : null,
        message: "Uspješno reconnected!",
      };

      // Add playableCards for Treseta
      if (playableCards !== null) {
        reconnectResponse.playableCards = playableCards;
      }

      socket.emit("reconnected", reconnectResponse);

      // Notify other players
      socket.to(reconnectData.roomId).emit("playerReconnected", {
        playerNumber: playerInRoom.playerNumber,
        playerName: playerInRoom.name,
        message: `${playerInRoom.name} se vratio u igru`,
      });

      console.log(
        `✅ ${playerInRoom.name} reconnected to room ${reconnectData.roomId}`
      );
    } catch (error) {
      console.error("Error during reconnection:", error);
      socket.emit("reconnectFailed", {
        message: "Greška prilikom reconnection",
        error: error.message,
      });
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

  // Handle rematch decline
  socket.on("declineRematch", async (data) => {
    console.log(
      `❌ Player ${socket.id} declined rematch in room ${data.gameId}`
    );

    const room = gameRooms.get(data.gameId);
    if (!room) {
      console.log(`⚠️ Room ${data.gameId} not found for decline`);
      return;
    }

    // Find player in room
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      console.log(`⚠️ Player ${socket.id} not found in room ${data.gameId}`);
      return;
    }

    // Clear rematch ready status
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

  // Enhanced disconnection handler
  socket.on("disconnect", async (reason) => {
    console.log(`❌ Korisnik ${socket.id} se odspojio: ${reason}`);

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
      { ...player1, playerNumber: 1, isConnected: true },
      { ...player2, playerNumber: 2, isConnected: true },
    ],
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
      playerNumber: 1,
      opponent: { name: player2.name },
      gameType: gameType,
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
      playerNumber: 2,
      opponent: { name: player1.name },
      gameType: gameType,
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
      };
    }),
    gameState,
    createdAt: new Date(),
  };

  gameRooms.set(roomId, gameRoom);

  // Join all players to the room and send game start data
  players.forEach((player, index) => {
    const playerSocket = io.sockets.sockets.get(player.id);
    if (playerSocket) {
      playerSocket.join(roomId);

      const playerNumber = index + 1;
      const team = playerNumber === 1 || playerNumber === 3 ? 1 : 2;

      playerSocket.emit("gameStart", {
        roomId: roomId,
        playerNumber: playerNumber,
        myTeam: team,
        gameType: gameType, // DODANO
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
async function handlePlayerDisconnectWithReconnect(socketId) {
  // Pronađi sobu u kojoj je bio igrač
  for (const [roomId, room] of gameRooms.entries()) {
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

          if (stillDisconnected) {
            gameRooms.delete(roomId);
            io.to(roomId).emit("gameRoomDeleted", {
              message: "Igra je završena zbog dugotrajnog disconnection",
              reason: "timeout",
            });
            console.log(`🗑️ Soba ${roomId} obrisana nakon timeout (60s)`);
          }
        }
      }, 60000); // 60 seconds timeout

      // Store timeout ID in room for potential cleanup
      if (!room.disconnectTimeouts) {
        room.disconnectTimeouts = new Map();
      }
      room.disconnectTimeouts.set(disconnectedPlayer.playerNumber, timeoutId);

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
  } catch (error) {
    console.error(`❌ Error starting new partija for room ${room.id}:`, error);
  }
}

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`🎮 Briskula server (1v1 + 2v2) pokrenut na portu ${PORT}`);
  console.log(`📊 Status endpoint: http://localhost:${PORT}/api/status`);
});
