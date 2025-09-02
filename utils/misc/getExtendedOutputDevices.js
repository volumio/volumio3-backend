var io = require('socket.io-client');

var socket = io.connect('http://localhost:3000');

socket.on('connect', function() {
    socket.emit('getExtendedOutputDevices', '');
    socket.emit('getOutputDevices', '');
});

socket.on('pushOutputDevices', function(data) {
    console.log('Push Output Devices:');
    console.log(JSON.stringify(data, null, 2));
});

socket.on('pushExtendedOutputDevices', function(data) {
    console.log('Push Extended Output Devices:');
    console.log(JSON.stringify(data, null, 2));
});