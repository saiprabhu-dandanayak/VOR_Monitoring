// Initialize default settings
chrome.storage.local.get(['meetUrl', 'timeRestriction', 'startTime', 'endTime'], function(result) {
  const defaults = {};

  if (result.meetUrl === undefined) defaults.meetUrl = '';
  if (result.timeRestriction === undefined) defaults.timeRestriction = false;
  if (result.startTime === undefined) defaults.startTime = '13:00';
  if (result.endTime === undefined) defaults.endTime = '15:00';

  if (Object.keys(defaults).length > 0) {
    chrome.storage.local.set(defaults);
  }
});

// Create alarm for periodic screenshots
chrome.alarms.create("takeScreenshot", { periodInMinutes: 15 });

// Handle alarm events
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "takeScreenshot") {
    const isRestricted = await isTimeRestricted();
    const currentHour = new Date().getHours();
    const isAfterHardStopTime = currentHour >= 18;

    if (!isRestricted && !isAfterHardStopTime) {
      console.log("✅ Taking scheduled screenshot");
      await takeScreenshot();
    } else {
      const reasons = [];
      if (isRestricted) reasons.push("user-defined time restrictions");
      if (isAfterHardStopTime) reasons.push("it's 6 PM or later (hard stop)");
      console.log(`⏭ Screenshot skipped due to: ${reasons.join(' and ')}.`);
    }
  }
});

// Check if current time is within restricted period
async function isTimeRestricted() {
  const { timeRestriction, startTime, endTime } = await chrome.storage.local.get(['timeRestriction', 'startTime', 'endTime']);

  if (!timeRestriction) {
    console.log("Time restrictions are disabled");
    return false;
  }

  const now = new Date();
  const currentTimeStr = now.toTimeString().slice(0, 5); // "HH:MM"

  console.log(`Current time: ${currentTimeStr}, Restriction: ${startTime} - ${endTime}`);

  if (startTime < endTime) {
    return currentTimeStr >= startTime && currentTimeStr < endTime;
  } else {
    return currentTimeStr >= startTime || currentTimeStr < endTime;
  }
}

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateMeetUrl") {
    chrome.storage.local.set({ meetUrl: message.url });
    console.log("Updated Meet URL to:", message.url);
    sendResponse({ success: true });
  } else if (message.action === "takeScreenshotNow") {
    console.log("Manual screenshot requested");
    takeScreenshot();
    sendResponse({ success: true });
  } else if (message.action === "getMeetUrl") {
    chrome.storage.local.get(['meetUrl'], result => {
      sendResponse({ url: result.meetUrl });
    });
  } else if (message.action === "testTimeRestriction") {
    isTimeRestricted().then(isRestricted => {
      sendResponse({ isRestricted });
    });
  }
  return true;
});

// Find the specific Google Meet tab
async function findMeetTab() {
  const { meetUrl } = await chrome.storage.local.get(['meetUrl']);
  if (meetUrl) {
    const tabs = await chrome.tabs.query({ url: meetUrl });
    if (tabs.length > 0) return tabs[0];
  }
  throw new Error("No matching Google Meet tab found.");
}

// Take a screenshot
async function takeScreenshot() {
  let currentActiveTab = null;

  try {
    const { isProcessing } = await chrome.storage.local.get(['isProcessing']);
    if (isProcessing) {
      console.log("Screenshot already in progress.");
      return;
    }

    await chrome.storage.local.set({ isProcessing: true });

    const meetTab = await findMeetTab();

    if (!meetTab || !meetTab.windowId) throw new Error("No valid Meet tab");

    [currentActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    await chrome.windows.update(meetTab.windowId, { focused: true });
    await chrome.tabs.update(meetTab.id, { active: true });

    await new Promise(res => setTimeout(res, 1000)); // Wait for tab to activate

    chrome.tabs.captureVisibleTab(meetTab.windowId, { format: "png" }, async (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("Capture error:", chrome.runtime.lastError.message);
        await chrome.storage.local.set({ isProcessing: false });
        return;
      }

      console.log("📸 Screenshot captured");
      try {
        await saveImage(dataUrl);
      } catch (err) {
        console.error("Save error:", err);
      } finally {
        await chrome.storage.local.set({ isProcessing: false });
        if (currentActiveTab) await chrome.tabs.update(currentActiveTab.id, { active: true });
      }
    });
  } catch (err) {
    console.error("Screenshot error:", err);
    await chrome.storage.local.set({ isProcessing: false });
  }
}

// Save and send screenshot
async function saveImage(dataUrl) {
  const subfolder = "GoogleMeetScreenshots";
  const now = new Date();

  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: false }).replace(/:/g, '-');

  const imageFilename = `${subfolder}/${dateStr}/meet_screenshot_${timeStr}.png`;

  // Download image
  chrome.downloads.download({ url: dataUrl, filename: imageFilename, saveAs: false }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error("Download error:", chrome.runtime.lastError);
    } else {
      console.log(`💾 Screenshot saved as ${imageFilename}`);
    }
  });

  // Send to FastAPI
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const formData = new FormData();
    formData.append("file", blob, `screenshot_${timeStr}.png`);

    console.log("📤 Sending to FastAPI...");
    const response = await fetch("http://127.0.0.1:8000/analyze-screenshot", {
      method: "POST",
      body: formData
    });

    if (!response.ok) throw new Error(`FastAPI error: ${response.status}`);

    const result = await response.json();
    console.log("✅ FastAPI response:", result);

    const formattedTimestamp = `${dateStr} ${timeStr.replace(/-/g, ':')}`;
    await updateCsv(result, formattedTimestamp);
  } catch (err) {
    console.error("❌ FastAPI send error:", err);
  }
}

// Send data to Google Sheet
async function updateCsv(data, formattedTimestamp) {
  const scriptUrl = 'https://script.google.com/a/macros/zemosolabs.com/s/AKfycbzgH7TVDE5gtzlT2tN3g8-2iIsolHpJm4AqrcDW1-zvc1bSFtj9WLbvTubP4r6P45VzGA/exec';

  const breakoutRoom = data.breakout_room || "Unknown";
  const participants = data.participants || [];

  const payload = participants.map(p => ({
    timestamp: formattedTimestamp,
    name: p.name,
    camera_status: p.camera_status,
    breakout_room: breakoutRoom
  }));

  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include'
    });

    if (!response.ok) throw new Error(`Sheet update failed: ${response.status}`);
    console.log("📝 Data successfully added to Google Sheets");
  } catch (err) {
    console.error("❌ Google Sheets update error:", err);
  }
}

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  console.log("🚀 Extension installed/updated");
  chrome.storage.local.get(['meetUrl', 'timeRestriction', 'startTime', 'endTime'], (result) => {
    const defaults = {};
    if (result.meetUrl === undefined) defaults.meetUrl = '';
    if (result.timeRestriction === undefined) defaults.timeRestriction = false;
    if (result.startTime === undefined) defaults.startTime = '13:00';
    if (result.endTime === undefined) defaults.endTime = '15:00';

    if (Object.keys(defaults).length > 0) {
      chrome.storage.local.set(defaults, () => console.log("Default settings applied"));
    }
  });
});
