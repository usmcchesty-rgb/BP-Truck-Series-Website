(function () {
  const STREAMERS = [
    {
      driver: "Chris Carroll3",
      carNumber: "3",
      photo: "/assets/drivers/chris-carroll3.png",
      platform: "Twitch",
      streamUrl: "https://twitch.tv/placeholder",
    },
    {
      driver: "Mark Arthur",
      carNumber: "19",
      photo: "/assets/drivers/mark-arthur.png",
      platform: "YouTube",
      streamUrl: "https://youtube.com/@placeholder",
    },
    {
      driver: "Alex Mercer",
      carNumber: "88",
      photo: "/assets/drivers/placeholder.png",
      platform: "Twitch",
      streamUrl: "https://twitch.tv/placeholder2",
    },
    {
      driver: "Jordan Pike",
      carNumber: "42",
      photo: "/assets/drivers/placeholder.png",
      platform: "Kick",
      streamUrl: "https://kick.com/placeholder",
    },
  ];

  function normalizeDriverKey(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  const STREAMER_KEYS = new Set(
    STREAMERS.map((s) => normalizeDriverKey(s.driver))
  );

  function isStreamer(name) {
    return STREAMER_KEYS.has(normalizeDriverKey(name));
  }

  window.BP_STREAMERS_DATA = {
    STREAMERS,
    isStreamer,
    normalizeDriverKey,
  };
})();
