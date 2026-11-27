/*
From mpd.js
https://github.com/andrewrk/mpd.js

 */

var EventEmitter = require('events').EventEmitter,
	 util = require('util'),
	 assert = require('assert'),
	 net = require('net'),
	 MPD_SENTINEL = /^(OK|ACK|list_OK)(.*)\n/m,
	 OK_MPD = /^OK MPD /;

module.exports = MpdClient;
MpdClient.Command = Command;
MpdClient.cmd = cmd;
MpdClient.parseKeyValueMessage = parseKeyValueMessage;
MpdClient.parseArrayMessage = parseArrayMessage;

function MpdClient () {
  EventEmitter.call(this);

  // The reply in progress: its complete lines, and the incomplete last line
  this.parts = [];
  this.tail = '';
  this.msgHandlerQueue = [];
  this.idling = false;
}
util.inherits(MpdClient, EventEmitter);

var defaultConnectOpts = {
  host: 'localhost',
  port: 6600
};

MpdClient.connect = function (options) {
  options = options || defaultConnectOpts;

  var client = new MpdClient();
  client.socket = net.connect('/run/mpd/socket', function () {
    client.emit('connect');
  });
  client.socket.setEncoding('utf8');
  client.socket.on('data', function (data) {
    client.receive(data);
  });
  client.socket.on('close', function () {
    client.emit('end');
  });
  client.socket.on('error', function (err) {
    client.emit('error', err);
  });
  return client;
};

MpdClient.prototype.receive = function (data) {
  // Scan only what has not been scanned yet: the incomplete line carried over
  // from the previous read, plus this read. The complete lines of the reply in
  // progress are kept aside and joined once per reply, so the cost stays
  // linear in the size of the reply however many reads it takes to arrive.
  var text = this.tail + data;
  var m;
  while (m = text.match(MPD_SENTINEL)) {
    this.parts.push(text.substring(0, m.index));
    var msg = this.parts.join(''),
			 line = m[0],
			 code = m[1],
			 str = m[2];
    this.parts = [];
    text = text.substring(m.index + line.length);
    if (code === 'ACK') {
      var err = new Error(str);
      this.handleMessage(err);
    } else if (OK_MPD.test(line)) {
      this.setupIdling();
    } else {
      this.handleMessage(null, msg);
    }
  }
  // Keep the complete lines, carry the incomplete last one over to the next read
  var nl = text.lastIndexOf('\n');
  if (nl === -1) {
    this.tail = text;
  } else {
    this.parts.push(text.substring(0, nl + 1));
    this.tail = text.substring(nl + 1);
  }
};

MpdClient.prototype.handleMessage = function (err, msg) {
  var handler = this.msgHandlerQueue.shift();
  handler(err, msg);
};

MpdClient.prototype.setupIdling = function () {
  var self = this;
  self.sendWithCallback('idle', function (err, msg) {
    self.handleIdleResultsLoop(err, msg);
  });
  self.idling = true;
  self.emit('ready');
};

MpdClient.prototype.sendCommand = function (command, callback) {
  var self = this;
  callback = callback || noop.bind(this);
  try {
    assert.ok(self.idling);
    self.send('noidle\n');
    self.sendWithCallback(command, callback);
    self.sendWithCallback('idle', function (err, msg) {
      self.handleIdleResultsLoop(err, msg);
    });
  } catch (e) {
    self.emit('error', e.message);
  }
};

MpdClient.prototype.sendCommands = function (commandList, callback) {
  var fullCmd = 'command_list_begin\n' + commandList.join('\n') + '\ncommand_list_end';
  this.sendCommand(fullCmd, callback || noop.bind(this));
};

MpdClient.prototype.handleIdleResultsLoop = function (err, msg) {
  var self = this;
  if (err) {
    self.emit('error', err);
    return;
  }
  self.handleIdleResults(msg);
  if (self.msgHandlerQueue.length === 0) {
    self.sendWithCallback('idle', function (err, msg) {
      self.handleIdleResultsLoop(err, msg);
    });
  }
};

MpdClient.prototype.handleIdleResults = function (msg) {
  var self = this;
  msg.split('\n').forEach(function (system) {
    if (system.length > 0) {
      var name = system.substring(9);
      self.emit('system-' + name);
      self.emit('system', name);
    }
  });
};

MpdClient.prototype.sendWithCallback = function (cmd, cb) {
  cb = cb || noop.bind(this);
  this.msgHandlerQueue.push(cb);
  this.send(cmd + '\n');
};

MpdClient.prototype.send = function (data) {
  this.socket.write(data);
};

function Command (name, args) {
  this.name = name;
  this.args = args;
}

Command.prototype.toString = function () {
  return this.name + ' ' + this.args.map(argEscape).join(' ');
};

function argEscape (arg) {
  // replace all " with \"
  return '"' + arg.toString().replace(/"/g, '\\"') + '"';
}

function noop (err) {
  if (err) this.emit('error', err);
}

// convenience
function cmd (name, args) {
  return new Command(name, args);
}

function parseKeyValueMessage (msg) {
  var result = {};

  msg.split('\n').forEach(function (p) {
    if (p.length === 0) {
      return;
    }
    var keyValue = p.match(/([^ ]+): (.*)/);
    if (keyValue == null) {
      throw new Error('Could not parse entry "' + p + '"');
    }
    result[keyValue[1]] = keyValue[2];
  });
  return result;
}

function parseArrayMessage (msg) {
  var results = [];
  var obj = {};

  msg.split('\n').forEach(function (p) {
    if (p.length === 0) {
      return;
    }
    var keyValue = p.match(/([^ ]+): (.*)/);
    if (keyValue == null) {
      throw new Error('Could not parse entry "' + p + '"');
    }

    if (obj[keyValue[1]] !== undefined) {
      results.push(obj);
      obj = {};
      obj[keyValue[1]] = keyValue[2];
    } else {
      obj[keyValue[1]] = keyValue[2];
    }
  });
  results.push(obj);
  return results;
}
