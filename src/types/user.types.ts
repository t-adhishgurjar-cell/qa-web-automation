export interface UserCredentials {
  username: string;
  password: string;
}

export type UserRole = 'admin' | 'user' | 'viewer' | 'manager';

export interface UserProfile {
  id:        string;
  username:  string;
  email:     string;
  firstName: string;
  lastName:  string;
  role:      UserRole;
  avatar?:   string;
}

export interface CustomerProfile {
  firstName: string;
  lastName:  string;
  email:     string;
  company?:  string;
  phone?:    string;
  country?:  string;
}
