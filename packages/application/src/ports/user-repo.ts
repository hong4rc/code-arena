export interface User {
  id: string;
  email: string;
  name: string | null;
  role: "user" | "admin";
}

export interface UserRepo {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(input: { id?: string; email: string; name?: string | null; role?: "user" | "admin" }): Promise<User>;
}
