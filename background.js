let keepAliveInterval;

function startKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {

      if (chrome.runtime.lastError) {
        console.log('Keep-alive ping failed:', chrome.runtime.lastError);
      }
    });
  }, 25000);
}


async function initializeExtension() {
  console.log("🚀 Extension initializing...");
  
  try {

    await chrome.alarms.clearAll();
    await initializeSettings();
    chrome.alarms.create("takeScreenshot", { periodInMinutes: 1 });
  
    startKeepAlive();
    console.log("✅ Extension initialized successfully");
  } catch (error) {
    console.error("❌ Extension initialization failed:", error);
    setTimeout(initializeExtension, 30000);
  }
}


async function initializeSettings() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['meetUrl', 'timeRestriction', 'startTime', 'endTime'], function(result) {
      if (chrome.runtime.lastError) {
        console.error("Storage read error:", chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
        return;
      }
      
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
        chrome.storage.local.set(defaults, function() {
          if (chrome.runtime.lastError) {
            console.error("Storage write error:", chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else {
            console.log("Default settings applied:", defaults);
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  });
}


chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "takeScreenshot") {
    try {
      const isRestricted = await isTimeRestricted();
      const now = new Date();
      const currentHour = now.getHours();
      const isAfterHardStopTime = currentHour >= 18;
      
      if (!isRestricted && !isAfterHardStopTime) {
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
    } catch (error) {
      console.error("Error in alarm handler:", error);

      if (!await chrome.alarms.get("takeScreenshot")) {
        console.log("Recreating missing alarm...");
        chrome.alarms.create("takeScreenshot", { periodInMinutes: 1 });
      }
    }
  }
});


async function isTimeRestricted() {
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.local.get(['timeRestriction', 'startTime', 'endTime'], function(result) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });
    
    if (!result.timeRestriction) {
      console.log("Time restrictions are disabled");
      return false;
    }
    
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
    
    const startTime = result.startTime || '13:00';
    const endTime = result.endTime || '15:00';
    
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
  } catch (error) {
    console.error("Error checking time restrictions:", error);
    return false;
  }
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.action === "updateMeetUrl") {
      chrome.storage.local.set({ meetUrl: message.url }, function() {
        if (chrome.runtime.lastError) {
          console.error("Error updating Meet URL:", chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log("Updated Meet URL to:", message.url);
          sendResponse({ success: true });
        }
      });
      return true;
    } 
    
    else if (message.action === "takeScreenshotNow") {
      console.log("Manual screenshot requested");
      takeScreenshot()
        .then(() => sendResponse({ success: true }))
        .catch(error => {
          console.error("Manual screenshot failed:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true; 
    } 
    
    else if (message.action === "getMeetUrl") {
      chrome.storage.local.get(['meetUrl'], function(result) {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ url: result.meetUrl });
        }
      });
      return true; 
    } 
    
    else if (message.action === "testTimeRestriction") {
      isTimeRestricted()
        .then(isRestricted => sendResponse({ isRestricted: isRestricted }))
        .catch(error => sendResponse({ error: error.message }));
      return true; 
    }
    
    else if (message.action === "ping") {

      sendResponse({ status: "alive", timestamp: Date.now() });
    }
  } catch (error) {
    console.error("Error in message handler:", error);
    sendResponse({ success: false, error: error.message });
  }
});


async function findMeetTab() {
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.local.get(['meetUrl'], function(result) {
        if (chrome.runtime.lastError) {
          console.error("Storage error while fetching Meet URL:", chrome.runtime.lastError);
          resolve(null);
        } else {
          resolve(result);
        }
      });
    });

    const meetUrl = result?.meetUrl;
    if (!meetUrl) {
      console.warn("No Meet URL configured");
      return null;
    }

    const match = meetUrl.match(/meet\.google\.com\/([a-zA-Z0-9\-]+)/);
    const meetingCode = match ? match[1] : null;

    if (!meetingCode) {
      console.warn("Could not extract meeting code from URL");
      return null;
    }

    const meetTabs = await chrome.tabs.query({ url: "*://meet.google.com/*" });
    const matchingTab = meetTabs.find(tab => tab.url.includes(meetingCode));

    if (matchingTab) {
      console.log("Found Google Meet tab (by meeting code):", matchingTab.url);
      return matchingTab;
    }

    console.warn("No Google Meet tab open for configured meeting code");
    return null;
  } catch (error) {
    console.error("Unexpected error in findMeetTab:", error);
    return null;
  }
}

