import React, { useEffect } from "react";
import "./Toast.css";

const Toast = ({
  id,
  message,
  type = "success",
  onClose,
  autoClose = true,
  duration = 3000,
}) => {
  useEffect(() => {
    if (autoClose) {
      const timer = setTimeout(() => {
        onClose(id);
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [id, onClose, autoClose, duration]);

  const getIcon = () => {
    switch (type) {
      case "success":
        return "✅";
      case "error":
        return "❌";
      case "warning":
        return "⚠️";
      case "info":
        return "ℹ️";
      default:
        return "✅";
    }
  };

  return (
    <div className={`toast toast-${type}`}>
      <div className="toast-content">
        <span className="toast-icon">{getIcon()}</span>
        <span className="toast-message">{message}</span>
        <button
          className="toast-close"
          onClick={() => onClose(id)}
          aria-label="Close notification"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default Toast;
