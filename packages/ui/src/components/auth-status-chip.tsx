import { toast } from "sonner";
import { useGitHubAuthContext } from "@gitinspect/ui/components/github-auth-context";
import { Button } from "@gitinspect/ui/components/button";

export function AuthStatusChip() {
  const auth = useGitHubAuthContext();

  if (!auth) {
    return null;
  }

  if (auth.authState.session === "signed-in") {
    return (
      <Button
        className="h-8 gap-1.5 shadow-none"
        onClick={async () => {
          try {
            await auth.signOut();
            toast.success("Signed out");
          } catch (error) {
            console.error(error);
            toast.error("Could not sign out");
          }
        }}
        size="sm"
        variant="ghost"
      >
        <span>Sign Out</span>
      </Button>
    );
  }

  return (
    <Button
      className="h-8 gap-1.5 shadow-none"
      onClick={() => {
        auth.openAuthDialog({
          mode: "github-only",
          reason: "settings",
        });
      }}
      size="sm"
      variant="ghost"
    >
      <span>Sign In</span>
    </Button>
  );
}
