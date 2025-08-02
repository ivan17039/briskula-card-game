// server.js - Glavni Socket.io server za Briskulu (1v1 + 2v2)

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);

// CORS konfiguracija
app.use(
  cors({
    origin: "http://localhost:5173", // Vite dev server
    credentials: true,
  })
);

const io = socketIo(server, {
  cors: {
    origin: "http://localhost:5173",
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

  // Traženje protivnika (matchmaking) - UPDATED za 1v1 i 2v2
  socket.on("findMatch", (data) => {
    const user = connectedUsers.get(socket.id);
    if (!user) {
      socket.emit("error", { message: "Morate se prvo registrirati" });
      return;
    }

    const gameMode = data?.gameMode || "1v1";
    const queue = gameMode === "1v1" ? waitingQueue1v1 : waitingQueue2v2;
    const playersNeeded = gameMode === "1v1" ? 2 : 4;

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
    queue.push(user);

    // Ako ima dovoljno korisnika u queue, napravi match
    if (queue.length >= playersNeeded) {
      const players = [];
      for (let i = 0; i < playersNeeded; i++) {
        players.push(queue.shift());
      }

      if (gameMode === "1v1") {
        createGameRoom1v1(players[0], players[1]);
      } else {
        createGameRoom2v2(players);
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

    // Obavijesti ostale igrače
    io.to(roomId).emit("playerLeft", {
      playerNumber: leavingPlayer.playerNumber,
      message: `${leavingPlayer.name} je napustio sobu.`,
    });

    // Obriši sobu odmah
    gameRooms.delete(roomId);
    socket.leave(roomId);
    console.log(`Soba ${roomId} obrisana jer je igrač napustio.`);
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
function createGameRoom1v1(player1, player2) {
  const roomId = uuidv4();

  // Importiraj 1v1 game logiku
  const { createDeck, shuffleDeck, dealCards } = require("./gameLogic");

  const deck = createDeck();
  const shuffledDeck = shuffleDeck(deck);
  const dealt = dealCards(shuffledDeck);

  const gameRoom = {
    id: roomId,
    gameMode: "1v1", // DODANO
    players: [
      { ...player1, playerNumber: 1 },
      { ...player2, playerNumber: 2 },
    ],
    gameState: {
      player1Hand: dealt.player1Hand,
      player2Hand: dealt.player2Hand,
      player1Cards: [],
      player2Cards: [],
      trump: dealt.trump,
      remainingDeck: dealt.remainingDeck,
      currentPlayer: 1,
      playedCards: [],
      gamePhase: "playing",
      winner: null,
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
    player1Socket.emit("gameStart", {
      roomId: roomId,
      playerNumber: 1,
      opponent: { name: player2.name },
      gameState: {
        ...gameRoom.gameState,
        player2Hand: gameRoom.gameState.player2Hand.map(() => ({
          hidden: true,
        })), // Sakrij karte protivnika
      },
    });

    player2Socket.emit("gameStart", {
      roomId: roomId,
      playerNumber: 2,
      opponent: { name: player1.name },
      gameState: {
        ...gameRoom.gameState,
        player1Hand: gameRoom.gameState.player1Hand.map(() => ({
          hidden: true,
        })), // Sakrij karte protivnika
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
function createGameRoom2v2(players) {
  const roomId = uuidv4();

  // Importiraj 2v2 game logiku
  const { createGameState2v2 } = require("./gameLogic2v2");
  const gameState = createGameState2v2();

  // ISPRAVKA: Assign teams correctly: 1&3 = team 1, 2&4 = team 2
  const gameRoom = {
    id: roomId,
    gameMode: "2v2",
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
 * Obrađuje igranje karte za 1v1 - POSTOJEĆA LOGIKA
 */
function processCardPlay1v1(roomId, playerId, card) {
  const room = gameRooms.get(roomId);
  if (!room) return;

  const {
    determineRoundWinner,
    calculatePoints,
    checkGameEnd,
  } = require("./gameLogic");

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

  const { getNextPlayer2v2 } = require("./gameLogic2v2");

  room.gameState.playedCards.push({
    card: card,
    playerNumber: room.players.find((p) => p.id === playerId).playerNumber,
  });

  const playerNumber = room.players.find((p) => p.id === playerId).playerNumber;
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
 * Završava rundu za 1v1 - POSTOJEĆA LOGIKA
 */
function finishRound1v1(roomId) {
  const room = gameRooms.get(roomId);
  if (!room || room.gameState.playedCards.length !== 2) return;

  const {
    determineRoundWinner,
    calculatePoints,
    checkGameEnd,
  } = require("./gameLogic");

  const [cardA, cardB] = room.gameState.playedCards;
  const firstPlayer = room.gameState.currentPlayer === 1 ? 2 : 1;
  // Ensure card1 is always the card played by firstPlayer
  const card1 = firstPlayer === 1 ? cardA : cardB;
  const card2 = firstPlayer === 1 ? cardB : cardA;

  console.log("🎯 Pozivam determineRoundWinner s:", {
    card1: `${card1.name} ${card1.suit}`,
    card2: `${card2.name} ${card2.suit}`,
    firstPlayer: firstPlayer,
    explanation: `Igrač ${firstPlayer} je igrao prvi (${card1.name} ${card1.suit})`,
  });

  const roundWinner = determineRoundWinner(
    card1,
    card2,
    room.gameState.trump,
    firstPlayer
  );

  // Dodijeli karte pobjedniku
  if (roundWinner === 1) {
    room.gameState.player1Cards.push(...room.gameState.playedCards);
  } else {
    room.gameState.player2Cards.push(...room.gameState.playedCards);
  }

  // Uzmi nove karte iz špila
  if (room.gameState.remainingDeck.length >= 2) {
    // Normalno uzimanje - pobjednik uzima prvu, drugi uzima drugu
    if (roundWinner === 1) {
      room.gameState.player1Hand.push(room.gameState.remainingDeck[0]);
      room.gameState.player2Hand.push(room.gameState.remainingDeck[1]);
    } else {
      room.gameState.player2Hand.push(room.gameState.remainingDeck[0]);
      room.gameState.player1Hand.push(room.gameState.remainingDeck[1]);
    }
    room.gameState.remainingDeck = room.gameState.remainingDeck.slice(2);
  } else if (room.gameState.remainingDeck.length === 1) {
    // Zadnja karta u špilu - pobjednik uzima tu kartu, drugi uzima trump
    if (roundWinner === 1) {
      room.gameState.player1Hand.push(room.gameState.remainingDeck[0]);
      room.gameState.player2Hand.push(room.gameState.trump);
    } else {
      room.gameState.player2Hand.push(room.gameState.remainingDeck[0]);
      room.gameState.player1Hand.push(room.gameState.trump);
    }
    room.gameState.remainingDeck = [];
    // Trump se više ne prikazuje jer je uzet
    room.gameState.trump = null;
  }

  // Provjeri završetak igre
  const player1Points = calculatePoints(room.gameState.player1Cards);
  const player2Points = calculatePoints(room.gameState.player2Cards);
  const gameEnd = checkGameEnd(
    player1Points,
    player2Points,
    room.gameState.remainingDeck,
    room.gameState.player1Hand,
    room.gameState.player2Hand
  );

  // Ažuriraj stanje
  room.gameState.playedCards = [];
  room.gameState.currentPlayer = roundWinner;

  if (gameEnd.isGameOver) {
    room.gameState.gamePhase = "finished";
    room.gameState.winner = gameEnd.winner;
  }

  // Pošalji ažuriranje
  io.to(roomId).emit("roundFinished", {
    roundWinner: roundWinner,
    player1Points: player1Points,
    player2Points: player2Points,
    gameEnd: gameEnd,
    currentPlayer: room.gameState.currentPlayer,
    remainingCards: room.gameState.remainingDeck.length,
    player1Hand: room.gameState.player1Hand,
    player2Hand: room.gameState.player2Hand,
    trump: room.gameState.trump, // Može biti null ako je uzeta
  });

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

  const {
    determineRoundWinner2v2,
    getPlayerTeam,
    calculatePoints,
    checkGameEnd2v2,
  } = require("./gameLogic2v2");

  // Find who played first in this round
  const firstPlayerInRound =
    room.gameState.currentPlayer === 1 ? 4 : room.gameState.currentPlayer - 1;

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
    room.gameState.trump
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

  const team1Points = calculatePoints(room.gameState.team1Cards);
  const team2Points = calculatePoints(room.gameState.team2Cards);

  console.log(
    `📊 Current score: Team 1: ${team1Points}, Team 2: ${team2Points}`
  );

  const allHands = [
    room.gameState.player1Hand,
    room.gameState.player2Hand,
    room.gameState.player3Hand,
    room.gameState.player4Hand,
  ];

  const gameEnd = checkGameEnd2v2(
    team1Points,
    team2Points,
    room.gameState.remainingDeck,
    allHands
  );

  room.gameState.playedCards = [];
  room.gameState.currentPlayer = roundWinner;
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

  io.to(roomId).emit("roundFinished", {
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
  });

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
      // Obavijesti ostale igrače
      io.to(roomId).emit("playerDisconnected", {
        disconnectedPlayer: disconnectedPlayer.playerNumber,
        message: `${disconnectedPlayer.name} se odspojio`,
      });

      // Za sada samo obriši sobu, kasnije možemo dodati reconnect logiku
      setTimeout(() => {
        gameRooms.delete(roomId);
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
