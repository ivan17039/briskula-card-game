// supabase.js - Supabase client configuration
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Auth helper funkcije
export const auth = {
  // Registracija
  signUp: async (email, password, username) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username,
        },
      },
    });
    return { data, error };
  },

  // Login
  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  },

  // Logout
  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  },

  // Pošalji reset lozinke na email
  requestPasswordReset: async (email, redirectTo) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    return { data, error };
  },

  // Permanently delete the authenticated account and app data
  deleteAccount: async () => {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      return {
        error: sessionError || new Error("Nema aktivne prijave"),
      };
    }

    const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
    try {
      const response = await fetch(`${serverUrl}/api/account`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          error: new Error(result.error || "Nije moguće obrisati račun"),
        };
      }

      return { error: null };
    } catch (error) {
      return { error };
    }
  },

  // Ažuriraj profil ili lozinku
  updateAccount: async ({ username, password }) => {
    const updateData = {};

    if (typeof username === "string") {
      updateData.data = { username };
    }

    if (password) {
      updateData.password = password;
    }

    const { data, error } = await supabase.auth.updateUser(updateData);
    return { data, error };
  },

  // Get current user
  getUser: async () => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    return { user, error };
  },

  // Listen to auth changes
  onAuthStateChange: (callback) => {
    return supabase.auth.onAuthStateChange(callback);
  },
};
