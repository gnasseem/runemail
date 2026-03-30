// VAPID public key (not secret — safe to hardcode in frontend)
const VAPID_PUBLIC_KEY =
  "BFl6Y_jtxeT6LyEYx0m5V_y2TBnqZ36Q5TMLi3zpTilk9xDuk_Xhvt4Vin5x2zCoygTETXsturwYmNq78HJGams";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array(rawData.split("").map((c) => c.charCodeAt(0)));
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

export async function subscribeToPush(
  supabaseUrl: string,
  accessToken: string,
): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const reg = await registerServiceWorker();
    if (!reg) return false;

    // Re-use an existing subscription if one already exists
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return false;
      const keyBuffer = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBuffer.buffer.slice(
          keyBuffer.byteOffset,
          keyBuffer.byteOffset + keyBuffer.byteLength,
        ) as ArrayBuffer,
      });
    }

    const { endpoint, keys } = sub.toJSON() as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };

    const res = await fetch(`${supabaseUrl}/functions/v1/api/push/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(
  supabaseUrl: string,
  accessToken: string,
): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const { endpoint } = sub.toJSON() as { endpoint: string };
    await sub.unsubscribe();
    await fetch(`${supabaseUrl}/functions/v1/api/push/subscribe`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    // Non-blocking
  }
}
