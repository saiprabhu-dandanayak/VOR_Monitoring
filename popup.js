let healthCheckInterval;

document.addEventListener('DOMContentLoaded', function() {
  console.log("Popup loaded");
  

  initializePopup();
  

  setupEventListeners();
  

  startHealthCheck();
});

async function initializePopup() {
  try {

    const isHealthy = await checkExtensionHealth();
    
    if (!isHealthy) {
      showStatus('Extension may need to be reloaded', 'warning');
      showReloadButton();
    }
    

    await loadSettings();
    

    await showCurrentStatus();
    
  } catch (error) {
    console.error("Error initializing popup:", error);
    showStatus('Extension initialization failed', 'error');
    showReloadButton();
  }
}

function setupEventListeners() {
  const elements = {
    updateBtn: document.getElementById('updateBtn'),
    captureNowBtn: document.getElementById('captureNowBtn'),
    saveScheduleBtn: document.getElementById('saveScheduleBtn'),
    reloadBtn: document.getElementById('reloadBtn'),
    healthCheckBtn: document.getElementById('healthCheckBtn')
  };
  

  if (elements.updateBtn) {
    elements.updateBtn.addEventListener('click', updateMeetUrl);
  }
  
  if (elements.captureNowBtn) {
    elements.captureNowBtn.addEventListener('click', captureNow);
  }
  
  if (elements.saveScheduleBtn) {
    elements.saveScheduleBtn.addEventListener('click', saveSchedule);
  }
  
  if (elements.reloadBtn) {
    elements.reloadBtn.addEventListener('click', reloadExtension);
  }
  
  if (elements.healthCheckBtn) {
    elements.healthCheckBtn.addEventListener('click', performHealthCheck);
  }
}

async function checkExtensionHealth() {
  try {
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Health check timeout'));
      }, 5000);
      
      chrome.runtime.sendMessage({ action: "ping" }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
    
    return response && response.status === "alive";
  } catch (error) {
    console.error("Health check failed:", error);
    return false;
  }
}

function startHealthCheck() {
  healthCheckInterval = setInterval(async () => {
    const isHealthy = await checkExtensionHealth();
    updateHealthIndicator(isHealthy);
  }, 30000);
}

function updateHealthIndicator(isHealthy) {
  const indicator = document.getElementById('healthIndicator');
  if (indicator) {
    indicator.textContent = isHealthy ? '🟢 Active' : '🔴 Issues';
    indicator.className = isHealthy ? 'health-good' : 'health-bad';
  }
}

async function loadSettings() {
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.local.get(['meetUrl', 'timeRestriction', 'startTime', 'endTime'], function(result) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });
    

    const urlDisplay = document.getElementById('current-url-display');
    const meetUrlInput = document.getElementById('meetUrl');
    
    if (urlDisplay && meetUrlInput) {
      if (result.meetUrl) {
        urlDisplay.textContent = result.meetUrl;
        meetUrlInput.value = result.meetUrl;
      } else {
        urlDisplay.textContent = "No URL set";
      }
    }
    

    const enableTimeRestriction = document.getElementById('enableTimeRestriction');
    const startTime = document.getElementById('startTime');
    const endTime = document.getElementById('endTime');
    
    if (enableTimeRestriction) {
      enableTimeRestriction.checked = result.timeRestriction || false;
    }
    
    if (startTime) {
      startTime.value = result.startTime || '13:00';
    }
    
    if (endTime) {
      endTime.value = result.endTime || '15:00';
    }
    
  } catch (error) {
    console.error("Error loading settings:", error);
    showStatus('Failed to load settings', 'error');
  }
}

async function showCurrentStatus() {
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "testTimeRestriction" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
    
    const statusIndicator = document.getElementById('currentStatus');
    if (statusIndicator) {
      if (response && response.isRestricted !== undefined) {
        statusIndicator.textContent = response.isRestricted ? 
          '🔴 Screenshots Currently Restricted' : 
          '🟢 Screenshots Currently Active';
        statusIndicator.className = response.isRestricted ? 'status-restricted' : 'status-active';
      } else {
        statusIndicator.textContent = '⚠️ Status Unknown';
        statusIndicator.className = 'status-unknown';
      }
    }
  } catch (error) {
    console.error("Error checking current status:", error);
    const statusIndicator = document.getElementById('currentStatus');
    if (statusIndicator) {
      statusIndicator.textContent = '❌ Status Check Failed';
      statusIndicator.className = 'status-error';
    }
  }
}

