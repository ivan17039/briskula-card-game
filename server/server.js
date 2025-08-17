// server.js - Glavni Socket.io server za Briskulu (1v1 + 2v2)

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);

// CORS konfiguracija
const allowedOrigins = [
  "http://localhost:5173", // Local development
  "https://briskula-card-game.vercel.app", // Production Vercel
  "https://briskula-card-game-*.vercel.app", // Vercel preview deployments
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

const io = socketIo(server, {
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

// Socket.io logika
io.on("connection", (socket) => {
  console.log(`Korisnik se spojio: ${socket.id}`);

  // Registracija korisnika (login ili guest)
  socket.on("register", (userData) => {
    const user = {
      id: socket.id,
      name: userData.name || `Guest_${socket.id.substring(0, 6)}`,
      isGuest: userData.isGuest || true,
      email: userData.email || null,
      joinedAt: new Date(),
    };

    connectedUsers.set(socket.id, user);

    socket.emit("registered", {
      success: true,
      user: user,
      message: `Dobrodošli, ${user.name}!`,
    });

    console.log(
      `Korisnik registriran: ${user.name} (${
        user.isGuest ? "Guest" : "Registered"
      })`
    );
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

    console.log(`✅ Kartu može igrati, obrađujem potez`);

    // Obradi potez ovisno o načinu igre
    if (room.gameMode === "1v1") {
      processCardPlay1v1(roomId, socket.id, card);
    } else {
      processCardPlay2v2(roomId, socket.id, card);
    }
  });

  // Leave room event
  socket.on("leaveRoom", (roomId) => {
    const room = gameRooms.get(roomId);
    if (!room) return;

    const leavingPlayer = room.players.find((p) => p.id === socket.id);
    if (!leavingPlayer) return;

    console.log(
      `🚪 Igrač ${leavingPlayer.name} (${leavingPlayer.playerNumber}) je napustio ${room.gameMode} igru`
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

  // Disconnection - UPDATED
  socket.on("disconnect", () => {
    console.log(`Korisnik se odspojio: ${socket.id}`);

    // Ukloni iz oba waiting queue-a
    const queueIndex1v1 = waitingQueue1v1.findIndex((u) => u.id === socket.id);
    const queueIndex2v2 = waitingQueue2v2.findIndex((u) => u.id === socket.id);

    if (queueIndex1v1 !== -1) {
      waitingQueue1v1.splice(queueIndex1v1, 1);
    }
    if (queueIndex2v2 !== -1) {
      waitingQueue2v2.splice(queueIndex2v2, 1);
    }

    // Rukovanje disconnection u aktivnoj igri
    handlePlayerDisconnect(socket.id);

    // Ukloni iz connected users
    connectedUsers.delete(socket.id);
  });
});

/**
 * Kreira novu sobu za 1v1 igru
 */
function createGameRoom1v1(player1, player2, gameType = "briskula") {
  const roomId = uuidv4();

  // Importiraj odgovarajuću game logiku
  let gameLogic;
  if (gameType === "treseta") {
    gameLogic = require("./gameLogicTreseta");
  } else {
    gameLogic = require("./gameLogic");
  }

  const { createDeck, shuffleDeck, dealCards } = gameLogic;

  const deck = createDeck();
  const shuffledDeck = shuffleDeck(deck);
  const dealt = dealCards(shuffledDeck);

  const gameRoom = {
    id: roomId,
    gameMode: "1v1",
    gameType: gameType, // DODANO
    players: [
      { ...player1, playerNumber: 1 },
      { ...player2, playerNumber: 2 },
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
      // Specifične za Briskula
      ...(gameType === "briskula" && {
        trump: dealt.trump,
        trumpSuit: dealt.trump.suit,
      }),
      // Specifične za Trešeta
      ...(gameType === "treseta" && {
        player1Akuze: { points: 0, details: [] },
        player2Akuze: { points: 0, details: [] },
        ultimaWinner: null, // Tko će dobiti zadnji punat
      }),
    },
    createdAt: new Date(),
  };

  gameRooms.set(roomId, gameRoom);

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
function createGameRoom2v2(players, gameType = "briskula") {
  const roomId = uuidv4();

  // Importiraj game logiku ovisno o gameType
  let gameState;
  if (gameType === "treseta") {
    const { createGameState2v2 } = require("./gameLogicTreseta2v2");
    gameState = createGameState2v2();
  } else {
    const { createGameState2v2 } = require("./gameLogic2v2");
    gameState = createGameState2v2();
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
function processCardPlay1v1(roomId, playerId, card) {
  const room = gameRooms.get(roomId);
  if (!room) return;

  // Importiraj odgovarajuću logiku
  let gameLogic;
  if (room.gameType === "treseta") {
    gameLogic = require("./gameLogicTreseta");
  } else {
    gameLogic = require("./gameLogic");
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
  room.gameState.playedCards.push(card);

  // Ukloni kartu iz ruke igrača
  const playerNumber = room.players.find((p) => p.id === playerId).playerNumber;
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
    playedCards: room.gameState.playedCards,
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
      const player1PlayableCards = getPlayableCards(
        room.gameState.player1Hand,
        room.gameState.playedCards
      );
      const player2PlayableCards = getPlayableCards(
        room.gameState.player2Hand,
        room.gameState.playedCards
      );

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
function processCardPlay2v2(roomId, playerId, card) {
  const room = gameRooms.get(roomId);
  if (!room) return;

  // Import correct logic based on gameType
  let getNextPlayer2v2, isValidMove, getPlayableCards;
  if (room.gameType === "treseta") {
    ({
      getNextPlayer2v2,
      isValidMove,
      getPlayableCards,
    } = require("./gameLogicTreseta2v2"));
  } else {
    ({ getNextPlayer2v2 } = require("./gameLogic2v2"));
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
    playedCards: room.gameState.playedCards.map((pc) => pc.card),
  });

  if (room.gameState.playedCards.length === 4) {
    setTimeout(() => finishRound2v2(roomId), 2000);
  } else {
    room.gameState.currentPlayer = getNextPlayer2v2(
      room.gameState.currentPlayer
    );

    // Ažuriraj playableCards za Trešetu nakon odigrane karte
    if (room.gameType === "treseta") {
      const tresetaLogic = require("./gameLogicTreseta2v2");
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
function finishRound1v1(roomId) {
  const room = gameRooms.get(roomId);
  if (!room || room.gameState.playedCards.length !== 2) return;

  // Importiraj odgovarajuću logiku
  let gameLogic;
  if (room.gameType === "treseta") {
    gameLogic = require("./gameLogicTreseta");
  } else {
    gameLogic = require("./gameLogic");
  }

  const { determineRoundWinner, calculatePoints, checkGameEnd } = gameLogic;

  const [cardA, cardB] = room.gameState.playedCards;
  const firstPlayer = room.gameState.currentPlayer === 1 ? 2 : 1;
  // cardA je prva karta (igrao ju je firstPlayer), cardB je druga karta
  const card1 = cardA; // Karta koju je igrao firstPlayer
  const card2 = cardB; // Karta koju je igrao drugi igrač

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
    if (
      room.gameState.remainingDeck.length === 0 &&
      room.gameState.player1Hand.length === 0 &&
      room.gameState.player2Hand.length === 0
    ) {
      room.gameState.ultimaWinner = roundWinner; // Zadnja ruka
    }

    gameEnd = checkGameEnd(
      player1Points,
      player2Points,
      room.gameState.player1Akuze,
      room.gameState.player2Akuze,
      room.gameState.remainingDeck,
      room.gameState.player1Hand,
      room.gameState.player2Hand
    );
  } else {
    // Briskula logika
    player1Points = calculatePoints(room.gameState.player1Cards);
    player2Points = calculatePoints(room.gameState.player2Cards);
    gameEnd = checkGameEnd(
      player1Points,
      player2Points,
      room.gameState.remainingDeck,
      room.gameState.player1Hand,
      room.gameState.player2Hand
    );
  }

  // Ažuriraj stanje
  room.gameState.playedCards = [];
  room.gameState.currentPlayer = roundWinner;

  if (gameEnd.isGameOver) {
    room.gameState.gamePhase = "finished";
    room.gameState.winner = gameEnd.winner;
  }

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

    const player1PlayableCards = getPlayableCards(
      room.gameState.player1Hand,
      room.gameState.playedCards
    );
    const player2PlayableCards = getPlayableCards(
      room.gameState.player2Hand,
      room.gameState.playedCards
    );

    roundFinishedData.player1PlayableCards = player1PlayableCards;
    roundFinishedData.player2PlayableCards = player2PlayableCards;
  }

  io.to(roomId).emit("roundFinished", roundFinishedData);

  // Ako je igra završena, ukloni sobu nakon 30 sekundi
  if (gameEnd.isGameOver) {
    setTimeout(() => {
      gameRooms.delete(roomId);
      console.log(`Soba obrisana: ${roomId}`);
    }, 30000);
  }
}

/**
 * Završava rundu za 2v2 - ISPRAVLJENA LOGIKA
 */
function finishRound2v2(roomId) {
  const room = gameRooms.get(roomId);
  if (!room || room.gameState.playedCards.length !== 4) return;

  // Import correct logic based on gameType
  let determineRoundWinner2v2, getPlayerTeam, calculatePoints, checkGameEnd2v2;

  if (room.gameType === "treseta") {
    const tresetaLogic = require("./gameLogicTreseta2v2");
    // Za Trešetu proslijedi playedCards direktno
    determineRoundWinner2v2 = (playedCards, firstPlayer) => {
      return tresetaLogic.determineRoundWinner(playedCards, firstPlayer);
    };
    getPlayerTeam = tresetaLogic.getWinningTeam;
    calculatePoints = tresetaLogic.calculateTeamPoints;
    checkGameEnd2v2 = () => ({ isGameOver: false }); // Trešeta end game logic
  } else {
    ({
      determineRoundWinner2v2,
      getPlayerTeam,
      calculatePoints,
      checkGameEnd2v2,
    } = require("./gameLogic2v2"));
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

  console.log(
    `📊 Current score: Team 1: ${team1Points.points}, Team 2: ${team2Points.points}`
  );

  let gameEnd;
  if (room.gameType === "treseta") {
    // Provjeri kraj igre za Trešetu - cilj je 11 bodova
    const team1Score = team1Points.points;
    const team2Score = team2Points.points;
    const allCardsPlayed =
      room.gameState.remainingDeck.length === 0 &&
      allHands.every((hand) => hand.length === 0);

    if (allCardsPlayed) {
      if (team1Score > team2Score) {
        gameEnd = {
          isGameOver: true,
          winner: 1,
          reason: `Pobjeda ${team1Score} - ${team2Score}`,
        };
      } else if (team2Score > team1Score) {
        gameEnd = {
          isGameOver: true,
          winner: 2,
          reason: `Pobjeda ${team2Score} - ${team1Score}`,
        };
      } else {
        gameEnd = {
          isGameOver: true,
          winner: null,
          reason: `Neriješeno ${team1Score} - ${team2Score}`,
        };
      }
    } else if (team1Score >= 11) {
      gameEnd = {
        isGameOver: true,
        winner: 1,
        reason: `Pobjeda ${team1Score} - ${team2Score} (dosegnut cilj)`,
      };
    } else if (team2Score >= 11) {
      gameEnd = {
        isGameOver: true,
        winner: 2,
        reason: `Pobjeda ${team2Score} - ${team1Score} (dosegnut cilj)`,
      };
    } else {
      gameEnd = { isGameOver: false };
    }
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
    room.gameState.gamePhase = "finished";
    room.gameState.winner = gameEnd.winner;
    console.log(
      `🎮 Game Over! Winner: ${
        gameEnd.winner ? `Team ${gameEnd.winner}` : "Draw"
      } (${gameEnd.reason})`
    );
  }

  const roundFinishedData = {
    roundWinner: roundWinner,
    roundWinningTeam: winningTeam,
    team1Points: team1Points,
    team2Points: team2Points,
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
  };

  // Add playableCards for Trešeta
  if (room.gameType === "treseta") {
    const tresetaLogic = require("./gameLogicTreseta2v2");

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

  if (gameEnd.isGameOver) {
    setTimeout(() => {
      gameRooms.delete(roomId);
      console.log(`2v2 Soba obrisana: ${roomId}`);
    }, 30000);
  }
}

/**
 * Rukuje disconnection igrača
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

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`🎮 Briskula server (1v1 + 2v2) pokrenut na portu ${PORT}`);
  console.log(`📊 Status endpoint: http://localhost:${PORT}/api/status`);
});
