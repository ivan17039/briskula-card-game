import React, { useState, useEffect } from "react";
import { useSocket } from "./SocketContext";
import Header from "./Header";
import "./Leaderboard.css";

// Level thresholds (same as EloWidget)
const LEVELS = [
  { level: 1, min: 100, max: 849 },
  { level: 2, min: 850, max: 949 },
  { level: 3, min: 950, max: 1049 },
  { level: 4, min: 1050, max: 1149 },
  { level: 5, min: 1150, max: 1249 },
  { level: 6, min: 1250, max: 1349 },
  { level: 7, min: 1350, max: 1499 },
  { level: 8, min: 1500, max: 1649 },
  { level: 9, min: 1650, max: 1849 },
  { level: 10, min: 1850, max: Infinity },
];

function getLevel(elo) {
  return LEVELS.find((l) => elo >= l.min && elo <= l.max) || LEVELS[0];
}

function Leaderboard({ onBack, onLogout, onBugReport }) {
  const { user } = useSocket();
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // 'all' | 'briskula' | 'treseta'
  const [error, setError] = useState("");

  useEffect(() => {
    fetchLeaderboard();
  }, [filter]);

  const fetchLeaderboard = async () => {
    setLoading(true);
    setError("");

    try {
      const apiBase =
        import.meta.env.VITE_SERVER_URL ||
        import.meta.env.VITE_API_URL ||
        window.location.origin;
      const response = await fetch(
        `${apiBase}/api/leaderboard?gameType=${filter}&limit=50`,
      );

      if (!response.ok) {
        throw new Error("Failed to fetch leaderboard");
      }

      const result = await response.json();

      if (result.success && result.data) {
        // Transform data to include level
        const enrichedData = result.data.map((player, index) => ({
          ...player,
          rank: index + 1,
          level: getLevel(player.elo).level,
        }));
        setLeaderboardData(enrichedData);
      } else {
        setLeaderboardData([]);
      }
      setLoading(false);
    } catch (err) {
      console.error("Leaderboard fetch error:", err);
      setError("Greška pri učitavanju ljestvice");
      setLoading(false);
    }
  };

  const isCurrentUser = (playerId) => {
    return user && user.userId === playerId;
  };

  if (loading) {
    return (
      <>
        <Header user={user} onLogout={onLogout} onBugReport={onBugReport} />
        <div className="leaderboard-container">
          <div className="leaderboard-header">
            <button className="back-btn back-btn-leaderboard" onClick={onBack}>
              ←
            </button>
            <h1>Ljestvica</h1>
          </div>
          <div className="lb-loading-state">
            <div className="lb-loading-spinner"></div>
            <p>Učitavanje ljestvice...</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header user={user} onLogout={onLogout} onBugReport={onBugReport} />
      <div className="leaderboard-container">
        <div className="leaderboard-header">
          <button className="back-btn back-btn-leaderboard" onClick={onBack}>
            ←
          </button>
          <h1>🏆 Ljestvica</h1>
          <div className="lb-header-actions">
            <button
              className="lb-refresh-btn"
              onClick={fetchLeaderboard}
              title="Osvježi"
            >
              🔄
            </button>
          </div>
        </div>

        <div className="leaderboard-filters">
          <button
            className={`filter-btn ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            Sve igre
          </button>
          <button
            className={`filter-btn ${filter === "briskula" ? "active" : ""}`}
            onClick={() => setFilter("briskula")}
          >
            🃏 Briskula
          </button>
          <button
            className={`filter-btn ${filter === "treseta" ? "active" : ""}`}
            onClick={() => setFilter("treseta")}
          >
            🎯 Trešeta
          </button>
        </div>

        {error && (
          <div className="lb-error-banner">
            <span>{error}</span>
            <button onClick={() => setError("")}>✕</button>
          </div>
        )}

        {/* Mobile: Show current user's stats prominently */}
        {user && !user.isGuest && (
          <div className="mobile-user-stats">
            {leaderboardData.map((player) => {
              if (isCurrentUser(player.userId)) {
                return (
                  <div key="mobile-stats" className="mobile-stats-card">
                    <div className="mobile-stats-header">
                      <span className="mobile-stats-title">👤 Vaša Stats</span>
                      <span className="mobile-stats-rank">#{player.rank}</span>
                    </div>
                    <div className="mobile-stats-body">
                      <div className="mobile-stat-item">
                        <span className="mobile-stat-label">Ime:</span>
                        <span className="mobile-stat-value">{player.name}</span>
                      </div>
                      <div className="mobile-stat-item">
                        <span className="mobile-stat-label">Level:</span>
                        <div className={`level-badge level-${player.level}`}>
                          {player.level}
                        </div>
                      </div>
                      <div className="mobile-stat-item">
                        <span className="mobile-stat-label">ELO:</span>
                        <span className="mobile-stat-value">{player.elo}</span>
                      </div>
                      <div className="mobile-stat-item">
                        <span className="mobile-stat-label">Streak:</span>
                        <span className="mobile-stat-value mobile-streak">
                          <span className="stat-wins">{player.wins}W</span>
                          <span className="stat-separator">/</span>
                          <span className="stat-losses">{player.losses}L</span>
                        </span>
                      </div>
                      <div className="mobile-stat-item">
                        <span className="mobile-stat-label">Win Rate:</span>
                        <span
                          className={`mobile-stat-value winrate ${
                            parseFloat(player.winRate) >= 50
                              ? "positive"
                              : "negative"
                          }`}
                        >
                          {player.winRate}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }
              return null;
            })}
          </div>
        )}

        <div className="leaderboard-content">
          <div className="leaderboard-table">
            <div className="table-header">
              <div className="col-rank">#</div>
              <div className="col-player">Igrač</div>
              <div className="col-level">Level</div>
              <div className="col-elo">ELO</div>
              <div className="col-stats">Pobjede/Porazi</div>
              <div className="col-winrate">Win %</div>
            </div>

            <div className="table-body">
              {leaderboardData.map((player) => (
                <div
                  key={player.userId}
                  className={`table-row ${
                    isCurrentUser(player.userId) ? "current-user" : ""
                  } ${player.rank <= 3 ? `top-${player.rank}` : ""}`}
                >
                  <div className="col-rank">
                    {player.rank <= 3 ? (
                      <span className="rank-medal">
                        {player.rank === 1 && "🥇"}
                        {player.rank === 2 && "🥈"}
                        {player.rank === 3 && "🥉"}
                      </span>
                    ) : (
                      <span>{player.rank}</span>
                    )}
                  </div>
                  <div className="col-player">
                    <span className="player-name" title={player.name}>
                      {player.name}
                    </span>
                    {isCurrentUser(player.userId) && (
                      <span className="you-badge">Vi</span>
                    )}
                  </div>
                  <div className="col-level">
                    <div className={`level-badge level-${player.level}`}>
                      {player.level}
                    </div>
                  </div>
                  <div className="col-elo">
                    <span className="elo-value">{player.elo}</span>
                  </div>
                  <div className="col-stats">
                    <span className="stat-wins">{player.wins}</span>
                    <span className="stat-separator">/</span>
                    <span className="stat-losses">{player.losses}</span>
                  </div>
                  <div className="col-winrate">
                    <span
                      className={`winrate ${
                        parseFloat(player.winRate) >= 50
                          ? "positive"
                          : "negative"
                      }`}
                    >
                      {player.winRate}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {leaderboardData.length === 0 && (
            <div className="lb-empty-state">
              <div className="lb-empty-icon">📊</div>
              <h3>Nema podataka</h3>
              <p>Ljestvica je trenutno prazna. Budite prvi!</p>
            </div>
          )}
        </div>

        {user && user.isGuest && (
          <div className="lb-guest-notice">
            <p>
              <strong>💡 Registrirajte se</strong> da se kvalificirate za
              ljestvicu i trajno čuvanje statistike.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

export default Leaderboard;
