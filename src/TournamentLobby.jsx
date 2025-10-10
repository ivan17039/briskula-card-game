import { useState, useEffect } from "react";
import { useSocket } from "./SocketContext";
import TournamentBracket from "./TournamentBracket";
import "./TournamentLobby.css";

function TournamentLobby({ onBack, gameType, onGameStart }) {
  const { socket, user } = useSocket();
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [viewingBracket, setViewingBracket] = useState(
    () => localStorage.getItem("tournamentView") || null
  );
  const [selectedTournament, setSelectedTournament] = useState(null);

  // Guard against null gameType to prevent crashes on refresh
  if (!gameType) {
    return (
      <div className="tournament-lobby">
        <div className="lobby-header-tournament">
          <button className="back-btn-tournament" onClick={onBack}>
            ←
          </button>
          <h1>🏆 Turniri</h1>
        </div>
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Učitavanje...</p>
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (!socket) return;

    // Zatraži listu aktivnih turnira
    socket.emit("getTournaments", { gameType });

    // Set timeout to show error if server doesn't respond
    const timeout = setTimeout(() => {
      if (loading) {
        setError("Nevažeći odgovor servera. Molimo pokušajte ponovno.");
        setLoading(false);
      }
    }, 10000); // 10 seconds timeout

    // Slušaj ažuriranja turnira
    socket.on("tournamentsUpdate", (tournamentList) => {
      console.log("🏆 Received tournaments:", tournamentList);
      setTournaments(tournamentList);
      // If we restored a bracket view and tournament exists, stay in it
      if (
        viewingBracket &&
        !tournamentList.find((t) => t.id === viewingBracket)
      ) {
        // tournament disappeared -> clear
        localStorage.removeItem("tournamentView");
        setViewingBracket(null);
      }
      setLoading(false);
      clearTimeout(timeout);
    });

    // Slušaj greške
    socket.on("tournamentError", (errorData) => {
      console.error("❌ Tournament error:", errorData);
      setError(errorData.message);
      setLoading(false); // Stop loading if there's an error
    });

    // Slušaj uspješnu registraciju
    socket.on("tournamentRegistered", (data) => {
      console.log("✅ Registered for tournament:", data);
      setError("");
      setSuccessMessage(data.message);

      // Clear success message after 5 seconds
      setTimeout(() => setSuccessMessage(""), 5000);

      // Refresh tournament list to show updated participant count
      socket.emit("getTournaments", { gameType });

      // Optimistically mark as registered
      setTournaments((prev) =>
        prev.map((t) =>
          t.id === data.tournamentId ? { ...t, isRegistered: true } : t
        )
      );
    }); // Listen for tournament updates (when someone else registers)
    socket.on("tournamentUpdated", (updatedTournament) => {
      console.log("🔄 Tournament updated:", updatedTournament);
      setTournaments((prev) =>
        prev.map((t) =>
          t.id === updatedTournament.id ? { ...t, ...updatedTournament } : t
        )
      );
    });

    // NEW: Handle tournament auto-start
    socket.on("tournamentStarted", (data) => {
      console.log("🚀 Tournament started:", data);
      setSuccessMessage(
        `Turnir "${data.name}" je počeo! Prelazim na bracket...`
      );

      // Auto-redirect to bracket view after 2 seconds
      setTimeout(() => {
        setViewingBracket(data.id);
        localStorage.setItem("tournamentView", data.id);
      }, 2000);
    });

    return () => {
      clearTimeout(timeout);
      socket.off("tournamentsUpdate");
      socket.off("tournamentError");
      socket.off("tournamentRegistered");
      socket.off("tournamentUpdated");
      socket.off("tournamentStarted");
    };
  }, [socket, gameType]);

  const handleRegisterTournament = (tournamentId) => {
    if (!socket || !user) {
      setError("Connection error");
      return;
    }

    console.log("📤 Registering for tournament:", tournamentId);
    socket.emit("registerForTournament", {
      tournamentId,
      userId: user.userId,
      userName: user.name,
    });
  };

  // Server is the single source of truth for tournaments
  const displayTournaments = tournaments;

  // Show tournament bracket if viewing one
  if (viewingBracket) {
    return (
      <TournamentBracket
        tournamentId={viewingBracket}
        onBack={() => {
          setViewingBracket(null);
          localStorage.removeItem("tournamentView");
          // Clear specific transient error about players needing to be online
          setError((prev) =>
            prev === "Oba igrača moraju biti online da se pokrene meč"
              ? ""
              : prev
          );
        }}
        onGameStart={onGameStart}
      />
    );
  }

  if (loading) {
    return (
      <div className="tournament-lobby">
        <div className="lobby-header-tournament">
          <button className="back-btn-tournament" onClick={onBack}>
            ←
          </button>
          <h1>Tournament Lobby</h1>
        </div>
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Učitavam turnire...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tournament-lobby">
      <div className="lobby-header-tournament">
        <div className="header-left">
          <button
            className="back-btn"
            onClick={onBack}
            title="Natrag na izbor moda"
          >
            ←
          </button>
        </div>
        <div className="header-center-tournament">
          <h1>
            🏆{" "}
            {gameType
              ? gameType.charAt(0).toUpperCase() + gameType.slice(1)
              : "Turniri"}{" "}
            Turniri
          </h1>
        </div>
        <div className="header-right-tournament">
          <button
            className="refresh-btn"
            onClick={() => socket?.emit("getTournaments", { gameType })}
            title="Refresh tournaments"
          >
            🔄
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError("")}>✕</button>
        </div>
      )}

      {successMessage && (
        <div className="success-banner">
          <span>✅ {successMessage}</span>
          <button onClick={() => setSuccessMessage("")}>✕</button>
        </div>
      )}

      <div className="tournaments-section">
        {displayTournaments.length === 0 ? (
          <div className="no-tournaments">
            <div className="no-tournaments-icon">🏆</div>
            <h3>Nema aktivnih turnira</h3>
            <p>Turniri se organiziraju povremeno. Pratite objave!</p>
            <div className="tournament-info">
              <h4>📅 Planiraju se:</h4>
              <ul>
                <li>🎄 Božićni Cup (Prosinac)</li>
                <li>🐰 Uskršnji Turnir (Ožujak/Travanj)</li>
                <li>🎊 Novogodišnji Championship (Siječanj)</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="tournaments-grid">
            {displayTournaments.map((tournament) => (
              <div key={tournament.id} className="tournament-card">
                <div className="tournament-header">
                  <h3>{tournament.name}</h3>
                  <div className="tournament-badges">
                    <span className={`status-badge ${tournament.status}`}>
                      {tournament.status === "registration"
                        ? "📝 Prijave"
                        : tournament.status === "ongoing"
                        ? "▶️ U tijeku"
                        : tournament.status}
                    </span>
                  </div>
                </div>

                <div className="tournament-info">
                  <div className="participants-info">
                    <div className="participants-count">
                      <span className="count">
                        {tournament.currentParticipants}/
                        {tournament.maxParticipants}
                      </span>
                      <span className="label">igrača</span>
                    </div>
                    <div className="participants-bar">
                      <div
                        className="participants-fill"
                        style={{
                          width: `${
                            (tournament.currentParticipants /
                              tournament.maxParticipants) *
                            100
                          }%`,
                        }}
                      ></div>
                    </div>
                  </div>

                  <p>
                    <strong>🎯 Nagrada:</strong> {tournament.prizePool}
                  </p>
                  <p>
                    <strong>📅 Rok prijava:</strong>{" "}
                    {tournament.registrationDeadline
                      ? new Date(
                          tournament.registrationDeadline
                        ).toLocaleDateString("hr-HR", {
                          day: "numeric",
                          month: "long",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "-"}
                  </p>
                  <p className="created-time">
                    Kreiran:{" "}
                    {tournament.createdAt
                      ? new Date(tournament.createdAt).toLocaleDateString(
                          "hr-HR"
                        )
                      : "-"}
                  </p>
                </div>

                <div className="tournament-actions">
                  {tournament.status === "registration" ? (
                    <button
                      className="register-btn"
                      onClick={() => handleRegisterTournament(tournament.id)}
                      disabled={
                        tournament.currentParticipants >=
                          tournament.maxParticipants || tournament.isRegistered
                      }
                    >
                      {tournament.isRegistered
                        ? "✅ Prijavljen"
                        : tournament.currentParticipants >=
                          tournament.maxParticipants
                        ? "🔒 Popunjen"
                        : "✍️ Prijavi se"}
                    </button>
                  ) : tournament.status === "ongoing" ? (
                    <button
                      className="view-bracket-btn"
                      onClick={() => setViewingBracket(tournament.id)}
                    >
                      🌳 Vidi tablicu
                    </button>
                  ) : (
                    <button className="view-bracket-btn" disabled>
                      🌳 Turnir završen
                    </button>
                  )}
                  {/* If user registered but tournament not started yet, allow bracket preview */}
                  {tournament.status === "registration" &&
                    tournament.isRegistered && (
                      <button
                        className="view-bracket-btn"
                        onClick={() => {
                          setViewingBracket(tournament.id);
                          localStorage.setItem("tournamentView", tournament.id);
                        }}
                        disabled={viewingBracket === tournament.id}
                      >
                        🌳 Vidi tablicu
                      </button>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="tournament-rules">
        <h4>ℹ️ Kako funkcioniraju turniri?</h4>
        <div className="rules-grid-tournament">
          <div className="rule-item-tournament">
            <strong>📝 Prijava:</strong> Prijaviš se dok ima mjesta
          </div>
          <div className="rule-item-tournament">
            <strong>🌳 Bracket:</strong> Eliminacijski sustav parova
          </div>
          <div className="rule-item-tournament">
            <strong>⏰ Rokovi:</strong> 48h za odigravanje meča
          </div>
          <div className="rule-item-tournament">
            <strong>🏆 Pobjeda:</strong> Pobjednik dobiva nagradu
          </div>
        </div>
      </div>
    </div>
  );
}

export default TournamentLobby;
