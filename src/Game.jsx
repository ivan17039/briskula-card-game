"use client";

import { useState, useEffect } from "react";
import Card from "./Card";
import { useSocket } from "./SocketContext";
import { useToast } from "./ToastProvider";
import "./Game.css";

function calculatePoints(cards) {
  return cards.reduce((total, card) => total + (card.points || 0), 0);
}

/**
 * Vraća pravilnu riječ za broj karata u hrvatskom jeziku
 * @param {number} count - Broj karata
 * @returns {string} - Pravilna riječ (karta/karte/karata)
 */
function getCardCountText(count) {
  if (count === 1) {
    return `${count} karta`;
  } else if (count >= 2 && count <= 4) {
    return `${count} karte`;
  } else {
    return `${count} karata`;
  }
}

/**
 * Sortira karte po boji i jačini
 * @param {Array} cards - Array karata za sortiranje
 * @param {string} gameType - Tip igre (briskula ili treseta)
 * @returns {Array} - Sortirane karte
 */
function sortCards(cards, gameType = "briskula") {
  if (!cards || cards.length === 0) return cards;

  // Definiranje redoslijeda boja (Kupe, Bati, Spadi, Dinari)
  const suitOrder = { Kupe: 1, Bati: 2, Spadi: 3, Dinari: 4 };

  // Definiranje jačine karata ovisno o tipu igre
  const getCardStrength = (card) => {
    if (gameType === "treseta") {
      // Trešeta: Trica > Duja > As > Kralj > Konj > Fanat > 7 > 6 > 5 > 4
      const tresetaStrength = {
        3: 10, // Trica - najjača
        2: 9, // Duja
        1: 8, // As
        13: 7, // Kralj
        12: 6, // Konj
        11: 5, // Fanat
        7: 4, // 7
        6: 3, // 6
        5: 2, // 5
        4: 1, // 4 - najslabija
      };
      return tresetaStrength[card.value] || 0;
    } else {
      // Briskula: As > Trica > Kralj > Konj > Fanat > 7 > 6 > 5 > 4 > Duja
      const briskulaStrength = {
        1: 10, // As - najjači
        3: 9, // Trica
        13: 8, // Kralj
        12: 7, // Konj
        11: 6, // Fanat
        7: 5, // 7
        6: 4, // 6
        5: 3, // 5
        4: 2, // 4
        2: 1, // Duja - najslabija
      };
      return briskulaStrength[card.value] || 0;
    }
  };

  return [...cards].sort((a, b) => {
    // Prvo sortiraj po boji
    const suitComparison = suitOrder[a.suit] - suitOrder[b.suit];
    if (suitComparison !== 0) {
      return suitComparison;
    }

    // Ako su iste boje, sortiraj po jačini (od najjače prema najslabijoj)
    return getCardStrength(b) - getCardStrength(a);
  });
}

