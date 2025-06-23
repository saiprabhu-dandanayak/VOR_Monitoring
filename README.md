### VOR Monitoring Extension 
This Chrome extension helps automate the process of capturing attendance from Google Meet breakout rooms and logging the data to a connected Google Spreadsheet using Google Apps Script.

### 🚀 Features

Capture participant metadata like timestamp, name, camera status, and breakout room name
Log attendance in a structured format to Google Sheets
Auto-create sheets based on date and breakout room
Optional time restriction-based screenshot scheduling


### 🛠️ Setup Instructions
1. Clone the Repository
```bash
git clone https://github.com/saiprabhu-dandanayak/VOR_Monitoring.git
```

2. Setup Google Apps Script

Go to Google Apps Script.
Create a new project.
Replace the default content with the following script:


```bash
function doPost(e) {
  try {
    console.log('--- Received POST Request ---');
    var rawData = e.postData.contents;
    console.log('Received raw data:', rawData);

    var data;
    try {
      data = JSON.parse(rawData);
      console.log('Successfully parsed JSON data.');
    } catch (parseError) {
      console.error('Error parsing JSON:', parseError.message, parseError);
      return ContentService.createTextOutput('Error: Invalid JSON received. ' + parseError.message)
             .setMimeType(ContentService.MimeType.TEXT);
    }

    if (!Array.isArray(data) || data.length === 0) {
      console.log('Received empty or non-array data:', data);
      return ContentService.createTextOutput('No data to process (empty or non-array).').setMimeType(ContentService.MimeType.TEXT);
    }
    console.log('Received array data with length:', data.length);

    var firstItem = data[0];
    if (!firstItem || !firstItem.timestamp || !firstItem.breakout_room) {
      console.error('First data item is missing or missing required properties:', firstItem);
      return ContentService.createTextOutput('Error: First item is missing or missing "timestamp" or "breakout_room".').setMimeType(ContentService.MimeType.TEXT);
    }
    var timestamp = firstItem.timestamp;
    var breakoutRoom = firstItem.breakout_room;
    console.log('Extracted timestamp:', timestamp, 'Breakout Room:', breakoutRoom);

    var datePartFromTimestamp = timestamp.split(' ')[0];
    console.log('Extracted date part (from timestamp):', datePartFromTimestamp);

    if (!/^\d{2}[-\/]\d{2}[-\/]\d{4}$/.test(datePartFromTimestamp)) {
      console.error('Invalid date format detected in extracted date part:', datePartFromTimestamp);
      return ContentService.createTextOutput('Error: Invalid date format in timestamp date part. Expected DD-MM-YYYY or DD/MM/YYYY.').setMimeType(ContentService.MimeType.TEXT);
    }
    var datePart = datePartFromTimestamp.replace(/-/g, '/');
    var sheetName = datePart + '_' + breakoutRoom.replace(/[^a-zA-Z0-9]/g, '_');
    console.log('Determined sheet name:', sheetName);

    var spreadsheetId = '1TzrmHe1WlveQ3AZ3fnKi8QyS913jPk-azHNZsQ2F61Y';
    console.log('Using spreadsheet ID:', spreadsheetId);

    var spreadsheet;
    try {
      spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      console.log('Opened spreadsheet with ID:', spreadsheetId);
    } catch (openError) {
      console.error('Error opening spreadsheet with ID ' + spreadsheetId + ':', openError.message, openError);
      return ContentService.createTextOutput('Error: Failed to open spreadsheet with ID ' + spreadsheetId).setMimeType(ContentService.MimeType.TEXT);
    }

    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      console.log('Sheet "' + sheetName + '" not found. Creating new sheet...');
      try {
        sheet = spreadsheet.insertSheet(sheetName);
        console.log('New sheet "' + sheetName + '" created successfully.');
        sheet.appendRow(['Timestamp', 'Name', 'Camera_Status', 'Breakout_Room']);
        console.log('Header row added to new sheet.');
      } catch (createSheetError) {
        console.error('Error creating sheet "' + sheetName + '":', createSheetError.message, createSheetError);
        return ContentService.createTextOutput('Error creating sheet: ' + createSheetError.message)
               .setMimeType(ContentService.MimeType.TEXT);
      }
    } else {
      console.log('Sheet "' + sheetName + '" found.');
      if (sheet.getLastRow() === 0 || sheet.getRange('A1').getValue() !== 'Timestamp') {
        console.log('Existing sheet is empty or missing header. Adding header row.');
        sheet.appendRow(['Timestamp', 'Name', 'Camera_Status', 'Breakout_Room']);
      } else {
        console.log('Existing sheet has data and header.');
      }
    }

    if (!sheet) {
      console.error('Sheet object is null after get or create attempt.');
      return ContentService.createTextOutput('Error: Failed to get or create target sheet.')
             .setMimeType(ContentService.MimeType.TEXT);
    }

    console.log('Preparing rows for appending...');
    var rowsToAppend = [];
    var skippedRows = 0;

    data.forEach(function(row, index) {
      if (row && typeof row === 'object' && 'timestamp' in row && 'name' in row && 'camera_status' in row && 'breakout_room' in row) {
        rowsToAppend.push([row.timestamp, row.name, row.camera_status, row.breakout_room]);
      } else {
        console.warn('Skipping invalid row data at index ' + index + ':', row);
        skippedRows++;
      }
    });

    if (rowsToAppend.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      if (sheet.getLastRow() > 1) {
        startRow += 1;
        console.log('Leaving one empty row before appending new data.');
      }
      var numRows = rowsToAppend.length;
      var numCols = rowsToAppend[0].length;

      console.log('Attempting to append ' + numRows + ' rows starting at row ' + startRow + '...');
      try {
        sheet.getRange(startRow, 1, numRows, numCols).setValues(rowsToAppend);
        console.log('Successfully appended ' + numRows + ' rows.');
      } catch (appendError) {
        console.error('Error during batch append:', appendError.message, appendError);
        return ContentService.createTextOutput('Error appending rows: ' + appendError.message)
               .setMimeType(ContentService.MimeType.TEXT);
      }
    } else {
      console.log('No valid rows to append after validation.');
    }

    if (skippedRows > 0) {
      console.warn('Skipped ' + skippedRows + ' invalid rows in the input data.');
    }

    console.log('--- POST Request Processed Successfully ---');
    return ContentService.createTextOutput('Data added successfully to sheet "' + sheetName + '" in spreadsheet (' + rowsToAppend.length + ' rows appended).')
           .setMimeType(ContentService.MimeType.TEXT);

  } catch (err) {
    console.error('Critical Error in doPost:', err.message, err);
    return ContentService.createTextOutput('An unexpected error occurred: ' + err.message)
           .setMimeType(ContentService.MimeType.TEXT);
  }
}
```

### 3. Deploy as Web App

Click Deploy > Manage deployments.
Click + New Deployment.
Under Select type, choose Web App.
Fill in:
Description: VOR Data Logger
Execute As: Me
Who has access: Anyone (or Anyone within Zemoso)


Click Deploy and copy the Web App URL.

### 4. Update the Extension with Script URL

Open background.js in the cloned repo.
Replace the scriptURL in updateCSV with your deployed Apps Script URL:

const scriptURL = '<YOUR_SCRIPT_URL_HERE>';

### 5. Load the Extension in Chrome

Open chrome://extensions/.
Enable Developer Mode.
Click Load unpacked.
Select the folder you cloned.
Pin the extension from the extensions toolbar.

### 6. Use the Extension

Click the extension icon.
Paste your Google Meet link in the Meet URL field.
(Optional) Enable Time Restriction and set Start/End Time.
Click Save Schedule.
Click Capture Now to send data.


### 🧪 Google Sheets Format
For each breakout session and date, a sheet is created named:
DD/MM/YYYY_BreakoutRoomName

Each sheet has the following columns:
Timestamp    Name    Camera_Status    Breakout_Room

