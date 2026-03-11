// Authentication Types - Using existing "user" table

export interface User {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  avatar_url?: string;
  organization_id?: string;
  role?: string;
  status?: string;
  created_at: string;
  updated_at?: string;
}

export interface AuthSession {
  user: User;
  token: string;
  expires_at: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignUpRequest {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  session?: AuthSession;
  user?: User;
}
