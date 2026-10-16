import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { savePreferences } from "@/api/account"
import { authKeys, type User } from "@/api/auth"
import { insightsKeys } from "@/api/insights"
import { TIMEZONE } from "@/api/wallet"
import { errorMessage } from "@/lib/api"

// Turning AI insights on or off, from the Home card, the Insights page or Settings
export function useInsightsToggle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => savePreferences({ aiInsightsEnabled: enabled, timezone: TIMEZONE }),
    onSuccess: ({ user }) => {
      queryClient.setQueryData<User>(authKeys.me, user)
      void queryClient.invalidateQueries({ queryKey: insightsKeys.all })
      toast.success(user.aiInsightsEnabled ? "AI features are on. Your first insights are on the way." : "AI features turned off")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
}