function Game({ gameData, onGameEnd }) {
  const {
    socket,
    user,
    playCard,
    leaveRoom,
    leaveRoomPermanently,
    findMatch,
    rematch,
    saveGameState,
    clearGameState,
  } = useSocket();

  const { addToast } = useToast();

  const initializeGameState = () => {
    if (!gameData) return null;

    console.log("🚀 Initializing game state with gameData:", gameData);

    const myHand =
      gameData.playerNumber === 1
        ? gameData.gameState.player1Hand
        : gameData.gameState.player2Hand;

    const opponentHandCount =
      gameData.playerNumber === 1
        ? (gameData.gameState.player2Hand || []).length
        : (gameData.gameState.player1Hand || []).length;

    const state = {
      roomId: gameData.roomId,
      playerNumber: gameData.playerNumber,
      opponent: gameData.opponent,
      gameType: gameData.gameType, // Add gameType to state
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
      remainingCardsCount: (gameData.gameState.remainingDeck || []).length,
      playableCards: gameData.gameState.playableCards || [], // Lista ID-jeva karata koje se mogu igrati
      myPoints: 0, // Bodovi igrača
      opponentPoints: 0, // Bodovi protivnika
    };

    console.log("🎮 Final game state:", state);
    return state;
  };

  const [gameState, setGameState] = useState(initializeGameState);
  const [selectedCard, setSelectedCard] = useState(null);
  const [showScores, setShowScores] = useState(false);
  // Determine if we're on mobile
  const [isMobile, setIsMobile] = useState(false);
  // Animation state for picked up cards
  const [cardPickupAnimation, setCardPickupAnimation] = useState(null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Separate useEffect for saving game state to avoid infinite loops
  useEffect(() => {
    if (gameState?.gamePhase === "playing" && gameState?.roomId) {
      const timeoutId = setTimeout(() => {
        saveGameState({
          ...gameState,
          roomId: gameState.roomId,
          gameMode: gameData?.gameMode || "1v1",
          gameType: gameState.gameType,
          opponent: gameState.opponent,
          playerNumber: gameState.playerNumber,
          gameState: {
            ...gameState,
            playableCards: gameState.playableCards,
          },
        });
      }, 1000); // Debounce saving to prevent too frequent calls

      return () => clearTimeout(timeoutId);
    }
  }, [
    gameState?.gamePhase,
    gameState?.roomId,
    gameState?.currentPlayer,
    gameState?.playedCards?.length,
  ]);

  // Socket event listeners (keeping the same logic as original)
  useEffect(() => {
    if (!socket || !gameState?.roomId) return;

    // Listener za novu igru nakon revanša
    socket.on("gameStart", (newGameData) => {
      console.log("🎮 Nova igra počinje (revanš):", newGameData);
      // Reset game state s novim podacima
      const newState = initializeGameState();
      if (newState) {
        // Ažuriraj s novim game data
        setGameState({
          ...newState,
          roomId: newGameData.roomId,
          playerNumber: newGameData.playerNumber,
          opponent: newGameData.opponent,
          gameType: newGameData.gameType,
          myHand:
            newGameData.playerNumber === 1
              ? newGameData.gameState.player1Hand
              : newGameData.gameState.player2Hand,
          opponentHandCount:
            newGameData.playerNumber === 1
              ? (newGameData.gameState.player2Hand || []).length
              : (newGameData.gameState.player1Hand || []).length,
          trump: newGameData.gameState.trump,
          currentPlayer: newGameData.gameState.currentPlayer,
          remainingCardsCount: (newGameData.gameState.remainingDeck || [])
            .length,
          playableCards: newGameData.gameState.playableCards || [],
          gamePhase: "playing",
          message:
            newGameData.gameState.currentPlayer === newGameData.playerNumber
              ? "Vaš red! Odaberite kartu za igranje."
              : "Protivnikov red. Čekajte...",
        });
      }
    });

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
              ? (data.player2Hand || []).length
              : (data.player1Hand || []).length,
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
          // Ažuriraj playableCards za Trešetu
          playableCards:
            prev.gameType === "treseta"
              ? (prev.playerNumber === 1
                  ? data.player1PlayableCards
                  : data.player2PlayableCards) || []
              : prev.playableCards,
          // Ažuriraj bodove
          myPoints:
            prev.playerNumber === 1
              ? data.player1Points?.points || 0
              : data.player2Points?.points || 0,
          opponentPoints:
            prev.playerNumber === 1
              ? data.player2Points?.points || 0
              : data.player1Points?.points || 0,
        };

        if (data.gameEnd.isGameOver) {
          // Clear saved game state when game ends
          clearGameState();

          if (data.gameEnd.winner === prev.playerNumber) {
            newState.message = `🎉 Pobijedili ste!`;
          } else if (data.gameEnd.winner === null) {
            newState.message = `🤝 Neriješeno! (${data.gameEnd.reason})`;
          } else {
            newState.message = `😔 Izgubili ste.`;
          }
        } else {
          // Pokreni animaciju pokupljenih karata iz špila (samo za Trešetu)
          if (
            prev.gameType === "treseta" &&
            data.newCards &&
            (data.newCards.player1 || data.newCards.player2)
          ) {
            const myCard =
              prev.playerNumber === 1
                ? data.newCards.player1
                : data.newCards.player2;
            const opponentCard =
              prev.playerNumber === 1
                ? data.newCards.player2
                : data.newCards.player1;

            // Pokreni animaciju pokupljenih karata
            if (myCard || opponentCard) {
              setCardPickupAnimation({
                myCard: myCard,
                opponentCard: opponentCard,
                roundWinner: data.roundWinner,
                playerNumber: prev.playerNumber,
              });

              // Ukloni animaciju nakon 3 sekunde
              setTimeout(() => {
                setCardPickupAnimation(null);
              }, 2000);
            }
          }

          newState.message =
            data.roundWinner === prev.playerNumber
              ? `Uzeli ste rundu! Vaš red.`
              : `Protivnik je uzeo rundu. Njihov red.`;
        }

        return newState;
      });

      // Ne automatski preusmjeravaj na glavni ekran - neka igrač sam odluči
    });

    socket.on("playerDisconnected", (data) => {
      setGameState((prev) => ({
        ...prev,
        gamePhase: "finished",
        gameInterrupted: true, // Dodaj flag da je igra prekinuta
        message: `${data.message}. Kliknite 'Glavni meni' za povratak.`,
      }));
      // Ne automatski preusmjeravaj - neka igrač sam odluči
    });

    socket.on("playerLeft", (data) => {
      if (data.permanent) {
        // Permanent leave - room will be deleted, clear state and redirect
        clearGameState();
        addToast("Protivnik je trajno napustio igru. Vraćam vas na glavni meni.", "warning");
        setTimeout(() => {
          onGameEnd();
        }, 2000);
      } else {
        // Temporary leave - game can continue with reconnection
        setGameState((prev) => ({
          ...prev,
          gamePhase: "finished",
          gameInterrupted: true,
          message: `${data.message} Kliknite 'Glavni meni' za povratak.`,
        }));
      }
    });

    // Handle room deletion
    socket.on("roomDeleted", (data) => {
      clearGameState();
      addToast(data.message, "error");
      setTimeout(() => {
        onGameEnd();
      }, 2000);
    });

    // Handle reconnection failures
    socket.on("reconnectFailed", (data) => {
      clearGameState();
      let toastMessage = data.message;
      
      switch (data.reason) {
        case "permanentlyLeft":
          toastMessage = "Ne možete se vratiti u igru koju ste napustili.";
          break;
        case "roomDeleted":
          toastMessage = "Soba više ne postoji.";
          break;
        case "playerNotFound":
          toastMessage = "Niste dio ove igre.";
          break;
      }
      
      addToast(toastMessage, "error");
      setTimeout(() => {
        onGameEnd();
      }, 2000);
    });

    // Trešeta - ažuriranje igrljivih karata
    socket.on("playableCardsUpdate", (data) => {
      console.log("🎮 Playable cards update:", data.playableCards);
      setGameState((prev) => ({
        ...prev,
        playableCards: data.playableCards,
      }));
    });

    // Trešeta - nevaljan potez
    socket.on("invalidMove", (data) => {
      console.log("❌ Invalid move:", data.message);
      addToast(`Nevaljan potez: ${data.message}`, "error");
    });

    return () => {
      socket.off("gameStart");
      socket.off("cardPlayed");
      socket.off("turnChange");
      socket.off("roundFinished");
      socket.off("playerDisconnected");
      socket.off("playerLeft");
      socket.off("roomDeleted");
      socket.off("reconnectFailed");
      socket.off("playableCardsUpdate");
      socket.off("invalidMove");
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

    // Za Trešetu - provjeri je li karta igriva
    if (
      gameState.gameType === "treseta" &&
      !gameState.playableCards.includes(card.id)
    ) {
      alert("Ne možete odigrati ovu kartu. Molimo odaberite drugu kartu.");
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

  const myPoints = calculatePoints(gameState.myCards || []);
  const opponentPoints = calculatePoints(gameState.opponentCards || []);

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
          {gameState.gameType === "treseta" ? "Trešeta" : "Briskula"} Online
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
                clearGameState(); // Clear saved state on manual leave
                leaveRoomPermanently(gameState.roomId); // Use permanent leave
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
                clearGameState(); // Clear saved state on manual leave
                leaveRoomPermanently(gameState.roomId); // Use permanent leave
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
        {/* Opponent hand - avatar system */}
        <div className="opponent-section">
          <div className="opponent-avatar-display">
            <div className="player-avatar opponent">
              {gameState.opponent?.name?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div className="opponent-name">
              {gameState.opponent?.name}
              {gameState.currentPlayer === 2 && (
                <span className="turn-indicator"> (Na redu)</span>
              )}
            </div>
            <div className="opponent-cards-indicator">
              <span>{getCardCountText(gameState.opponentHandCount)}</span>
            </div>
            {gameState.gameType === "treseta" && (
              <div className="points-display">
                {/* ({gameState.opponentPoints} bodova) */}
              </div>
            )}
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

          <div
            className={`deck-trump-section ${
              gameState.gameType === "treseta" ? "treseta-deck" : ""
            }`}
          >
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
          {/* Combined player name and status */}
          <div className="player-status-combined">
            {user?.name} - {gameState.message}
            {gameState.gameType === "treseta" && (
              <span className="points-display">
                {/* ({gameState.myPoints} bodova) */}
              </span>
            )}
          </div>
          <div className="player-cards">
            {sortCards(gameState.myHand, gameState.gameType).map((card) => {
              const isPlayable =
                gameState.gamePhase === "playing" &&
                gameState.currentPlayer === gameState.playerNumber &&
                (gameState.gameType !== "treseta" ||
                  gameState.playableCards.includes(card.id));

              return (
                <Card
                  key={card.id}
                  card={card}
                  isPlayable={isPlayable}
                  isSelected={selectedCard && selectedCard.id === card.id}
                  onClick={handleCardClick}
                  size={cardSize}
                />
              );
            })}
          </div>
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
                  <span>
                    {gameState.gameType === "treseta"
                      ? gameState.myPoints
                      : myPoints}
                  </span>
                </div>
                <div className="stat-item">
                  <span>Karte u ruci:</span>
                  <span>{getCardCountText(gameState.myHand.length)}</span>
                </div>
                <div className="stat-item">
                  <span>Osvojene karte:</span>
                  <span>
                    {getCardCountText((gameState.myCards || []).length)}
                  </span>
                </div>
              </div>

              <div className="trump-info">
                {gameState.gameType === "treseta" ? (
                  <>
                    <h3>Špil</h3>
                    <p>Preostalo: {gameState.remainingCardsCount}</p>
                  </>
                ) : (
                  <>
                    <h3>Adut</h3>
                    {gameState.trump && (
                      <Card card={gameState.trump} size="small" />
                    )}
                    <p>Preostalo: {gameState.remainingCardsCount}</p>
                  </>
                )}
              </div>

              <div className="player-stats">
                <h3>{gameState.opponent?.name}</h3>
                <div className="stat-item">
                  <span>Bodovi:</span>
                  <span>
                    {gameState.gameType === "treseta"
                      ? gameState.opponentPoints
                      : opponentPoints}
                  </span>
                </div>
                <div className="stat-item">
                  <span>Karte u ruci:</span>
                  <span>{getCardCountText(gameState.opponentHandCount)}</span>
                </div>
                <div className="stat-item">
                  <span>Osvojene karte:</span>
                  <span>
                    {getCardCountText((gameState.opponentCards || []).length)}
                  </span>
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

      {/* Card pickup animation overlay */}
      {cardPickupAnimation && (
        <div className="card-pickup-overlay">
          <div className="card-pickup-animation">
            <div className="pickup-header">
              <h3>Pokupljene karte iz špila:</h3>
            </div>

            <div className="pickup-cards">
              {cardPickupAnimation.myCard && (
                <div className="pickup-player">
                  <div className="pickup-label">Vi:</div>
                  <Card card={cardPickupAnimation.myCard} size="medium" />
                </div>
              )}

              {cardPickupAnimation.opponentCard && (
                <div className="pickup-player">
                  <div className="pickup-label">Protivnik:</div>
                  <Card card={cardPickupAnimation.opponentCard} size="medium" />
                </div>
              )}
            </div>

            <div className="pickup-winner">
              {cardPickupAnimation.roundWinner ===
              cardPickupAnimation.playerNumber
                ? "🎉 Vi ste uzeli rundu!"
                : "😔 Protivnik je uzeo rundu"}
            </div>
          </div>
        </div>
      )}

      {/* Final Score Screen */}
      {gameState.gamePhase === "finished" && (
        <div className="final-score-overlay">
          <div className="final-score-container">
            {gameState.gameInterrupted ? (
              // Prikaz za prekinutu igru
              <>
                <div className="final-score-header">
                  <h2>⚠️ Igra prekinuta</h2>
                  <div className="result-emoji">😕</div>
                </div>
                <div className="game-result">
                  <p>{gameState.message}</p>
                </div>
                <div className="final-score-actions">
                  <button onClick={onGameEnd} className="btn-secondary-large">
                    � Glavni meni
                  </button>
                </div>
              </>
            ) : (
              // Normalni prikaz rezultata
              <>
                <div className="final-score-header">
                  <h2>�🎮 Partija završena!</h2>
                  {gameState.winner === gameState.playerNumber && (
                    <div className="result-emoji">🎉</div>
                  )}
                  {gameState.winner === null && (
                    <div className="result-emoji">🤝</div>
                  )}
                  {gameState.winner &&
                    gameState.winner !== gameState.playerNumber && (
                      <div className="result-emoji">😔</div>
                    )}
                </div>

                <div className="final-scores-grid">
                  <div className="final-player-score">
                    <div className="player-name">{user?.name}</div>
                    <div className="player-points">
                      {gameState.gameType === "treseta"
                        ? gameState.myPoints
                        : myPoints}{" "}
                      bodova
                    </div>
                    <div className="player-cards">
                      {getCardCountText((gameState.myCards || []).length)}
                    </div>
                    {gameState.winner === gameState.playerNumber && (
                      <div className="winner-badge">👑 POBJEDNIK</div>
                    )}
                  </div>

                  <div className="vs-divider">VS</div>

                  <div className="final-player-score">
                    <div className="player-name">
                      {gameState.opponent?.name}
                    </div>
                    <div className="player-points">
                      {gameState.gameType === "treseta"
                        ? gameState.opponentPoints
                        : opponentPoints}{" "}
                      bodova
                    </div>
                    <div className="player-cards">
                      {getCardCountText((gameState.opponentCards || []).length)}
                    </div>
                    {gameState.winner &&
                      gameState.winner !== gameState.playerNumber &&
                      gameState.winner !== null && (
                        <div className="winner-badge">👑 POBJEDNIK</div>
                      )}
                  </div>
                </div>

                <div className="game-result">
                  <p>{gameState.message}</p>
                </div>

                <div className="final-score-actions">
                  <button
                    onClick={() => {
                      // Resetuj game state za novi match
                      setGameState((prev) => ({
                        ...prev,
                        gamePhase: "matchmaking", // Postaviti na matchmaking dok čeka novi match
                        message: "Tražim revanš s istim protivnikom...",
                      }));
                      // Pokreni rematch s istim protivnikom
                      rematch(
                        gameData.gameMode || "1v1",
                        gameState.gameType,
                        gameState.opponent?.id // proslijedi opponent ID
                      );
                    }}
                    className="btn-primary-large"
                  >
                    🔄 Revanš
                  </button>
                  <button onClick={onGameEnd} className="btn-secondary-large">
                    🏠 Glavni meni
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Matchmaking Screen for Rematch */}
      {gameState.gamePhase === "matchmaking" && (
        <div className="final-score-overlay">
          <div className="final-score-container">
            <div className="final-score-header">
              <h2>🔄 Tražim revanš...</h2>
              <div className="result-emoji">⏳</div>
            </div>
            <div className="game-result">
              <p>{gameState.message}</p>
            </div>
            <div className="final-score-actions">
              <button
                onClick={() => {
                  // Odustani od revanša i vrati se na finished screen
                  setGameState((prev) => ({
                    ...prev,
                    gamePhase: "finished",
                    message:
                      prev.winner === prev.playerNumber
                        ? "🎉 Pobijedili ste! (Dosegnuli ste 61 bod)"
                        : prev.winner === null
                        ? "🤝 Neriješeno!"
                        : "😔 Izgubili ste.",
                  }));
                  // Otkaži matchmaking
                  socket?.emit("cancelMatch");
                }}
                className="btn-secondary-large"
              >
                🚫 Odustani
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Game;
