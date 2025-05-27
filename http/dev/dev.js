var socket = io();
var playerState = {};
var timeLastStateUpdate = 0;
var timerPlayback = null;
var libraryHistory = new Array();
var playlistHistory = new Array();
var nLibraryHistoryPosition = 0;
var nPlaylistHistoryPosition = 0;

// Define button actions --------------------------------------------
document.getElementById('button-plugintesttrue').onclick = function () { socket.emit('callMethod', {endpoint: 'system_controller/system', method: 'setTestPlugins', data: 'true'}); };
document.getElementById('button-plugintestfalse').onclick = function () { socket.emit('callMethod', {endpoint: 'system_controller/system', method: 'setTestPlugins', data: 'false'}); };
document.getElementById('button-sshenable').onclick = function () { socket.emit('callMethod', {endpoint: 'system_controller/system', method: 'enableSSH', data: 'true'}); };
document.getElementById('button-sshdisable').onclick = function () { socket.emit('callMethod', {endpoint: 'system_controller/system', method: 'enableSSH', data: 'false'}); };
document.getElementById('button-livelog-enable').onclick = function () { socket.emit('callMethod', {endpoint: 'system_controller/system', method: 'enableLiveLog', data: 'true'}); };
document.getElementById('button-livelog-disable').onclick = function () { socket.emit('callMethod', {endpoint: 'system_controller/system', method: 'enableLiveLog', data: 'false'}); };
document.getElementById('button-clearconsole').onclick = function() { clearConsole()};
document.getElementById('button-serial-monitor-enable').onclick = function () { socket.emit('callMethod', {endpoint: 'music_service/inputs', method: 'serialMonitorAction', data: {action: 'start'}}); };
document.getElementById('button-serial-monitor-disable').onclick = function () { socket.emit('callMethod', {endpoint: 'music_service/inputs', method: 'serialMonitorAction', data: {action: 'start'}}); };
document.getElementById('button-clearserialconsole').onclick = function() { clearSerialConsole()};
document.getElementById('enable-display-a').onclick = function () { socket.emit('callMethod', {endpoint: 'system_controller/motivocontrol', method: 'displaySelection', data: {action: 'enable-display-a'}}); };
document.getElementById('enable-display-b').onclick = function () { socket.emit('callMethod', {endpoint: 'system_controller/motivocontrol', method: 'displaySelection', data: {action: 'enable-display-b'}}); };

// Create listeners for websocket events--------------------------------
socket.on('connect', function () {
  enableControls();
  // updateLibraryHistoryButtons();

  // Get the state upon load
  emitEvent('getState', '');

  // Get the play queue
  emitEvent('getQueue', '');

  // Get the HW UUID
  socket.emit('getDeviceHWUUID', '');

  // Get the current updater channel
  socket.emit('getUpdaterChannel', '');

  // Get if serial communication is active on the system
  socket.emit('callMethod', {endpoint: 'music_service/inputs', method: 'serialMonitorAction', data: {action: 'get'}});

  // Get if Display Selection Is available
  socket.emit('callMethod', {endpoint: 'system_controller/motivocontrol', method: 'displaySelection', data: {action: 'get'}});

  // Request the music library root
  // emitEvent('getLibraryFilters', 'root');

  // emitEvent('getPlaylistIndex', 'root');
});

socket.on('disconnect', function () {
  libraryHistory = new Array();
  nLibraryHistoryPosition = 0;
  playlistHistory = new Array();
  nPlaylistHistoryPosition = 0;
  clearPlayQueue();
  // clearBrowseView();
  // clearPlaylistView();
  clearPlayerStateDisplay();
});

socket.on('pushState', function (state) {
  playerState = state;
  timeLastStateUpdate = Date.now();
  updatePlayerStateDisplay();

  if (state.status === 'play') {
    startPlaybackTimer(state.seek);
  } else {
  }
});

socket.on('pushQueue', function (arrayQueue) {
  updatePlayerQueue(arrayQueue);
});

