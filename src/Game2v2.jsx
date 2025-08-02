"use client";

import { useState, useEffect } from "react";
import Card from "./Card";
import { useSocket } from "./SocketContext";
import "./Game.css";
import "./Card.css";
import "./Game2v2.css";

function calculatePoints(cards) {
  return cards.reduce((total, card) => total + (card.points || 0), 0);
}

function Game2v2({ gameData, onGameEnd }) {
  const { socket, user, playCard, leaveRoom } = useSocket();

  const initializeGameState = () => {
    if (!gameData) return null;

    const myPlayerNumber = gameData.playerNumber;
    const myHand = gameData.gameState[`player${myPlayerNumber}Hand`] || [];

    // Ensure all hands exist and have proper fallbacks
    const player1Hand = gameData.gameState.player1Hand || [];
    const player2Hand = gameData.gameState.player2Hand || [];
    const player3Hand = gameData.gameState.player3Hand || [];
    const player4Hand = gameData.gameState.player4Hand || [];

    return {
      roomId: gameData.roomId,
      playerNumber: myPlayerNumber,
      myTeam: gameData.myTeam,
      players: gameData.players,
      myHand: myHand,
      playedCards: [],
      trump: gameData.gameState.trump,
      currentPlayer: gameData.gameState.currentPlayer,
      gamePhase: "playing",
      winner: null,
      message:
        gameData.gameState.currentPlayer === myPlayerNumber
          ? "Vaš red! Odaberite kartu za igranje."
          : "Čekajte svoj red...",
      remainingCardsCount: gameData.gameState.remainingDeck?.length || 0,
      team1Cards: [],
      team2Cards: [],
      handCounts: {
        player1: player1Hand.length,
        player2: player2Hand.length,
        player3: player3Hand.length,
        player4: player4Hand.length,
      },
    };
  };

  const [gameState, setGameState] = useState(initializeGameState);
  const [selectedCard, setSelectedCard] = useState(null);
  const [showScores, setShowScores] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (!socket || !gameState?.roomId) return;

    socket.on("cardPlayed", (data) => {
      setGameState((prev) => ({
        ...prev,
        playedCards: data.playedCards,
        myHand:
          data.playerNumber === prev.playerNumber
            ? prev.myHand.filter((c) => c.id !== data.card.id)
            : prev.myHand,
        handCounts: {
          ...prev.handCounts,
          [`player${data.playerNumber}`]: Math.max(
            0,
            prev.handCounts[`player${data.playerNumber}`] - 1
          ),
        },
        message:
          data.playerNumber === prev.playerNumber
            ? "Čekamo ostale igrače..."
            : `${data.playerName} je odigrao kartu.`,
      }));
    });

    socket.on("turnChange", (data) => {
      setGameState((prev) => ({
        ...prev,
        currentPlayer: data.currentPlayer,
        message:
          data.currentPlayer === prev.playerNumber
            ? "Vaš red! Odaberite kartu."
            : `Red igrača ${data.currentPlayerName}.`,
      }));
    });

    socket.on("roundFinished", (data) => {
      setGameState((prev) => {
        const newState = {
          ...prev,
          myHand: data[`player${prev.playerNumber}Hand`],
          trump: data.trump,
          team1Cards: data.team1Cards,
          team2Cards: data.team2Cards,
          playedCards: [],
          currentPlayer: data.currentPlayer,
          remainingCardsCount: data.remainingCards,
          gamePhase: data.gameEnd.isGameOver ? "finished" : "playing",
          winner: data.gameEnd.winner,
          handCounts: {
            player1: data.player1Hand?.length || prev.handCounts.player1 || 0,
            player2: data.player2Hand?.length || prev.handCounts.player2 || 0,
            player3: data.player3Hand?.length || prev.handCounts.player3 || 0,
            player4: data.player4Hand?.length || prev.handCounts.player4 || 0,
          },
        };

        if (data.gameEnd.isGameOver) {
          if (data.gameEnd.winner === prev.myTeam) {
            newState.message = `🎉 Vaš tim je pobijedio! (${data.gameEnd.reason})`;
          } else if (data.gameEnd.winner === null) {
            newState.message = `🤝 Neriješeno! (${data.gameEnd.reason})`;
          } else {
            newState.message = `😔 Vaš tim je izgubio. (${data.gameEnd.reason})`;
          }
        } else {
          const winningTeam = data.roundWinningTeam;
          newState.message =
            winningTeam === prev.myTeam
              ? "Vaš tim je uzeo rundu!"
              : "Protivnički tim je uzeo rundu.";
        }

        return newState;
      });

      if (data.gameEnd.isGameOver) {
        setTimeout(() => onGameEnd(), 5000);
      }
    });

    socket.on("playerDisconnected", (data) => {
      setGameState((prev) => ({
        ...prev,
        gamePhase: "finished",
        message: `${data.message}. Vraćamo vas na početak...`,
      }));
      setTimeout(() => onGameEnd(), 3000);
    });

    return () => {
      socket.off("cardPlayed");
      socket.off("turnChange");
      socket.off("roundFinished");
      socket.off("playerDisconnected");
    };
  }, [socket, gameState?.roomId, onGameEnd]);

  const handleCardClick = (card) => {
    if (!gameState) return;

    if (
      gameState.gamePhase !== "playing" ||
      gameState.currentPlayer !== gameState.playerNumber
    ) {
      return;
    }

    if (selectedCard && selectedCard.id === card.id) {
      playCard(gameState.roomId, card);
      setSelectedCard(null);
    } else {
      setSelectedCard(card);
    }
  };

  if (!gameState) {
    return (
      <div className="game-wrapper">
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
            color: "white",
            fontSize: "1.2rem",
          }}
        >
          Učitavanje igre...
        </div>
      </div>
    );
  }

  const team1Points = calculatePoints(gameState.team1Cards);
  const team2Points = calculatePoints(gameState.team2Cards);
  const cardSize = isMobile ? "small" : "medium";

  // Get player positions for 2v2 layout
  const getPlayerByPosition = (position) => {
    const positions = {
      bottom: gameState.playerNumber,
      top:
        gameState.playerNumber === 1
          ? 3
          : gameState.playerNumber === 2
          ? 4
          : gameState.playerNumber === 3
          ? 1
          : 2,
      left:
        gameState.playerNumber === 1
          ? 4
          : gameState.playerNumber === 2
          ? 1
          : gameState.playerNumber === 3
          ? 2
          : 3,
      right:
        gameState.playerNumber === 1
          ? 2
          : gameState.playerNumber === 2
          ? 3
          : gameState.playerNumber === 3
          ? 4
          : 1,
    };
    return positions[position];
  };

  const getPlayerName = (playerNumber) => {
    return (
      gameState.players.find((p) => p.playerNumber === playerNumber)?.name ||
      `Igrač ${playerNumber}`
    );
  };

  const getPlayerTeam = (playerNumber) => {
    return (
      gameState.players.find((p) => p.playerNumber === playerNumber)?.team || 1
    );
  };

  // Function to determine team color
  const getTeamColor = (playerNumber) => {
    const team = getPlayerTeam(playerNumber);
    return team === gameState.myTeam ? "teammate" : "opponent";
  };

  return (
    <div className="game-wrapper game-2v2">
      {/* Header */}
      <div className="game-header">
        <h1 className="game-title">
          <img
            src="/cards_img/dinarICON.png"
            alt="Dinari"
            className="title-suit-icon"
          />
          Briskula 2v2
        </h1>

        {/* Team scores */}
        <div className="team-scores">
          <div
            className={`team-score ${gameState.myTeam === 1 ? "my-team" : ""}`}
          >
            <span className="team-label">Tim 1</span>
            <span className="team-points">{team1Points}</span>
          </div>
          <div className="vs-divider">vs</div>
          <div
            className={`team-score ${gameState.myTeam === 2 ? "my-team" : ""}`}
          >
            <span className="team-label">Tim 2</span>
            <span className="team-points">{team2Points}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="desktop-controls">
          <button
            onClick={() => setShowScores(!showScores)}
            className="game-btn btn-primary"
          >
            {showScores ? "Sakrij" : "Detalji"}
          </button>

          {gameState.gamePhase === "playing" && (
            <button
              onClick={() => {
                leaveRoom(gameState.roomId);
                onGameEnd();
              }}
              className="game-btn btn-danger"
            >
              Napusti
            </button>
          )}

          {gameState.gamePhase === "finished" && (
            <button onClick={onGameEnd} className="game-btn btn-secondary">
              Povratak
            </button>
          )}
        </div>
      </div>

      {/* Game area with 2v2 layout */}
      <div className="game-area-2v2">
        {/* Top player */}
        <div className="player-position top-player">
          <div
            className={`player-info ${getTeamColor(
              getPlayerByPosition("top")
            )}`}
          >
            <div className="player-name">
              {getPlayerName(getPlayerByPosition("top"))}
              {gameState.currentPlayer === getPlayerByPosition("top") && (
                <span className="turn-indicator"> (Red)</span>
              )}
            </div>
            <div className="player-cards-count">
              {gameState.handCounts[`player${getPlayerByPosition("top")}`]}{" "}
              karata
            </div>
          </div>
          <div className="opponent-cards">
            {Array.from(
              {
                length:
                  gameState.handCounts[`player${getPlayerByPosition("top")}`],
              },
              (_, index) => (
                <Card
                  key={`top-${index}`}
                  card={{}}
                  isHidden={true}
                  size={cardSize}
                />
              )
            )}
          </div>
        </div>

        {/* Middle section with left player, play area, deck-trump, and right player */}
        <div className="middle-section">
          {/* Left player */}
          <div className="player-position left-player">
            <div
              className={`player-info ${getTeamColor(
                getPlayerByPosition("left")
              )}`}
            >
              <div className="player-name">
                {getPlayerName(getPlayerByPosition("left"))}
                {gameState.currentPlayer === getPlayerByPosition("left") && (
                  <span className="turn-indicator"> (Red)</span>
                )}
              </div>
              <div className="player-cards-count">
                {gameState.handCounts[`player${getPlayerByPosition("left")}`]}{" "}
                karata
              </div>
            </div>
            <div className="opponent-cards vertical">
              {Array.from(
                {
                  length:
                    gameState.handCounts[
                      `player${getPlayerByPosition("left")}`
                    ],
                },
                (_, index) => (
                  <Card
                    key={`left-${index}`}
                    card={{}}
                    isHidden={true}
                    size={cardSize}
                  />
                )
              )}
            </div>
          </div>

          {/* Center play area */}
          <div className="center-area">
            <div className="played-cards-section">
              <div className="played-cards-label">Odigrane karte</div>
              <div className="played-cards-area-2v2">
                {gameState.playedCards.map((card, index) => (
                  <Card key={`played-${card.id}`} card={card} size="small" />
                ))}
              </div>
            </div>
          </div>

          {/* Deck and Trump section */}
          <div className="deck-trump-section">
            <div className="deck-label">
              Špil ({gameState.remainingCardsCount})
            </div>
            <div className="deck-trump-stack">
              {gameState.trump && (
                <div className="trump-card">
                  <Card card={gameState.trump} size={cardSize} />
                </div>
              )}
              <div className="deck-card">
                <Card card={{}} isHidden={true} size={cardSize} />
              </div>
            </div>
          </div>

          {/* Right player */}
          <div className="player-position right-player">
            <div
              className={`player-info ${getTeamColor(
                getPlayerByPosition("right")
              )}`}
            >
              <div className="player-name">
                {getPlayerName(getPlayerByPosition("right"))}
                {gameState.currentPlayer === getPlayerByPosition("right") && (
                  <span className="turn-indicator"> (Red)</span>
                )}
              </div>
              <div className="player-cards-count">
                {gameState.handCounts[`player${getPlayerByPosition("right")}`]}{" "}
                karata
              </div>
            </div>
            <div className="opponent-cards vertical">
              {Array.from(
                {
                  length:
                    gameState.handCounts[
                      `player${getPlayerByPosition("right")}`
                    ],
                },
                (_, index) => (
                  <Card
                    key={`right-${index}`}
                    card={{}}
                    isHidden={true}
                    size={cardSize}
                  />
                )
              )}
            </div>
          </div>
        </div>

        {/* Bottom player (current user) */}
        <div className="player-position bottom-player">
          <div className="game-status">{gameState.message}</div>
          <div className="player-info my-player">
            <div className="player-name">
              {user?.name}
              {gameState.currentPlayer === gameState.playerNumber && (
                <span className="turn-indicator"> (Vaš red)</span>
              )}
            </div>
          </div>
          <div className="player-cards">
            {gameState.myHand.map((card) => (
              <Card
                key={card.id}
                card={card}
                isPlayable={
                  gameState.gamePhase === "playing" &&
                  gameState.currentPlayer === gameState.playerNumber
                }
                isSelected={selectedCard && selectedCard.id === card.id}
                onClick={handleCardClick}
                size={cardSize}
              />
            ))}
          </div>

          {selectedCard && (
            <div className="selection-info">
              Odabrana: {selectedCard.name} {selectedCard.suit} (
              {selectedCard.points} bodova)
              <br />
              <small>Kliknite ponovno za igranje</small>
            </div>
          )}
        </div>
      </div>

      {/* Scores overlay */}
      {showScores && (
        <div className="scores-overlay" onClick={() => setShowScores(false)}>
          <div className="scores-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scores-header">
              <h2>Detaljni rezultati - 2v2</h2>
            </div>

            <div className="teams-scores-grid">
              <div className="team-stats">
                <h3>Tim 1 {gameState.myTeam === 1 && "(Vaš tim)"}</h3>
                <div className="stat-item">
                  <span>Bodovi:</span>
                  <span>{team1Points}</span>
                </div>
                <div className="team-players">
                  {gameState.players
                    .filter((p) => p.team === 1)
                    .map((player) => (
                      <div key={player.playerNumber} className="player-stat">
                        <span>{player.name}:</span>
                        <span>
                          {gameState.handCounts[`player${player.playerNumber}`]}{" "}
                          karata
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              <div className="trump-info">
                <h3>Adut</h3>
                {gameState.trump && (
                  <Card card={gameState.trump} size="small" />
                )}
                <p>Preostalo: {gameState.remainingCardsCount}</p>
              </div>

              <div className="team-stats">
                <h3>Tim 2 {gameState.myTeam === 2 && "(Vaš tim)"}</h3>
                <div className="stat-item">
                  <span>Bodovi:</span>
                  <span>{team2Points}</span>
                </div>
                <div className="team-players">
                  {gameState.players
                    .filter((p) => p.team === 2)
                    .map((player) => (
                      <div key={player.playerNumber} className="player-stat">
                        <span>{player.name}:</span>
                        <span>
                          {gameState.handCounts[`player${player.playerNumber}`]}{" "}
                          karata
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <button
              className="close-scores"
              onClick={() => setShowScores(false)}
            >
              Zatvori
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Game2v2;
