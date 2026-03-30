// RuneMail Service Worker — handles Web Push notifications

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "RuneMail", body: event.data.text() };
  }

  const {
    title = "RuneMail",
    body = "New email",
    tag = "runemail",
    data = {},
  } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/Logo.png",
      badge: "/Logo.png",
      tag,
      data,
      requireInteraction: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing tab if open
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        // Otherwise open the app
        return self.clients.openWindow("/app");
      }),
  );
});