async function takeScreenshot() {
  let currentActiveTab = null;
  let processingLock = false;

  try {
    const { isProcessing } = await chrome.storage.local.get(['isProcessing']);
    if (isProcessing) {
      console.log("Screenshot already in progress, skipping.");
      return;
    }

    await chrome.storage.local.set({ isProcessing: true });
    processingLock = true;


    const meetTab = await findMeetTab();

    if (!meetTab || !meetTab.windowId) {
      console.warn("No active Google Meet tab found for configured meeting. Skipping screenshot.");
      return;
    }

    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTabs.length > 0) {
      currentActiveTab = activeTabs[0];
    }


    await chrome.windows.update(meetTab.windowId, { focused: true });
    await chrome.tabs.update(meetTab.id, { active: true });
    await new Promise(resolve => setTimeout(resolve, 1000)); 

    const dataUrl = await new Promise((resolve) => {
      chrome.tabs.captureVisibleTab(meetTab.windowId, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          console.error("Capture failed:", chrome.runtime.lastError);
          resolve(null);
        } else {
          resolve(dataUrl);
        }
      });
    });

    if (!dataUrl) {
      console.warn("No screenshot captured. Skipping save.");
      return;
    }

    console.log("Screenshot captured successfully.");
    await saveImage(dataUrl);

  } catch (error) {
    console.error("Error in takeScreenshot:", error);
  } finally {
    if (processingLock) {
      await chrome.storage.local.set({ isProcessing: false });
    }

    if (currentActiveTab) {
      try {
        await chrome.tabs.update(currentActiveTab.id, { active: true });
      } catch (restoreError) {
        console.error("Failed to restore active tab:", restoreError);
      }
    }
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


  try {
    await new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: dataUrl,
        filename: imageFilename,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          console.log(`✅ Screenshot saved as ${imageFilename}`);
          resolve(downloadId);
        }
      });
    });
  } catch (error) {
    console.error("❌ Screenshot download error:", error);
  }


  const maxRetries = 3;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const formData = new FormData();
      formData.append("file", blob, `screenshot_${timeStr}.png`);

      console.log(`Sending screenshot to FastAPI endpoint... (attempt ${retryCount + 1})`);
      
      const apiResponse = await fetch("http://vor-monitoring.z-apps.io/analyze-screenshot", {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(30000) 
      });

      if (!apiResponse.ok) {
        throw new Error(`API request failed with status ${apiResponse.status}: ${apiResponse.statusText}`);
      }

      const data = await apiResponse.json();
      console.log("Received data from FastAPI:", data);

      const formattedTimestamp = `${dateStr} ${timeStr.replace(/-/g, ':')}`;
      await updateCsv(data, formattedTimestamp);
      
      break; 
      
    } catch (error) {
      retryCount++;
      console.error(`❌ Error sending screenshot to FastAPI (attempt ${retryCount}):`, error);
      
      if (retryCount < maxRetries) {
        console.log(`Retrying in ${retryCount * 5} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryCount * 5000));
      } else {
        console.log("Max retries reached. Skipping CSV update.");
      }
    }
  }
}


async function updateCsv(data, formattedTimestamp) {
  const scriptUrl = 'https://script.google.com/a/macros/zemosolabs.com/s/AKfycbz3eHEYjoOx6bEJdZVyW47ROVYsh4OQlVb_c2Kme2LesZYyjlyqjnNsPiM9C1qDdmf3/exec';  

  try {
    const breakoutRoom = data.breakout_room || "Unknown"; 
    const participantData = data.participants || []; 

    if (!Array.isArray(participantData) || participantData.length === 0) {
      console.log("No participant data to send to Google Sheets");
      return;
    }

    const dataToSend = participantData.map(participant => ({
      timestamp: formattedTimestamp,
      name: participant.name || "Unknown",
      camera_status: participant.camera_status || "Unknown",
      breakout_room: breakoutRoom
    }));
    
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dataToSend),
      credentials: 'include',
      signal: AbortSignal.timeout(15000) 
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    console.log('Data sent successfully to Google Sheets');
  } catch (error) {
    console.error('Error sending data to Google Sheets:', error);
    throw error;
  }
}


chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("🚀 Extension installed/updated.", details);
  await initializeExtension();
});


chrome.runtime.onStartup.addListener(async () => {
  console.log("🔄 Extension starting up...");
  await initializeExtension();
});


chrome.runtime.onSuspend.addListener(() => {
  console.log("⏸️ Extension suspending...");
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
});


initializeExtension();