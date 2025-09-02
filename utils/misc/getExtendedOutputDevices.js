var io = require('socket.io-client');

var socket = io.connect('http://localhost:3000');

socket.emit('getExtendedOutputDevices', '');

socket.on('pushExtendedOutputDevices', function(data) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
});