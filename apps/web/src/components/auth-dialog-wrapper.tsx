import { useGitHubAuthContext } from "@gitinspect/ui/components/github-auth-context";
import { AuthDialog } from "@/components/auth-dialog";

export function AuthDialogWrapper() {
  const auth = useGitHubAuthContext();

  if (!auth) {
    return null;
  }

  return (
    <AuthDialog
      onOpenChange={(open) => {
        if (!open) {
          auth.closeAuthDialog();
        }
      }}
      mode={auth.dialogMode}
      open={auth.dialogOpen}
      variant={auth.dialogVariant}
    />
  );
}