socket.on('pushSendBugReport', function (data) {
  // defensive: make sure data has no junk prefixed or suffixed
  var str = data;
  str = str.replace('^[^{]*{', '{');
  str = str.replace('}[^{]*$', '}');
  var json = JSON.parse(data);
  document.getElementById('bug-form-description').value = json.link;
  var btn = document.getElementById('bug-form-button');
  document.getElementById('bug-form-button').style.display = 'none';
  document.getElementById('copy-button').style.display = 'inline';
  document.getElementById('log-message').innerHTML = 'Log successfully sent, this is the link to your log file';
});

socket.on('pushDeviceHWUUID', function (data) {
  document.getElementById('hwuuid-text').value = data;
  document.getElementById('hwuuid-copy-button').style.display = 'inline';
});


socket.on('LLogOpen',data => {
  document.getElementById('console').innerHTML += data.message;
})
socket.on('LLogProgress',data => {
  document.getElementById('console').innerHTML += data.message.replace(/verbose:.*$/gm,"\b");
})
socket.on('LLogDone',data => {
  document.getElementById('console').innerHTML += data.message;
})

socket.on('pushSerialConsole',data => {
  if (data === 'enabled') {
    showSerialConsole();
    clearSerialConsole();
  } else {
    document.getElementById('div-serial-monitor').innerHTML += data + '<br>';
  }
})

socket.on('pushDisplaySelection',data => {
  if (data === 'enabled') {
    document.getElementById('display-selection-div').style.display = "block";
  }
})

socket.on('pushUpdaterChannel',data => {
  populateUpdateChannelDropdown(data);
})

// Define internal functions ----------------------------------------------
function clearConsole () {
  var nodeConsole = document.getElementById('console');
  nodeConsole.innerHTML = '';
  // while (nodeConsole.firstChild) {
  //   nodeConsole.removeChild(nodeConsole.firstChild);
  // }
}

function clearSerialConsole () {
  var serialConsole = document.getElementById('div-serial-monitor');
  serialConsole.innerHTML = '';
}

function showSerialConsole () {
  document.getElementById('div-serial-monitor-container').style.display = "block";
}


function enableControls () {
  arrayWebsocketControls = document.getElementsByClassName('control-websocket');

  for (i = 0; i < arrayWebsocketControls.length; i++) {
    arrayWebsocketControls[i].disabled = false;
  }
}

function disableControls () {
  arrayWebsocketControls = document.getElementsByClassName('control-websocket');

  for (i = 0; i < arrayWebsocketControls.length; i++) {
    arrayWebsocketControls[i].disabled = true;
  }
}

function updatePlayerStateDisplay () {
  clearPlayerStateDisplay();

  var nodeText = document.createTextNode(JSON.stringify(playerState));
  document.getElementById('playerstate').appendChild(nodeText);
}

function startPlaybackTimer (nStartTime) {
  window.clearInterval(timerPlayback);

  timerPlayback = window.setInterval(function () {
    playerState.seek = nStartTime + Date.now() - timeLastStateUpdate;
    updatePlayerStateDisplay();
  }, 500);
}

function stopPlaybackTimer () {
  window.clearInterval(timerPlayback);
}

function clearPlayerStateDisplay () {
  var nodePlayerState = document.getElementById('playerstate');

  if (nodePlayerState.firstChild) {
    while (nodePlayerState.firstChild) {
      nodePlayerState.removeChild(nodePlayerState.firstChild);
    }
  }
}

