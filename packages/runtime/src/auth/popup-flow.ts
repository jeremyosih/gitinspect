const POPUP_FEATURES = "popup=yes,width=560,height=760,left=120,top=120";

interface OAuthCallbackMessage {
  error?: string;
  type: "oauth-callback";
  url?: string;
}

export async function runPopupOAuthFlow(authUrl: string): Promise<URL> {
  const popup = window.open(authUrl, "sitegeist-oauth", POPUP_FEATURES);

  if (!popup) {
    throw new Error("Failed to open OAuth popup");
  }

  return await new Promise<URL>((resolve, reject) => {
    const onMessage = (event: MessageEvent<OAuthCallbackMessage>) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data.type !== "oauth-callback") {
        return;
      }

      cleanup();

      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }

      if (!event.data.url) {
        reject(new Error("OAuth callback did not include a redirect URL"));
        return;
      }

      resolve(new URL(event.data.url));
    };

    const interval = window.setInterval(() => {
      if (!popup.closed) {
        return;
      }

      cleanup();
      reject(new Error("OAuth popup was closed before completing login"));
    }, 250);

    const cleanup = () => {
      window.clearInterval(interval);
      window.removeEventListener("message", onMessage);
      popup.close();
    };

    window.addEventListener("message", onMessage);
  });
}

export function openPopup(url: string): void {
  window.open(url, "sitegeist-oauth-device", POPUP_FEATURES);
}
