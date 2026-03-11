import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import md5 from "md5";

// Create a fresh client for each request in serverless environment
// This avoids stale connection issues on Vercel
function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Use service role key if available (for bypassing RLS), otherwise use anon key
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseKey) {
    throw new Error("Supabase key is required. Please set SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment variables.");
  }

  if (!supabaseUrl) {
    throw new Error("Supabase URL is required. Please set NEXT_PUBLIC_SUPABASE_URL in your environment variables.");
  }

  return createClient(supabaseUrl, supabaseKey);
}

// Simple password hashing (in production, use bcrypt)
export function hashPassword(password: string): string {
  const salt = process.env.PASSWORD_SALT;
  if (!salt) {
    throw new Error("PASSWORD_SALT environment variable is required");
  }
  return md5(password + salt);
}

export function verifyPassword(password: string, hash: string): boolean {

  return hashPassword(password) === hash;
}

// Generate a simple JWT-like token
export function generateToken(userId: string): string {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  const payload = {
    userId,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    iat: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  const signature = md5(encoded + jwtSecret);

  return `${encoded}.${signature}`;
}

export function verifyToken(token: string): { valid: boolean; userId?: string } {
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error("JWT_SECRET environment variable is required");
    }
    const [encoded, signature] = token.split(".");
    const expectedSignature = md5(encoded + jwtSecret);
    
    if (signature !== expectedSignature) {

      return { valid: false };
    }
    
    const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
    
    if (payload.exp < Date.now()) {

      return { valid: false };
    }
    

    return { valid: true, userId: payload.userId };
  } catch {

    return { valid: false };
  }
}

// Database operations - using existing "user" table
export async function createUser(data: {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
}) {
  const supabase = getSupabaseClient();
  const hashedPassword = hashPassword(data.password);
  const userId = nanoid();
  
  const { data: user, error } = await supabase
    .from("user")  // Using existing "user" table
    .insert({
      id: userId,
      email: data.email.toLowerCase(),
      password_hash: hashedPassword,
      first_name: data.first_name,
      last_name: data.last_name,
      status: 'active',
      role: 'admin',
    })
    .select()
    .single();
  
  if (error) {
  throw error;
}

  return user;
}

export async function getUserByEmail(email: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("user")  // Using existing "user" table
    .select("*")
    .eq("email", email.toLowerCase())
    .single();
  
  if (error && error.code !== "PGRST116") {
  throw error;
}

  return data;
}

export async function getUserById(id: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("user")  // Using existing "user" table
    .select("id, email, first_name, last_name, phone, avatar_url, organization_id, role, status, created_at, updated_at")
    .eq("id", id)
    .single();
  
  if (error) {
  throw error;
}

  return data;
}

export async function updateUserLastLogin(userId: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("user")
    .update({ last_login: new Date().toISOString() })
    .eq("id", userId);
  
  // Silently ignore last login update errors
}

// Update user password
export async function updateUserPassword(userId: string, currentPassword: string, newPassword: string) {
  const supabase = getSupabaseClient();
  
  // First, verify the current password
  const { data: user, error: fetchError } = await supabase
    .from("user")
    .select("password_hash")
    .eq("id", userId)
    .single();
  
  if (fetchError) {
    throw new Error("User not found");
  }
  
  if (!verifyPassword(currentPassword, user.password_hash)) {
    throw new Error("Current password is incorrect");
  }
  
  // Update to new password
  const newPasswordHash = hashPassword(newPassword);
  const { error: updateError } = await supabase
    .from("user")
    .update({ 
      password_hash: newPasswordHash,
      updated_at: new Date().toISOString()
    })
    .eq("id", userId);
  
  if (updateError) {
    throw updateError;
  }
  
  return true;
}

// Update user profile information
export async function updateUserProfile(userId: string, data: {
  first_name?: string;
  last_name?: string;
  phone?: string;
  avatar_url?: string;
}) {
  const supabase = getSupabaseClient();
  
  const { data: updatedUser, error } = await supabase
    .from("user")
    .update({
      ...data,
      updated_at: new Date().toISOString()
    })
    .eq("id", userId)
    .select("id, email, first_name, last_name, phone, avatar_url, organization_id, role, status, created_at, updated_at")
    .single();
  
  if (error) {
    throw error;
  }
  
  return updatedUser;
}

// Generate password reset token
export function generatePasswordResetToken(): string {
  return nanoid(32); // Generate a secure random token
}

// Save password reset token to user
export async function savePasswordResetToken(userId: string, token: string): Promise<void> {
  const supabase = getSupabaseClient();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
  
  const { error } = await supabase
    .from("user")
    .update({
      reset_token: token,
      reset_token_expires: expiresAt.toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", userId);
  
  if (error) {
    throw error;
  }
}

// Verify password reset token
export async function verifyPasswordResetToken(token: string): Promise<{ valid: boolean; userId?: string }> {
  const supabase = getSupabaseClient();
  
  const { data: user, error } = await supabase
    .from("user")
    .select("id, reset_token, reset_token_expires")
    .eq("reset_token", token)
    .single();
  
  if (error || !user) {
    return { valid: false };
  }
  
  // Check if token has expired
  if (!user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
    return { valid: false };
  }
  
  return { valid: true, userId: user.id };
}

// Reset user password using reset token
export async function resetUserPassword(token: string, newPassword: string): Promise<void> {
  const supabase = getSupabaseClient();
  
  // Verify token
  const tokenVerification = await verifyPasswordResetToken(token);
  if (!tokenVerification.valid || !tokenVerification.userId) {
    throw new Error("Invalid or expired reset token");
  }
  
  // Update password and clear reset token
  const newPasswordHash = hashPassword(newPassword);
  const { error } = await supabase
    .from("user")
    .update({
      password_hash: newPasswordHash,
      reset_token: null,
      reset_token_expires: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", tokenVerification.userId);
  
  if (error) {
    throw error;
  }
}