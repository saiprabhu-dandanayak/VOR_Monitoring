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

chrome.alarms.create("takeScreenshot", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "takeScreenshot") {
    const isRestricted = await isTimeRestricted();
    if (!isRestricted) {
      console.log("Taking scheduled screenshot");
      await takeScreenshot();
    } else {
      console.log("Screenshot skipped due to time restrictions");
    }
  }
});

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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('meet.google.com')) {
    const meetingCodeMatch = tab.url.match(/meet\.google\.com\/([a-z0-9-]+)/i);
    if (meetingCodeMatch && meetingCodeMatch[1].split('-').length === 3) {
      chrome.storage.local.set({ meetUrl: tab.url });
      console.log("Automatically detected and saved Meet URL:", tab.url);
    }
  }
});

async function findMeetTab() {
  const result = await chrome.storage.local.get(['meetUrl']);
  const meetUrl = result.meetUrl;
  
  if (meetUrl) {
    const exactTabs = await chrome.tabs.query({ url: meetUrl });
    if (exactTabs.length > 0) {
      console.log("Found exact Meet tab:", exactTabs[0].url);
      return exactTabs[0];
    }
    
    const urlWithoutParams = meetUrl.split('?')[0];
    const flexibleTabs = await chrome.tabs.query({ url: urlWithoutParams + '*' });
    if (flexibleTabs.length > 0) {
      console.log("Found flexible Meet tab:", flexibleTabs[0].url);
      return flexibleTabs[0];
    }
  }
  
  const meetTabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
  if (meetTabs.length > 0) {
    chrome.storage.local.set({ meetUrl: meetTabs[0].url });
    console.log("Found generic Meet tab and saved URL:", meetTabs[0].url);
    return meetTabs[0];
  }
  
  console.error("No Google Meet tab found.");
  throw new Error("No Google Meet tab found.");
}

async function takeScreenshot() {
  try {
    const { isProcessing } = await chrome.storage.local.get(['isProcessing']);
    if (isProcessing) {
      console.log("Screenshot already in progress, skipping.");
      return;
    }

    await chrome.storage.local.set({ isProcessing: true });

    const meetTab = await findMeetTab();
    if (!meetTab || !meetTab.windowId) {
      console.error("Error: No valid Google Meet tab found.");
      return;
    }

    const [currentActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    await chrome.windows.update(meetTab.windowId, { focused: true });
    await chrome.tabs.update(meetTab.id, { active: true });

    await new Promise(resolve => setTimeout(resolve, 500));

    chrome.tabs.captureVisibleTab(meetTab.windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("Error capturing tab:", chrome.runtime.lastError.message);
        chrome.storage.local.set({ isProcessing: false });
        return;
      }
      console.log("Screenshot captured successfully.");
      saveImage(dataUrl).finally(() => {
        chrome.storage.local.set({ isProcessing: false });
      });
    });

    if (currentActiveTab) {
      await chrome.tabs.update(currentActiveTab.id, { active: true });
    }
  } catch (error) {
    console.error("Error in takeScreenshot:", error);
    await chrome.storage.local.set({ isProcessing: false });
  }
}

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

    let participants;
    try {
      participants = await apiResponse.json();
      console.log("Received participants data from FastAPI:", participants);
    } catch (jsonError) {
      console.error("Error parsing FastAPI JSON response:", jsonError);
      participants = null;
    }

    if (participants !== null) {
      await updateCsv(participants, `${dateStr}_${timeStr}`); 
    } else {
      console.log("Skipping CSV update due to invalid FastAPI response.");
    }
  } catch (error) {
    console.error("❌ Error sending screenshot to FastAPI:", error);
    console.log("Skipping CSV update due to FastAPI error.");
  }
}

async function updateCsv(participants, timestamp) {
  const subfolder = "GoogleMeetScreenshots";
  const [dateStr, timeStr] = timestamp.split('_'); 
  const csvFilename = `${subfolder}/${dateStr}/participants_data.csv`; 

  console.log("Updating CSV with participants:", participants);

  const result = await chrome.storage.local.get(['csvContent']);
  let csvContent = result.csvContent || "Timestamp,Name,Camera_Status\n";

  if (Array.isArray(participants) && participants.length > 0) {
    participants.forEach(participant => {
      if (participant && typeof participant === 'object' && 'name' in participant && 'camera_status' in participant) {
        const name = participant.name ? participant.name.replace(/"/g, '""') : '';
        const cameraStatus = participant.camera_status && ['ON', 'OFF', 'UNKNOWN'].includes(participant.camera_status) ? participant.camera_status : '';
        csvContent += `"${dateStr} ${timeStr.replace(/-/g, ':')}","${name}","${cameraStatus}"\n`;
      } else {
        console.warn("Invalid participant data, skipping:", participant);
      }
    });
  } else {
    console.log("No valid participants, skipping CSV update.");
    return;
  }

  try {
    await chrome.storage.local.set({ csvContent });
    console.log("CSV content saved to chrome.storage.local");
  } catch (error) {
    console.error("Error saving CSV content to storage:", error);
    return;
  }

  const csvBase64 = btoa(csvContent);
  const csvDataUrl = `data:text/csv;base64,${csvBase64}`;

  let retryCount = 0;
  const maxRetries = 3;

  async function attemptDownload() {
    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: csvDataUrl,
        filename: csvFilename,
        saveAs: false,
        conflictAction: "overwrite"
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error(`❌ CSV download error (attempt ${retryCount + 1}):`, chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          console.log(`✅ CSV saved as ${csvFilename}`);
          resolve();
        }
      });
    });
  }

  while (retryCount < maxRetries) {
    try {
      await attemptDownload();
      break;
    } catch (error) {
      retryCount++;
      if (retryCount === maxRetries) {
        console.error(`Failed to download CSV after ${maxRetries} attempts`);
        break;
      }
      console.log(`Retrying CSV download (attempt ${retryCount + 1})...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("🚀 Extension installed.");
});