import React from "react";
import "./Header.css";

const Header = ({
  user,
  onLogout,
  onLeaderboard,
  onAbout,
  onPrivacy,
  onBugReport,
}) => {
  const isLoggedIn = !!user;

  return (
    <header className="app-header">
      {/* Left section: Logo or User Info */}
      <div className="app-header-left">
        {isLoggedIn ? (
          <div className="app-user-info">
            <span className="app-user-name">{user.name}</span>
            <span className="app-user-badge">
              {user.isGuest ? "Gost" : "Registriran"}
            </span>
          </div>
        ) : (
          <div className="app-header-logo">
            <img
              src="/cards_img/dinarICON.png"
              alt=""
              className="app-logo-icon"
            />
            <span className="app-logo-text">Briskula & Trešeta</span>
          </div>
        )}
      </div>

      {/* Center section: Navigation links */}
      <nav className="app-header-nav">
        {onAbout && (
          <button className="app-nav-btn" onClick={onAbout}>
            O igri
          </button>
        )}
        {onPrivacy && (
          <button className="app-nav-btn" onClick={onPrivacy}>
            Privatnost
          </button>
        )}
        {onBugReport && (
          <button className="app-nav-btn" onClick={onBugReport}>
            Prijavi bug
          </button>
        )}
      </nav>

      {/* Right section: Actions (only when logged in) */}
      <div className="app-header-right">
        {isLoggedIn ? (
          <div className="app-header-actions">
            {onLeaderboard && (
              <button
                className="app-action-btn app-leaderboard-btn"
                onClick={onLeaderboard}
              >
                <span className="app-btn-icon">🏆</span>
                <span className="app-btn-text">Ljestvica</span>
              </button>
            )}
            <button
              className="app-action-btn app-logout-btn"
              onClick={onLogout}
            >
              <svg
                className="app-btn-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16,17 21,12 16,7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="app-btn-text">Odjavi se</span>
            </button>
          </div>
        ) : (
          <div className="app-header-logo-right">
            <img
              src="/cards_img/dinarICON.png"
              alt=""
              className="app-logo-icon"
            />
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
