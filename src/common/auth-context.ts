import type { Role } from '../generated/prisma/client.js';

/** Access token ichidagi ma'lumot. */
export interface JwtPayload {
  sub: string; // User.id
  role: Role;
}

/** Guard so'rovga biriktiradigan joriy foydalanuvchi (bazadagi jonli holat). */
export interface AuthContext {
  userId: string;
  role: Role;
}
