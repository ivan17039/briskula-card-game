"use client";

import { useState, useEffect } from "react";
import Card from "./Card";
import { useSocket } from "./SocketContext";
import "./Game.css";

function calculatePoints(cards) {
  return cards.reduce((total, card) => total + (card.points || 0), 0);
}

function Game({ gameData, onGameEnd }) {
  const { socket, user, playCard, leaveRoom } = useSocket();

  const initializeGameState = () => {
    if (!gameData) return null;

    const myHand =
      gameData.playerNumber === 1
        ? gameData.gameState.player1Hand
        : gameData.gameState.player2Hand;

    const opponentHandCount =
      gameData.playerNumber === 1
        ? gameData.gameState.player2Hand.length
        : gameData.gameState.player1Hand.length;

    return {
      roomId: gameData.roomId,
      playerNumber: gameData.playerNumber,
      opponent: gameData.opponent,
      myHand: myHand,
      opponentHandCount: opponentHandCount,
      myCards: [],
      opponentCards: [],
      trump: gameData.gameState.trump,
      currentPlayer: gameData.gameState.currentPlayer,
      playedCards: [],
      gamePhase: "playing",
      winner: null,
      message:
        gameData.gameState.currentPlayer === gameData.playerNumber
          ? "Vaš red! Odaberite kartu za igranje."
          : "Protivnikov red. Čekajte...",
      remainingCardsCount: gameData.gameState.remainingDeck.length,
    };
  };

  const [gameState, setGameState] = useState(initializeGameState);
  const [selectedCard, setSelectedCard] = useState(null);
  const [showScores, setShowScores] = useState(false);
  // Determine if we're on mobile
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Socket event listeners (keeping the same logic as original)
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
        opponentHandCount:
          data.playerNumber !== prev.playerNumber
            ? prev.opponentHandCount - 1
            : prev.opponentHandCount,
        message:
          data.playerNumber === prev.playerNumber
            ? "Čekamo protivnikov potez..."
            : "Vaš red je! Odgovorite na kartu.",
      }));
    });

    socket.on("turnChange", (data) => {
      setGameState((prev) => ({
        ...prev,
        currentPlayer: data.currentPlayer,
        message:
          data.currentPlayer === prev.playerNumber
            ? "Vaš red! Odaberite kartu."
            : "Protivnikov red. Čekajte...",
      }));
    });

    socket.on("roundFinished", (data) => {
      setGameState((prev) => {
        const newState = {
          ...prev,
          myHand: prev.playerNumber === 1 ? data.player1Hand : data.player2Hand,
          opponentHandCount:
            prev.playerNumber === 1
              ? data.player2Hand.length
              : data.player1Hand.length,
          trump: data.trump,
          myCards:
            prev.playerNumber === data.roundWinner
              ? [...prev.myCards, ...prev.playedCards]
              : prev.myCards,
          opponentCards:
            prev.playerNumber === data.roundWinner
              ? prev.opponentCards
              : [...prev.opponentCards, ...prev.playedCards],
          playedCards: [],
          currentPlayer: data.currentPlayer,
          remainingCardsCount: data.remainingCards,
          gamePhase: data.gameEnd.isGameOver ? "finished" : "playing",
          winner: data.gameEnd.winner,
        };

        if (data.gameEnd.isGameOver) {
          if (data.gameEnd.winner === prev.playerNumber) {
            newState.message = `🎉 Pobijedili ste! (${data.gameEnd.reason})`;
          } else if (data.gameEnd.winner === null) {
            newState.message = `🤝 Neriješeno! (${data.gameEnd.reason})`;
          } else {
            newState.message = `😔 Izgubili ste. (${data.gameEnd.reason})`;
          }
        } else {
          newState.message =
            data.roundWinner === prev.playerNumber
              ? "Uzeli ste rundu! Vaš red."
              : "Protivnik je uzeo rundu. Njihov red.";
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

    socket.on("playerLeft", (data) => {
      setGameState((prev) => ({
        ...prev,
        gamePhase: "finished",
        message: `${data.message} Vraćamo vas na početak...`,
      }));
      setTimeout(() => onGameEnd(), 3000);
    });

    return () => {
      socket.off("cardPlayed");
      socket.off("turnChange");
      socket.off("roundFinished");
      socket.off("playerDisconnected");
      socket.off("playerLeft");
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

  const myPoints = calculatePoints(gameState.myCards);
  const opponentPoints = calculatePoints(gameState.opponentCards);

  // Determine card sizes based on screen size
  const cardSize = isMobile ? "small" : "medium";
  const playedCardSize = "small"; // Always small for played cards
  const trumpCardSize = isMobile ? "small" : "medium";

  return (
    <div className="game-wrapper">
      {/* Header */}
      <div className="game-header">
        <h1 className="game-title">
          <img
            src="/cards_img/dinarICON.png"
            alt="Dinari"
            className="title-suit-icon"
          />{" "}
          Briskula Online
        </h1>

        {/* Simple player names with colors - desktop only */}
        <div className="players-names">
          <span
            className={`player-name-simple ${
              gameState.currentPlayer === gameState.playerNumber ? "active" : ""
            }`}
          >
            {user?.name}
          </span>
          <span className="vs-simple">vs</span>
          <span
            className={`opponent-name-simple ${
              gameState.currentPlayer !== gameState.playerNumber ? "active" : ""
            }`}
          >
            {gameState.opponent?.name}
          </span>
        </div>

        {/* Desktop controls */}
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

        {/* Mobile floating buttons in header */}
        <div className="mobile-header-buttons">
          <button
            onClick={() => setShowScores(!showScores)}
            className="floating-btn details-btn"
            title="Detalji"
          >
            🔍
          </button>

          {gameState.gamePhase === "playing" && (
            <button
              onClick={() => {
                leaveRoom(gameState.roomId);
                onGameEnd();
              }}
              className="floating-btn exit-btn"
              title="Napusti"
            >
              🚪
            </button>
          )}

          {gameState.gamePhase === "finished" && (
            <button
              onClick={onGameEnd}
              className="floating-btn exit-btn"
              title="Povratak"
            >
              ↩️
            </button>
          )}
        </div>
      </div>

      {/* Main game area with responsive scaling */}
      <div className="game-area game-area-responsive">
        {/* Opponent hand */}
        <div className="opponent-section">
          <div className="opponent-label">{gameState.opponent?.name}</div>
          <div className="opponent-cards">
            {Array.from({ length: gameState.opponentHandCount }, (_, index) => (
              <Card
                key={`opponent-${index}`}
                card={{}}
                isHidden={true}
                size={cardSize}
              />
            ))}
          </div>
        </div>

        {/* Center play area */}
        <div className="play-area">
          <div className="played-cards-section">
            <div className="played-cards-label">Odigrane karte</div>
            <div className="played-cards-area">
              {gameState.playedCards.map((card, index) => (
                <Card
                  key={`played-${card.id}`}
                  card={card}
                  size={playedCardSize}
                />
              ))}
            </div>
          </div>

          <div className="deck-trump-section">
            <div className="deck-label">
              Špil ({gameState.remainingCardsCount})
            </div>
            <div className="deck-trump-stack">
              {/* Trump card - positioned under deck */}
              {gameState.trump && (
                <div className="trump-card">
                  <Card card={gameState.trump} size={trumpCardSize} />
                </div>
              )}

              {/* Deck card - on top */}
              <div className="deck-card">
                <Card card={{}} isHidden={true} size={trumpCardSize} />
              </div>
            </div>
          </div>
        </div>

        {/* Player hand */}
        <div className="player-section">
          {/* Status message */}
          <div className="game-status">{gameState.message}</div>
          <div className="player-label">
            {user?.name}
            {gameState.currentPlayer === gameState.playerNumber && (
              <span className="turn-indicator"> (Vaš red)</span>
            )}
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
              <h2>Detaljni rezultati</h2>
            </div>

            <div className="scores-grid">
              <div className="player-stats">
                <h3>{user?.name}</h3>
                <div className="stat-item">
                  <span>Bodovi:</span>
                  <span>{myPoints}</span>
                </div>
                <div className="stat-item">
                  <span>Karte u ruci:</span>
                  <span>{gameState.myHand.length}</span>
                </div>
                <div className="stat-item">
                  <span>Osvojene karte:</span>
                  <span>{gameState.myCards.length}</span>
                </div>
              </div>

              <div className="trump-info">
                <h3>Adut</h3>
                {gameState.trump && (
                  <Card card={gameState.trump} size="small" />
                )}
                <p>Preostalo: {gameState.remainingCardsCount}</p>
              </div>

              <div className="player-stats">
                <h3>{gameState.opponent?.name}</h3>
                <div className="stat-item">
                  <span>Bodovi:</span>
                  <span>{opponentPoints}</span>
                </div>
                <div className="stat-item">
                  <span>Karte u ruci:</span>
                  <span>{gameState.opponentHandCount}</span>
                </div>
                <div className="stat-item">
                  <span>Osvojene karte:</span>
                  <span>{gameState.opponentCards.length}</span>
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

export default Game;
