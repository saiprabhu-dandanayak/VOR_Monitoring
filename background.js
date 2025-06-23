// Initialize default settings
chrome.storage.local.get(['meetUrl', 'timeRestriction', 'startTime', 'endTime'], function(result) {
  const defaults = {};
  
  if (!result.meetUrl) {
    defaults.meetUrl = '';
  }
  
  if (result.timeRestriction === undefined) {
    defaults.timeRestriction = false;
  }
  
  if (!result.startTime) {
    defaults.startTime = '13:00'; 
  }
  
  if (!result.endTime) {
    defaults.endTime = '15:00'; 
  }
  
  if (Object.keys(defaults).length > 0) {
    chrome.storage.local.set(defaults);
  }
});

// Create alarm for periodic screenshots
chrome.alarms.create("takeScreenshot", { periodInMinutes: 1 });

// Handle alarm events
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "takeScreenshot") {
    const isRestricted = await isTimeRestricted();
    const now = new Date();
    const currentHour = now.getHours();
    const isAfterHardStopTime = currentHour >= 18;
    if (!isRestricted) {
      console.log("Taking scheduled screenshot");
      await takeScreenshot();
    } else {
      let reasons = [];
      if (isRestricted) {
        reasons.push("user-defined time restrictions");
      }
      if (isAfterHardStopTime) {
        reasons.push("it's 6 PM or later (hard stop)");
      }
      console.log(`Screenshot skipped due to: ${reasons.join(' and ')}.`);
    }
  }
});

// Check if current time is within restricted period
async function isTimeRestricted() {
  const result = await chrome.storage.local.get(['timeRestriction', 'startTime', 'endTime']);
  
  if (!result.timeRestriction) {
    console.log("Time restrictions are disabled");
    return false;
  }
  
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
  
  const startTime = result.startTime;
  const endTime = result.endTime;
  
  console.log(`Current time: ${currentTimeStr}, Restriction period: ${startTime} - ${endTime}`);
  
  if (startTime < endTime) {
    const isRestricted = currentTimeStr >= startTime && currentTimeStr < endTime;
    console.log(`Normal time range: ${isRestricted ? "RESTRICTED" : "NOT RESTRICTED"}`);
    return isRestricted;
  } else {
    const isRestricted = currentTimeStr >= startTime || currentTimeStr < endTime;
    console.log(`Overnight time range: ${isRestricted ? "RESTRICTED" : "NOT RESTRICTED"}`);
    return isRestricted;
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
    chrome.storage.local.get(['meetUrl'], function(result) {
      sendResponse({ url: result.meetUrl });
    });
    return true;
  } else if (message.action === "testTimeRestriction") {
    isTimeRestricted().then(isRestricted => {
      sendResponse({ isRestricted: isRestricted });
    });
    return true;
  }
});

// Find the specific Google Meet tab based on stored meetUrl
async function findMeetTab() {
  const result = await chrome.storage.local.get(['meetUrl']);
  const meetUrl = result.meetUrl;

  if (meetUrl) {
    const exactTabs = await chrome.tabs.query({ url: meetUrl });
    if (exactTabs.length > 0) {
      console.log("Found exact Meet tab:", exactTabs[0].url);
      return exactTabs[0];
    }
  }

  console.error("No matching Google Meet tab found for the stored URL.");
  throw new Error("No matching Google Meet tab found.");
}

// Take a screenshot of the specific Meet tab
async function takeScreenshot() {
  let currentActiveTab = null;
  try {
    const { isProcessing } = await chrome.storage.local.get(['isProcessing']);
    if (isProcessing) {
      console.log("Screenshot already in progress, skipping.");
      return;
    }

    await chrome.storage.local.set({ isProcessing: true });

    let meetTab;
    try {
      meetTab = await findMeetTab();
    } catch (error) {
      console.error("Failed to find Meet tab:", error.message);
      return;
    }

    if (!meetTab || !meetTab.windowId) {
      console.error("Error: No valid Google Meet tab available.");
      return;
    }

    [currentActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    await chrome.windows.update(meetTab.windowId, { focused: true });
    await chrome.tabs.update(meetTab.id, { active: true });

    await new Promise(resolve => setTimeout(resolve, 1000));

    chrome.tabs.captureVisibleTab(meetTab.windowId, { format: "png" }, async (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("Error capturing tab:", chrome.runtime.lastError.message);
        return;
      }

      console.log("Screenshot captured successfully.");
      try {
        await saveImage(dataUrl);
      } catch (error) {
        console.error("Error saving screenshot:", error);
      } finally {
        await chrome.storage.local.set({ isProcessing: false });
      }

      if (currentActiveTab) {
        await chrome.tabs.update(currentActiveTab.id, { active: true });
      }
    });
  } catch (error) {
    console.error("Error in takeScreenshot:", error);
    await chrome.storage.local.set({ isProcessing: false });
  }
}


