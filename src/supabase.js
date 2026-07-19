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
    const { data, error } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo,
      },
    );
    return { data, error };
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
