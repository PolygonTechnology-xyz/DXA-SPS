import { QueryClient } from '@tanstack/react-query'

// Shared so long-running AI jobs can update the cache even after the page that started them unmounts
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})
