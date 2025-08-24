import React, { createContext, useContext, useState, useCallback } from "react";
import Toast from "./Toast";

const ToastContext = createContext();

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "success", options = {}) => {
    const id = Date.now() + Math.random();
    const toast = {
      id,
      message,
      type,
      autoClose: options.autoClose !== false,
      duration: options.duration || 3000,
      ...options,
    };

    setToasts((prev) => [...prev, toast]);

    // Auto-remove toast if autoClose is enabled
    if (toast.autoClose) {
      setTimeout(() => {
        removeToast(id);
      }, toast.duration);
    }

    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const clearAllToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const value = {
    addToast,
    removeToast,
    clearAllToasts,
    toasts,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            id={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={removeToast}
            autoClose={toast.autoClose}
            duration={toast.duration}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export default ToastProvider;
