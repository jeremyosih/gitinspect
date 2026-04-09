import { QueryClient } from "@tanstack/react-query";

export const authQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});
