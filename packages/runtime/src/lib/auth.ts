import { betterAuth } from "better-auth";

function createAuthInstance() {
  return betterAuth({
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID as string,
        clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
      },
    },
  });
}

let authInstance: ReturnType<typeof createAuthInstance> | undefined;

export function getAuth(): ReturnType<typeof createAuthInstance> {
  if (!authInstance) {
    authInstance = createAuthInstance();
  }

  return authInstance;
}
