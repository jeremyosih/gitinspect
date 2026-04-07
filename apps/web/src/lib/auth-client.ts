import { env } from "@gitinspect/env/web";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: env.VITE_BETTER_AUTH_URL,
});
