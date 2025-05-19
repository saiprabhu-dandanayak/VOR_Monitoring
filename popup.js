document.addEventListener('DOMContentLoaded', function() {
  loadSettings();
  document.getElementById('updateBtn').addEventListener('click', updateMeetUrl);
  document.getElementById('captureNowBtn').addEventListener('click', captureNow);
  document.getElementById('saveScheduleBtn').addEventListener('click', saveSchedule);
});

function loadSettings() {
  chrome.storage.local.get(['meetUrl', 'timeRestriction', 'startTime', 'endTime'], function(result) {
    if (result.meetUrl) {
      document.getElementById('current-url-display').textContent = result.meetUrl;
      document.getElementById('meetUrl').value = result.meetUrl;
    } else {
      document.getElementById('current-url-display').textContent = "No URL set";
    }
    
    const enableTimeRestriction = document.getElementById('enableTimeRestriction');
    const startTime = document.getElementById('startTime');
    const endTime = document.getElementById('endTime');
    
    enableTimeRestriction.checked = result.timeRestriction || false;
    
    if (result.startTime) {
      startTime.value = result.startTime;
    } else {
      startTime.value = '13:00'; 
    }
    
    if (result.endTime) {
      endTime.value = result.endTime;
    } else {
      endTime.value = '15:00'; 
    }
  });
}

function updateMeetUrl() {
  const url = document.getElementById('meetUrl').value.trim();
  
  if (!url) {
    showStatus('Please enter a valid Google Meet URL', 'error');
    return;
  }
  
  if (!url.includes('meet.google.com')) {
    showStatus('URL must be from meet.google.com', 'error');
    return;
  }
  
  chrome.runtime.sendMessage(
    { action: "updateMeetUrl", url: url },
    function(response) {
      if (response && response.success) {
        document.getElementById('current-url-display').textContent = url;
        showStatus('Meeting URL updated successfully!', 'success');
      } else {
        showStatus('Failed to update URL', 'error');
      }
    }
  );
}

function captureNow() {
  chrome.runtime.sendMessage({ action: "takeScreenshotNow" }, function(response) {
    if (response && response.success) {
      showStatus('Screenshot capture initiated', 'success');
      window.close(); // Close the popup
    } else {
      showStatus('Failed to initiate screenshot', 'error');
    }
  });
}

function saveSchedule() {
  const enableTimeRestriction = document.getElementById('enableTimeRestriction').checked;
  const startTime = document.getElementById('startTime').value;
  const endTime = document.getElementById('endTime').value;
  
  if (startTime === endTime) {
    showStatus('Start and end times cannot be the same', 'error');
    return;
  }
  
  chrome.storage.local.set({
    timeRestriction: enableTimeRestriction,
    startTime: startTime,
    endTime: endTime
  }, function() {
    chrome.runtime.sendMessage({ action: "testTimeRestriction" }, function(response) {
      if (response) {
        const status = response.isRestricted ? 
          'Schedule saved! Screenshots are currently RESTRICTED' : 
          'Schedule saved! Screenshots are currently ALLOWED';
        showStatus(status, 'success');
      } else {
        showStatus('Schedule saved successfully!', 'success');
      }
    });
  });
}

function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  const statusTextEl = document.getElementById('statusText');
  
  statusTextEl.textContent = message;
  statusEl.className = 'status ' + type;
  statusEl.style.display = 'flex';
  
  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 5000); 
}