function updatePlayerQueue (arrayQueue) {
  clearPlayQueue();

  var nodePlayQueue = document.getElementById('div-playqueue');

  for (i = 0; i < arrayQueue.length; i++) {
    var curEntry = arrayQueue[i];

    var sText = curEntry.name;
    var sSubText = '';
    if ('service' in curEntry) {
      sSubText = sSubText.concat(' Service: ' + curEntry.service + '');
    }
    if ('uri' in curEntry) {
      sSubText = sSubText.concat(' Uri: ' + curEntry.uri + '');
    }
    if ('artist' in curEntry) {
      sSubText = sSubText.concat(' Artist: ' + curEntry.artist);
    }
    if ('album' in curEntry) {
      sSubText = sSubText.concat(' Album: ' + curEntry.album + '');
    }
    if ('albumart' in curEntry) {
      sSubText = sSubText.concat(' Albumart: ' + curEntry.albumart + '');
    }

    var buttonRemove = document.createElement('button');
    buttonRemove.appendChild(document.createTextNode('Remove'));
    buttonRemove.className = 'button-itemaction';

    var nodeSpan = document.createElement('span');
    nodeSpan.appendChild(document.createTextNode(sText));
    nodeSpan.appendChild(buttonRemove);
    nodeSpan.appendChild(document.createElement('br'));
    nodeSpan.appendChild(document.createTextNode(sSubText));

    var nodeListItem = document.createElement('li');
    nodeListItem.appendChild(nodeSpan);
    nodePlayQueue.appendChild(nodeListItem);
  }
}

function clearPlayQueue () {
  var nodePlayQueue = document.getElementById('div-playqueue');

  if (nodePlayQueue.firstChild) {
    while (nodePlayQueue.firstChild) {
      nodePlayQueue.removeChild(nodePlayQueue.firstChild);
    }
  }
}

function emitEvent (sEvent, sParam1, sParam2) {
  socket.emit(sEvent, sParam1, sParam2);
}

document.querySelector('form.bug-form').addEventListener('submit', function (e) {
  // prevent the normal submission of the form
  var inputBugDesc = document.getElementById('bug-form-description');
  e.preventDefault();
  // Emit first and second input value
  var obj = {
    text: inputBugDesc.value
  };
  socket.emit('callMethod', {endpoint: 'system_controller/system', method: 'sendBugReport', data: obj});
  document.getElementById('bug-form-description').value = 'Sending log report, please wait';
});

document.querySelector('form.serial-form').addEventListener('submit', function (e) {
  // prevent the normal submission of the form
  var serialMessageToSend = document.getElementById('form-serial-message');
  e.preventDefault();
  // Emit first and second input value
  var obj = {
    action: 'sendMessage',
    message: serialMessageToSend.value
  };
  socket.emit('callMethod', {endpoint: 'music_service/inputs', method: 'serialMonitorAction', data: obj});
});

var clipboardDemos = new Clipboard('[data-clipboard-demo]');
clipboardDemos.on('success', function (e) {
  e.clearSelection();
});

var btns = document.querySelectorAll('.btn');
for (var i = 0; i < btns.length; i++) {
  btns[i].addEventListener('mouseleave', function (e) {
    e.currentTarget.setAttribute('class', 'btn');
    e.currentTarget.removeAttribute('aria-label');
  });
}

// Update channel
function populateUpdateChannelDropdown(data) {
  const dropdown = document.getElementById('updateChannelDropdown');

  if (!data || !Array.isArray(data.availableChannels)) {
    console.error('Invalid data structure - availableChannels must be an array');
    return false;
  }

  dropdown.innerHTML = '';

  data.availableChannels.forEach(function(channel) {
    if (typeof channel === 'string' && channel.trim()) {
      const displayName = channel.charAt(0).toUpperCase() + channel.slice(1);

      const option = document.createElement('option');
      option.value = channel;
      option.textContent = displayName;
      dropdown.appendChild(option);
    }
  });

  if (data.currentChannel) {
    dropdown.value = data.currentChannel;
  }

  dropdown.addEventListener('change', function() {
    setChannel(this.value);
  });
}

function setChannel(channel) {
  if (!channel || typeof channel !== 'string') {
    console.error('Invalid channel value');
    return false;
  }

  socket.emit('setUpdaterChannel', channel);
  console.log(`Updater channel set to: ${channel}`);
}