// Save screenshot and send to FastAPI endpoint
async function saveImage(dataUrl) {
  const subfolder = "GoogleMeetScreenshots";
  const now = new Date();

  const dateOptions = {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  };
  const dateStr = now.toLocaleString('en-IN', dateOptions).split('/').join('-'); 

  const timeOptions = {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false 
  };
  const timeStr = now.toLocaleString('en-IN', timeOptions).replace(/:/g, '-'); 

  const imageFilename = `${subfolder}/${dateStr}/meet_screenshot_${timeStr}.png`; 

  chrome.downloads.download({
    url: dataUrl,
    filename: imageFilename,
    saveAs: false
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error("❌ Screenshot download error:", chrome.runtime.lastError);
    } else {
      console.log(`✅ Screenshot saved as ${imageFilename}`);
    }
  });

  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const formData = new FormData();
    formData.append("file", blob, `screenshot_${timeStr}.png`);

    console.log("Sending screenshot to FastAPI endpoint...");
    const apiResponse = await fetch("http://vor-monitoring.z-apps.io/analyze-screenshot", {
      method: "POST",
      body: formData
    });

    if (!apiResponse.ok) {
      throw new Error(`API request failed with status ${apiResponse.status}: ${apiResponse.statusText}`);
    }

    let data;
    try {
      data = await apiResponse.json();
      console.log("Received data from FastAPI:", data);
    } catch (jsonError) {
      console.error("Error parsing FastAPI JSON response:", jsonError);
      data = null;
    }

    if (data !== null) {
      const formattedTimestamp = `${dateStr} ${timeStr.replace(/-/g, ':')}`;
      await updateCsv(data, formattedTimestamp);
    } else {
      console.log("Skipping CSV update due to invalid FastAPI response.");
    }
  } catch (error) {
    console.error("❌ Error sending screenshot to FastAPI:", error);
    console.log("Skipping CSV update due to FastAPI error.");
  }
}

// Update Google Sheets with participant data
async function updateCsv(data, formattedTimestamp) {
  const scriptUrl = 'https://script.google.com/a/macros/zemosolabs.com/s/AKfycbz3eHEYjoOx6bEJdZVyW47ROVYsh4OQlVb_c2Kme2LesZYyjlyqjnNsPiM9C1qDdmf3/exec';  

  const breakoutRoom = data.breakout_room || "Unknown"; 
  const participantData = data.participants || null; 

  const dataToSend = participantData.map(participant => ({
    timestamp: formattedTimestamp,
    name: participant.name,
    camera_status: participant.camera_status,
    breakout_room: breakoutRoom
  }));
  
  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dataToSend),
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    console.log('Data sent successfully to Google Sheets');
  } catch (error) {
    console.error('Error sending data to Google Sheets:', error);
  }
}

// Handle extension installation or update
chrome.runtime.onInstalled.addListener(() => {
  console.log("🚀 Extension installed/updated.");

  chrome.storage.local.get(['meetUrl', 'timeRestriction', 'startTime', 'endTime'], function(result) {
    const defaults = {};
    if (result.meetUrl === undefined) defaults.meetUrl = '';
    if (result.timeRestriction === undefined) defaults.timeRestriction = false;
    if (result.startTime === undefined) defaults.startTime = '13:00';
    if (result.endTime === undefined) defaults.endTime = '15:00';
    if (Object.keys(defaults).length > 0) {
      chrome.storage.local.set(defaults, () => {
        console.log("Default settings applied/verified.");
      });
    }
  });
});
