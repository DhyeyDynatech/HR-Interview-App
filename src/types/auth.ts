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
