import React, { useState } from "react";
import "./Header.css";

const Header = ({ user, onLogout, onLeaderboard, onBugReport }) => {
  const isLoggedIn = !!user;
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };

  const closeMenu = () => {
    setMenuOpen(false);
  };

  const handleMenuAction = (action) => {
    closeMenu();
    if (action) action();
  };

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
        {/* Empty on desktop, bug report moved to right section */}
      </nav>

      {/* Hamburger Menu Button (Mobile) */}
      <button
        className={`hamburger-btn ${menuOpen ? "open" : ""}`}
        onClick={toggleMenu}
        aria-label="Menu"
      >
        <span></span>
        <span></span>
        <span></span>
      </button>

      {/* Mobile Menu Overlay */}
      {menuOpen && (
        <div className="mobile-menu-overlay" onClick={closeMenu}>
          <div className="mobile-menu" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-menu-header">
              <h3>Izbornik</h3>
            </div>
            <div className="mobile-menu-items">
              {isLoggedIn && onLeaderboard && (
                <button
                  className="mobile-menu-item"
                  onClick={() => handleMenuAction(onLeaderboard)}
                >
                  <span className="mobile-menu-icon">🏆</span>
                  <span>Ljestvica</span>
                </button>
              )}
              {isLoggedIn && onBugReport && (
                <button
                  className="mobile-menu-item"
                  onClick={() => handleMenuAction(onBugReport)}
                >
                  <span className="mobile-menu-icon">🐛</span>
                  <span>Prijavi bug</span>
                </button>
              )}
              {isLoggedIn && (
                <button
                  className="mobile-menu-item logout-item"
                  onClick={() => handleMenuAction(onLogout)}
                >
                  <svg
                    className="mobile-menu-icon"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16,17 21,12 16,7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span>Odjavi se</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Right section: Actions */}
      <div className="app-header-right">
        <div className="app-header-actions">
          {isLoggedIn && onBugReport && (
            <button
              className="app-action-btn app-bug-btn"
              onClick={onBugReport}
            >
              <span className="app-btn-icon">🐛</span>
              <span className="app-btn-text">Prijavi bug</span>
            </button>
          )}
          {isLoggedIn && (
            <>
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
            </>
          )}
        </div>
        {!isLoggedIn && (
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