async function updateMeetUrl() {
  const urlInput = document.getElementById('meetUrl');
  const updateBtn = document.getElementById('updateBtn');
  
  if (!urlInput || !updateBtn) return;
  
  const url = urlInput.value.trim();
  
  if (!url) {
    showStatus('Please enter a valid Google Meet URL', 'error');
    return;
  }
  
  if (!url.includes('meet.google.com')) {
    showStatus('URL must be from meet.google.com', 'error');
    return;
  }
  

  updateBtn.disabled = true;
  updateBtn.textContent = 'Updating...';
  
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "updateMeetUrl", url: url },
        function(response) {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        }
      );
    });
    
    if (response && response.success) {
      const urlDisplay = document.getElementById('current-url-display');
      if (urlDisplay) {
        urlDisplay.textContent = url;
      }
      showStatus('Meeting URL updated successfully!', 'success');
    } else {
      showStatus(response?.error || 'Failed to update URL', 'error');
    }
  } catch (error) {
    console.error("Error updating URL:", error);
    showStatus('Failed to update URL', 'error');
  } finally {
    updateBtn.disabled = false;
    updateBtn.textContent = 'Update URL';
  }
}

async function captureNow() {
  const captureBtn = document.getElementById('captureNowBtn');
  
  if (!captureBtn) return;
  
  captureBtn.disabled = true;
  captureBtn.textContent = 'Capturing...';
  
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "takeScreenshotNow" }, function(response) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
    
    if (response && response.success) {
      showStatus('Screenshot capture initiated', 'success');
      setTimeout(() => {
        window.close(); 
      }, 1000);
    } else {
      showStatus(response?.error || 'Failed to initiate screenshot', 'error');
    }
  } catch (error) {
    console.error("Error capturing screenshot:", error);
    showStatus('Failed to initiate screenshot', 'error');
  } finally {
    captureBtn.disabled = false;
    captureBtn.textContent = 'Capture Now';
  }
}

async function saveSchedule() {
  const saveBtn = document.getElementById('saveScheduleBtn');
  const enableTimeRestriction = document.getElementById('enableTimeRestriction');
  const startTime = document.getElementById('startTime');
  const endTime = document.getElementById('endTime');
  
  if (!saveBtn || !enableTimeRestriction || !startTime || !endTime) return;
  
  const timeRestriction = enableTimeRestriction.checked;
  const startTimeValue = startTime.value;
  const endTimeValue = endTime.value;
  
  if (startTimeValue === endTimeValue) {
    showStatus('Start and end times cannot be the same', 'error');
    return;
  }
  
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  
  try {
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({
        timeRestriction: timeRestriction,
        startTime: startTimeValue,
        endTime: endTimeValue
      }, function() {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
    
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "testTimeRestriction" }, function(response) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
    
    if (response && response.isRestricted !== undefined) {
      const status = response.isRestricted ? 
        'Schedule saved! Screenshots are currently RESTRICTED' : 
        'Schedule saved! Screenshots are currently ALLOWED';
      showStatus(status, 'success');
    } else {
      showStatus('Schedule saved successfully!', 'success');
    }
    

    await showCurrentStatus();
    
  } catch (error) {
    console.error("Error saving schedule:", error);
    showStatus('Failed to save schedule', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Schedule';
  }
}

async function performHealthCheck() {
  const healthBtn = document.getElementById('healthCheckBtn');
  
  if (healthBtn) {
    healthBtn.disabled = true;
    healthBtn.textContent = 'Checking...';
  }
  
  try {
    const isHealthy = await checkExtensionHealth();
    
    if (isHealthy) {
      showStatus('Extension is working correctly', 'success');
      updateHealthIndicator(true);
    } else {
      showStatus('Extension has issues - consider reloading', 'warning');
      updateHealthIndicator(false);
      showReloadButton();
    }
  } catch (error) {
    console.error("Health check error:", error);
    showStatus('Health check failed', 'error');
    updateHealthIndicator(false);
    showReloadButton();
  } finally {
    if (healthBtn) {
      healthBtn.disabled = false;
      healthBtn.textContent = 'Check Health';
    }
  }
}

function showReloadButton() {
  const reloadBtn = document.getElementById('reloadBtn');
  if (reloadBtn) {
    reloadBtn.style.display = 'block';
  }
}

function reloadExtension() {
  chrome.runtime.reload();
}

function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  const statusTextEl = document.getElementById('statusText');
  
  if (!statusEl || !statusTextEl) return;
  
  statusTextEl.textContent = message;
  statusEl.className = 'status ' + type;
  statusEl.style.display = 'flex';
  
  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 5000); 
}

window.addEventListener('beforeunload', function() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
});