import React from "react";
import "./UserHeader.css";

const UserHeader = ({ user, onLogout }) => {
  if (!user) return null;

  return (
    <div className="user-header">
      <div className="user-info">
        <span className="user-name">{user.name}</span>
        <span className="user-status">
          {user.isGuest ? "Gost" : "Registriran"}
        </span>
      </div>
      <button className="logout-btn" onClick={onLogout}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16,17 21,12 16,7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        <span>Odjavi se</span>
      </button>
    </div>
  );
};

export default UserHeader;
